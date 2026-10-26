import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { isAnchoredRegex } from "../ir/guards.js";
import { analyzeTaint } from "./analyzer.js";
import { taintRulesFor } from "./rules.js";

function findingsOf(code: string, sources: "params" | "catalog" = "params") {
  const graph = analyzeGraph(code, "t.js");
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const findings = analyzeTaint(graph, { rules: taintRulesFor(sources) });
  return {
    graph,
    findings,
    paths: findings.map((f) => f.path.map((id) => {
      const n = byId.get(id)!;
      return n.kind === "Call" ? n.callee : n.name;
    }).join(" -> ")),
  };
}

const handler = (body: string) => `app.get("/b", (req, res) => {\n${body}\n});`;

describe("validaciones antes del uso", () => {
  it("un ternario con una lista permitida protege la rama en la que se cumple", () => {
    expect(findingsOf(handler(`
  const orden = COLUMNAS.includes(req.query.orden) ? req.query.orden : "nombre";
  db.query("SELECT * FROM t ORDER BY " + orden);`)).findings).toEqual([]);
    expect(findingsOf(handler(`
  const orden = !COLUMNAS.includes(req.query.orden) ? "nombre" : req.query.orden;
  db.query("SELECT * FROM t ORDER BY " + orden);`)).findings).toEqual([]);
    expect(findingsOf(handler(`
  const orden = COLUMNAS.includes(req.query.orden) ? "nombre" : req.query.orden;
  db.query("SELECT * FROM t ORDER BY " + orden);`)).findings).toHaveLength(1);
  });

  it("el caso del tester: regex anclada que corta antes del exec", () => {
    const { findings, graph } = findingsOf(handler(`
  if (!/^[a-z]+$/.test(req.query.q)) return res.end();
  exec("ls " + req.query.q);`));
    expect(findings).toEqual([]);
    // El corte se ve en el grafo: el dato sale de la validación por SANITIZED_BY.
    expect(graph.edges.some((e) => e.kind === "SANITIZED_BY")).toBe(true);
  });

  it("el bloque que responde y sale también corta", () => {
    expect(findingsOf(handler(`
  const host = req.query.host;
  if (!/^[\\w.-]+$/.test(host)) {
    res.status(400).send("host inválido");
    return;
  }
  exec("ping -c 1 " + host);`)).findings).toEqual([]);
  });

  it("la regex en una constante del archivo, y throw en vez de return", () => {
    expect(findingsOf(`const SOLO_LETRAS = /^[a-z]+$/;
${handler(`
  if (!SOLO_LETRAS.test(req.query.q)) throw new Error("no");
  exec("ls " + req.query.q);`)}`).findings).toEqual([]);
  });

  it("forma positiva: protege el bloque del if y nada más", () => {
    const { paths } = findingsOf(handler(`
  if (/^[a-z]+$/.test(req.query.q)) {
    exec("ls " + req.query.q);
  }
  exec("cat " + req.query.q);`));
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe("req -> exec");
  });

  it("lista permitida, Number.isInteger y validator.isX", () => {
    for (const check of [
      "PERMITIDOS.includes(req.query.q)",
      "Number.isInteger(req.query.q)",
      "validator.isAlphanumeric(req.query.q)",
    ]) {
      const code = `const PERMITIDOS = ["a", "b"];\n${handler(`
  if (!${check}) return res.end();
  exec("ls " + req.query.q);`)}`;
      expect(findingsOf(code).findings, check).toEqual([]);
    }
  });

  it("no corta lo que no acota el dato", () => {
    for (const guard of [
      "if (!/[a-z]+/.test(req.query.q)) return;", // sin anclar: «contiene una letra»
      "if (!/^[a-z]+$/m.test(req.query.q)) return;", // con m, ^ y $ son por línea
      "if (!/^a|b$/.test(req.query.q)) return;", // «empieza con a» o «termina en b»
      'if (!/^[a-z]+$/.test(req.query.q)) console.log("raro");', // no sale
      "if (!/^[a-z]+$/.test(req.query.otro)) return;", // valida otra cosa
    ]) {
      const { findings } = findingsOf(handler(`\n  ${guard}\n  exec("ls " + req.query.q);`));
      expect(findings.length, guard).toBe(1);
    }
  });

  it("isAnchoredRegex", () => {
    expect(isAnchoredRegex("/^[a-z0-9_-]{1,32}$/i")).toBe(true);
    expect(isAnchoredRegex("/^(a|b)$/")).toBe(true);
    expect(isAnchoredRegex("/^[|]$/")).toBe(true);
    expect(isAnchoredRegex("/^a|b$/")).toBe(false);
    expect(isAnchoredRegex("/^a\\$/")).toBe(false);
    expect(isAnchoredRegex("/a$/")).toBe(false);
    expect(isAnchoredRegex("/^a$/m")).toBe(false);
  });
});

describe("campos de clase", () => {
  it("el caso del tester: el dato entra por el constructor y se usa en otro método", () => {
    const { paths } = findingsOf(`class Svc {
  constructor(x) { this.x = x; }
  go() { exec("echo " + this.x); }
}
app.get("/g", (req, res) => { new Svc(req.body.v).go(); });`, "catalog");
    // Con sources del catálogo solo `req` es entrada: el camino cruza el new.
    expect(paths).toEqual(["req -> x -> this.x -> exec"]);
  });

  it("parámetro con modificador de TypeScript (constructor(private cmd))", () => {
    const code = `class Runner {
  constructor(private cmd: string) {}
  run() { exec(this.cmd); }
}
export function h(req: any) { new Runner(req.query.c).run(); }`;
    const graph = analyzeGraph(code, "t.ts");
    const findings = analyzeTaint(graph, { rules: taintRulesFor("catalog") });
    expect(findings).toHaveLength(1);
  });

  it("el mismo campo en otra clase es otra variable", () => {
    const { findings } = findingsOf(`class A {
  constructor(x) { this.x = x; }
}
class B {
  constructor() { this.x = "ls"; }
  run() { exec(this.x); }
}
app.get("/a", (req, res) => { new A(req.body.v); new B().run(); });`, "catalog");
    expect(findings).toEqual([]);
  });
});
