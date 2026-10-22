import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Driver } from "neo4j-driver";
import { analyzeGraph } from "../index.js";
import { analyzeWithEngine } from "../engine/analyze.js";
import { BENCHMARK_CORPUS } from "../eval/benchmark/corpus.js";
import { rulesFromCatalog } from "../catalog/rules.js";
import { analyzeTaint } from "../taint/analyzer.js";
import { getCatalogBundle } from "../taint/rules.js";
import type { TaintFinding } from "../taint/types.js";
import { createNeo4jDriver } from "./neo4j.js";

/**
 * Motor Neo4j contra una base real. Solo corre con `NEO4J_URI` definido
 * (`npm run neo4j:up` en local; un service container en el CI). Usa la base
 * por defecto, así que no conviene apuntarlo a una con datos propios.
 */
const enabled = Boolean(process.env.NEO4J_URI);

const pairs = (findings: TaintFinding[]) =>
  [...new Set(findings.map((f) => `${f.sourceId} -> ${f.sinkId} CWE-${f.cwe}`))].sort();

describe.skipIf(!enabled)("motor Neo4j (base real)", () => {
  let driver: Driver;

  beforeAll(async () => {
    driver = await createNeo4jDriver();
  });
  afterAll(async () => {
    await driver?.close();
  });

  const count = async (cypher: string): Promise<number> => {
    const session = driver.session();
    try {
      const r = await session.run(cypher);
      return Number(r.records[0]!.get(0));
    } finally {
      await session.close();
    }
  };

  it("da los mismos hallazgos que el motor en memoria en todo el benchmark", async () => {
    for (const c of BENCHMARK_CORPUS) {
      const graph = analyzeGraph(c.code, c.file ?? `${c.id.toLowerCase()}.ts`);
      const neo = await analyzeWithEngine(graph, { driver });
      expect(neo.engine).toBe("neo4j");
      expect(pairs(neo.findings), c.id).toEqual(pairs(analyzeTaint(graph)));
    }
  }, 120_000);

  it("dos análisis simultáneos no se pisan", async () => {
    const vulnerable = BENCHMARK_CORPUS.find((c) => c.label === "vulnerable")!;
    const safe = BENCHMARK_CORPUS.find((c) => c.label === "safe")!;
    for (let i = 0; i < 5; i++) {
      // Mismo nombre de archivo: los ids de nodo coinciden entre los dos grafos.
      const gv = analyzeGraph(vulnerable.code, "input.ts");
      const gs = analyzeGraph(safe.code, "input.ts");
      const [a, b] = await Promise.all([
        analyzeWithEngine(gv, { driver }),
        analyzeWithEngine(gs, { driver }),
      ]);
      expect(pairs(a.findings)).toEqual(pairs(analyzeTaint(gv)));
      expect(b.findings).toEqual([]);
    }
  }, 60_000);

  it("respeta --max-depth y el maxDepth de la familia, como el motor en memoria", async () => {
    const graph = analyzeGraph(
      `function h(req) { const a = req.query.id; const b = a; db.query("SELECT " + b); }`,
      "depth.ts",
    );
    const length = analyzeTaint(graph)[0]!.path.length - 1;
    const shortSql = rulesFromCatalog({
      ...getCatalogBundle(),
      entries: getCatalogBundle().entries.map((e) => (e.cwe === 89 ? { ...e, maxDepth: length - 1 } : e)),
    });
    for (const taint of [{ maxDepth: length - 1 }, { maxDepth: length }, { rules: shortSql }]) {
      const neo = await analyzeWithEngine(graph, { driver, taint });
      expect(pairs(neo.findings), JSON.stringify(taint)).toEqual(pairs(analyzeTaint(graph, taint)));
    }
    expect((await analyzeWithEngine(graph, { driver, taint: { rules: shortSql } })).findings).toEqual([]);
  });

  it("validaciones, campos de clase y entradas solo del catálogo, como el motor en memoria", async () => {
    const cases = [
      // Validación que corta antes del uso: sin hallazgo.
      `app.get("/b", (req, res) => {
        if (!/^[a-z]+$/.test(req.query.q)) return res.end();
        exec("ls " + req.query.q);
      });`,
      // El dato pasa por un campo de la clase.
      `class Svc { constructor(x) { this.x = x; } go() { exec("echo " + this.x); } }
      app.get("/g", (req, res) => { new Svc(req.body.v).go(); });`,
      // CWE-22 solo desde una entrada del catálogo: req sí, el parámetro suelto no.
      `app.get("/f", (req, res) => { res.send(fs.readFileSync("./files/" + req.query.f)); });
      function leer(nombre) { return fs.readFileSync("./files/" + nombre); }`,
      // Condiciones de sink y $eq: cada línea alterna un caso que no es
      // hallazgo con uno que sí.
      `app.post("/i", async (req, res) => {
        await User.create({ email: req.body.email });
        await User.create(req.body);
        const u = await User.findById(req.user.id); u.email = req.body.email; await u.save();
        const f = new Finance(req.body); await f.save();
        await User.findOne({ email: { $eq: req.body.email } });
        await User.findOne({ name: req.body.name });
        await UserModel.findOne({ where: { email: req.body.email } });
        res.send({ name: req.body.name });
        res.send("<p>" + req.body.name + "</p>");
      });`,
      // Entradas del navegador, startsWith sobre la ruta resuelta, spawn con
      // y sin shell, res.status().send con texto y con un objeto.
      `document.getElementById("t").innerHTML = location.hash;
      document.getElementById("u").textContent = location.hash;
      app.get("/j", (req, res) => {
        const ruta = path.resolve(BASE, req.query.f);
        if (!ruta.startsWith(BASE)) return res.end();
        fs.readFileSync(ruta);
        res.send("<p>" + ruta + "</p>");
        spawn("ls", [req.query.d]);
        spawn("sh", ["-c", req.query.d]);
        const result = { q: req.query.q };
        res.status(200).send(result);
        res.status(400).send("No existe " + req.query.q);
      });`,
    ];
    for (const code of cases) {
      const graph = analyzeGraph(code, "nuevo.js");
      const neo = await analyzeWithEngine(graph, { driver });
      expect(pairs(neo.findings), code).toEqual(pairs(analyzeTaint(graph)));
    }
  });

  it("Python, Java, PHP y Go, con las reglas de su lenguaje", async () => {
    const files: [string, string][] = [
      ["app.py", `from flask import request
@app.route("/u")
def u():
    cursor.execute("SELECT * FROM t WHERE id = " + request.args["id"])
    cursor.execute("SELECT * FROM t WHERE id = %s", (request.args["id"],))
    return "<b>" + escape(request.args["n"]) + "</b>"`],
      ["App.java", `class C { void h(HttpServletRequest request) throws Exception {
  st.executeQuery("SELECT " + request.getParameter("id"));
  new ProcessBuilder("ping", request.getParameter("h")).start();
} }`],
      ["index.php", `<?php echo $_GET["a"]; echo htmlspecialchars($_GET["b"]); mysqli_query($c, "SELECT " . (int) $_GET["id"]);`],
      ["main.go", `package main
func h(w http.ResponseWriter, r *http.Request) {
  id := r.FormValue("id")
  db.Query("SELECT * FROM t WHERE id = " + id)
  exec.Command("sh", "-c", "ping " + id).Run()
}`],
    ];
    for (const [file, code] of files) {
      const graph = analyzeGraph(code, file);
      expect(graph.language, file).not.toBe("javascript");
      const neo = await analyzeWithEngine(graph, { driver });
      expect(neo.findings.length, file).toBeGreaterThan(0);
      expect(pairs(neo.findings), code).toEqual(pairs(analyzeTaint(graph)));
    }
  });

  it("no deja nodos del análisis en la base", async () => {
    const graph = analyzeGraph("function h(req) { db.query(req.body.q); }", "left.ts");
    await analyzeWithEngine(graph, { driver });
    expect(await count("MATCH (n:GSNode {file: 'left.ts'}) RETURN count(n)")).toBe(0);
  });

  it("crea el índice por análisis e id", async () => {
    expect(await count("SHOW INDEXES YIELD name WHERE name = 'gsnode_run_id' RETURN count(*)")).toBe(1);
  });
});
