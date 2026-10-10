import { describe, it, expect } from "vitest";
import { parseSource } from "../parser/parser.js";
import { analyzeGraph } from "../index.js";
import { analyzeTaint, getTaintRoles } from "../taint/analyzer.js";
import { buildVerdict } from "./verdict.js";

function verdictOf(code: string, file = "t.ts") {
  const parse = parseSource(code, file);
  if (parse.syntaxErrors > 0) {
    return buildVerdict({
      graph: { file, nodes: [], edges: [] },
      roles: { sourceIds: [], sinkIds: [], sanitizerIds: [] },
      findings: [],
      parse,
    });
  }
  const graph = analyzeGraph(code, file);
  return buildVerdict({
    graph,
    roles: getTaintRoles(graph),
    findings: analyzeTaint(graph),
    parse,
  });
}

describe("buildVerdict — distingue las tres causas de «0 hallazgos»", () => {
  it("código de otro lenguaje: no analizable, no concluyente", () => {
    const v = verdictOf(`package main

import "os/exec"

func run(cmd string) error {
    return exec.Command("sh", "-c", cmd).Run()
}`);
    expect(v.kind).toBe("not-analyzable");
    expect(v.conclusive).toBe(false);
    expect(v.syntaxErrors).toBeGreaterThan(0);
  });

  it("JS válido sin sinks: verde pero no concluyente", () => {
    const v = verdictOf(`function total(items) {
  return items.reduce((n, i) => n + i.price, 0);
}`);
    expect(v.kind).toBe("no-coverage");
    expect(v.conclusive).toBe(false);
    expect(v.sinks).toBe(0);
  });

  it("sources y sinks presentes, camino sanitizado: verde concluyente", () => {
    const v = verdictOf(`function h(req) {
  const q = sanitize(req.body);
  db.query(q);
}`);
    expect(v.kind).toBe("clean");
    expect(v.conclusive).toBe(true);
    expect(v.sources).toBeGreaterThan(0);
    expect(v.sinks).toBeGreaterThan(0);
  });

  it("camino sin sanitizar: vulnerable", () => {
    const v = verdictOf(`function h(req) {
  db.query(req.body);
}`);
    expect(v.kind).toBe("vulnerable");
    expect(v.conclusive).toBe(true);
    expect(v.findings).toBeGreaterThan(0);
  });

  it("un verde no concluyente nunca afirma que el código sea seguro", () => {
    for (const code of ["const a = 1;", "function f() { return 2; }"]) {
      const v = verdictOf(code);
      expect(v.conclusive).toBe(false);
      expect(v.detail).toContain("no afirma");
    }
  });
});

describe("buildVerdict — concordancia de número", () => {
  const emptyGraph = { file: "t.ts", nodes: [], edges: [] };
  const roles = (sources: number, sinks: number) => ({
    sourceIds: Array.from({ length: sources }, (_, i) => `src${i}`),
    sinkIds: Array.from({ length: sinks }, (_, i) => `snk${i}`),
    sanitizerIds: [],
  });
  const parse = (syntaxErrors = 0) => ({
    syntaxErrors,
    messages: [] as string[],
    dialect: "ts" as const,
  });

  it("una vulnerabilidad va en singular", () => {
    const v = verdictOf(`function h(req) {
  db.query(req.body);
}`);
    expect(v.findings).toBe(1);
    expect(v.title).toBe("1 vulnerabilidad detectada");
    expect(v.detail).toContain("Hay 1 camino de datos");
  });

  it("varias vulnerabilidades van en plural", () => {
    const v = verdictOf(`function postFinances(req, res) {
  const data = req.body;
  Finance.create(data);
}
function putFinance(req, res) {
  const id = req.params.id;
  const data = req.body;
  Finance.findByIdAndUpdate(id, data);
}
function deleteFinance(req, res) {
  Finance.findByIdAndDelete(req.params.id);
}`);
    expect(v.findings).toBe(3);
    expect(v.title).toBe("3 vulnerabilidades detectadas");
    expect(v.detail).toContain("Hay 3 caminos de datos");
  });

  it("un error de sintaxis va en singular y varios en plural", () => {
    const one = buildVerdict({
      graph: emptyGraph,
      roles: roles(0, 0),
      findings: [],
      parse: parse(1),
    });
    expect(one.detail).toContain("encontró 1 error de sintaxis");

    const many = buildVerdict({
      graph: emptyGraph,
      roles: roles(0, 0),
      findings: [],
      parse: parse(4),
    });
    expect(many.detail).toContain("encontró 4 errores de sintaxis");
  });

  it("sin cobertura, concuerda source y sink por separado", () => {
    const v = buildVerdict({
      graph: emptyGraph,
      roles: roles(1, 0),
      findings: [],
      parse: parse(),
    });
    expect(v.kind).toBe("no-coverage");
    expect(v.detail).toContain("(1 source, 0 sinks)");
  });

  it("limpio, concuerda en singular y en plural", () => {
    const singular = buildVerdict({
      graph: emptyGraph,
      roles: roles(1, 1),
      findings: [],
      parse: parse(),
    });
    expect(singular.kind).toBe("clean");
    expect(singular.detail).toContain("entre 1 source y 1 sink y ninguno");

    const plural = buildVerdict({
      graph: emptyGraph,
      roles: roles(2, 3),
      findings: [],
      parse: parse(),
    });
    expect(plural.detail).toContain("entre 2 sources y 3 sinks y ninguno");
  });

  it("ningún veredicto deja el «(s)» sin resolver", () => {
    const casos = [
      buildVerdict({ graph: emptyGraph, roles: roles(0, 0), findings: [], parse: parse(2) }),
      buildVerdict({ graph: emptyGraph, roles: roles(1, 0), findings: [], parse: parse() }),
      buildVerdict({ graph: emptyGraph, roles: roles(1, 1), findings: [], parse: parse() }),
      verdictOf(`function h(req) {
  db.query(req.body);
}`),
    ];
    for (const v of casos) {
      expect(`${v.title} ${v.detail}`).not.toMatch(/\(e?s\)/);
    }
  });
});

describe("parseSource — dialecto y errores de sintaxis", () => {
  it("TypeScript válido: sin errores", () => {
    const r = parseSource(`export const f = (x: number): number => x * 2;`, "t.ts");
    expect(r.syntaxErrors).toBe(0);
    expect(r.dialect).toBe("ts");
  });

  it("JSX pegado como .ts: reintenta como .tsx y lo acepta", () => {
    const r = parseSource(
      `function Card({ user }) {\n  return <div className="c">{user.name}</div>;\n}`,
      "demo.ts",
    );
    expect(r.syntaxErrors).toBe(0);
    expect(r.dialect).toBe("tsx");
  });

  it("Go: errores de sintaxis con mensaje ubicado", () => {
    const r = parseSource(`func main() {\n    ch := make(chan int)\n    <-ch\n}`, "t.ts");
    expect(r.syntaxErrors).toBeGreaterThan(0);
    expect(r.messages[0]).toMatch(/^línea \d+:/);
  });

  it("identificador no declarado es semántico, no sintáctico", () => {
    const r = parseSource(`db.query(noExisteEnNingunLado);`, "t.ts");
    expect(r.syntaxErrors).toBe(0);
  });
});
