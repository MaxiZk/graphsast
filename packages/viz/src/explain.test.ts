import { describe, it, expect } from "vitest";
import { analyzeGraph, analyzeTaint, getCatalogBundle, scanFilesWithGraphs } from "@graphsast/core";
import { explainFinding, groupBySink } from "./explain.js";

const entryOf = (cwe: number) => getCatalogBundle().entries.find((e) => e.cwe === cwe);

function explainFirst(code: string) {
  const graph = analyzeGraph(code, "demo.ts");
  const [finding] = analyzeTaint(graph);
  return explainFinding(graph, finding!, entryOf(finding!.cwe!))!;
}

describe("explainFinding", () => {
  const SQLI = [
    'app.get("/usuarios", (req, res) => {',
    "  const id = req.query.id;",
    '  db.query("SELECT * FROM usuarios WHERE id = " + id);',
    "});",
  ].join("\n");

  it("dice de dónde viene el dato, a dónde llega, qué faltó y cómo corregirlo", () => {
    const e = explainFirst(SQLI);
    expect(e.title).toBe("SQL Injection (CWE-89)");
    expect(e.summary).toBe("req llega a db.query en 2 pasos.");
    expect(e.source).toMatchObject({ label: "req", where: "demo.ts:1" });
    expect(e.source.why).toContain("request HTTP");
    expect(e.sink).toMatchObject({ label: "db.query", where: "demo.ts:3" });
    expect(e.sink.code).toContain("SELECT * FROM usuarios");
    // Riesgo, ataque y corrección salen del catálogo.
    expect(e.sink.why).toBe(entryOf(89)!.description);
    expect(e.sink.attack).toBe(entryOf(89)!.attack);
    expect(e.fix).toBe(entryOf(89)!.fix);
    expect(e.missing).toContain("ningún filtro contra SQL Injection");
    // Los ejemplos de filtro son funciones que existen, para poder buscarlas.
    expect(e.missing).toContain("(por ejemplo mysql.escape, validator.escape, escapeId)");
    expect(e.steps.map((s) => s.label)).toEqual(["req", "id", "db.query"]);
  });

  it("un parámetro que nadie llama: explica por qué se lo trata como entrada", () => {
    const e = explainFirst('function buscar(filtro) {\n  db.query("SELECT * FROM t WHERE " + filtro);\n}');
    expect(e.source.label).toBe("filtro");
    expect(e.source.why).toContain("parámetro de buscar()");
    expect(e.source.why).toContain("ninguna función del código analizado la llama");
  });

  it("marca los pasos que saltan a otro archivo", () => {
    const output = scanFilesWithGraphs([
      { path: "app/controller.ts", content: 'import { find } from "./repo";\nexport function show(req: any) {\n  find(req.params.id);\n}' },
      { path: "app/repo.ts", content: "export function find(id: string) {\n  db.query(id);\n}" },
    ]);
    const g = output.graphs.find((x) => x.findings.length > 0)!;
    const e = explainFinding(g.graph, g.findings[0]!, entryOf(89))!;
    expect(e.summary).toBe("req llega a db.query en 2 pasos, pasando por 2 archivos.");
    expect(e.steps.map((s) => s.newFile)).toEqual([false, true, false]);
    expect(e.sink.where).toBe("repo.ts:2");
  });

  it("sin entrada de catálogo igual explica, con textos genéricos", () => {
    const graph = analyzeGraph(SQLI, "demo.ts");
    const e = explainFinding(graph, analyzeTaint(graph)[0]!)!;
    expect(e.sink.attack).toBeUndefined();
    expect(e.fix).toBeUndefined();
    expect(e.sink.why).toBeTruthy();
  });
});

describe("groupBySink", () => {
  it("junta los caminos al mismo destino, el más corto primero, en el orden en que aparecen", () => {
    const items = [
      { sink: "a", len: 5, id: 1 },
      { sink: "b", len: 2, id: 2 },
      { sink: "a", len: 3, id: 3 },
    ];
    const groups = groupBySink(items, (i) => i.sink, (i) => i.len);
    expect(groups.map((g) => g.map((i) => i.id))).toEqual([[3, 1], [2]]);
  });
});
