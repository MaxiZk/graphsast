import { describe, it, expect } from "vitest";
import { getTaintRoles, scanFilesWithGraphs } from "@graphsast/core";
import {
  focusGraph,
  findingPath,
  graphIndexOfFile,
  linesInFile,
  projectFindings,
  projectVerdict,
} from "./project-view.js";

function scan(files: Record<string, string>) {
  const output = scanFilesWithGraphs(
    Object.entries(files).map(([path, content]) => ({ path, content })),
  );
  const roles = output.graphs.map((g) => getTaintRoles(g.graph));
  return {
    output,
    sources: roles.reduce((n, r) => n + r.sourceIds.length, 0),
    sinks: roles.reduce((n, r) => n + r.sinkIds.length, 0),
  };
}

const CROSS_FILE = {
  "app/controller.ts": [
    'import { find } from "./repo";',
    "export function show(req: any) {",
    "  find(req.params.id);",
    "}",
  ].join("\n"),
  "app/repo.ts": [
    "export function find(id: string) {",
    "  db.query(id);",
    "}",
  ].join("\n"),
};

describe("projectVerdict", () => {
  it("vulnerable: cuenta hallazgos y archivos afectados", () => {
    const { output, ...roles } = scan(CROSS_FILE);
    const verdict = projectVerdict(output, roles);
    expect(verdict.kind).toBe("vulnerable");
    expect(verdict.title).toBe("1 vulnerabilidad detectada en 1 archivo");
  });

  it("clean: hay sources y sinks, pero el dato pasa por un sanitizador", () => {
    const { output, ...roles } = scan({
      "a.ts": "function f(input) { const safe = escape(input); db.query(safe); }",
    });
    expect(projectVerdict(output, roles).kind).toBe("clean");
  });

  it("no-coverage: sin sinks no se afirma que el código sea seguro", () => {
    const { output, ...roles } = scan({ "a.ts": "export const x = 1;" });
    const verdict = projectVerdict(output, roles);
    expect(verdict.kind).toBe("no-coverage");
    expect(verdict.conclusive).toBe(false);
  });

  it("not-analyzable: ningún archivo se pudo parsear", () => {
    const { output, ...roles } = scan({ "a.ts": "def f(x):\n    return x" });
    expect(projectVerdict(output, roles).kind).toBe("not-analyzable");
  });
});

describe("hallazgos del proyecto", () => {
  it("el camino entre archivos marca el salto y resalta solo las líneas del archivo mirado", () => {
    const { output } = scan(CROSS_FILE);
    const [item] = projectFindings(output);
    expect(item!.finding.file).toBe("app/repo.ts");
    // req (controller.ts:2) → id (repo.ts:1) → db.query (repo.ts:2)
    expect(findingPath(item!.finding)).toBe("req → [app/repo.ts] id → db.query");
    expect([...linesInFile(item!.finding, "app/repo.ts")].sort()).toEqual([1, 2]);
    expect([...linesInFile(item!.finding, "app/controller.ts")]).toEqual([2]);
  });

  it("encuentra el grafo de cada archivo, y -1 si no se analizó", () => {
    const { output } = scan({ ...CROSS_FILE, "bad.ts": "def f(x):\n    return x" });
    expect(graphIndexOfFile(output, "app/controller.ts")).toBe(graphIndexOfFile(output, "app/repo.ts"));
    expect(graphIndexOfFile(output, "bad.ts")).toBe(-1);
  });
});

describe("focusGraph", () => {
  it("deja entero un grafo chico", () => {
    const { output } = scan(CROSS_FILE);
    const { graph } = output.graphs[0]!;
    expect(focusGraph(graph, {}, 1000).graph).toBe(graph);
  });

  it("en un grafo grande recorta al camino y sus vecinos, sin aristas colgadas", () => {
    const { output } = scan(CROSS_FILE);
    const [scanGraph] = output.graphs;
    const path = scanGraph!.findings[0]!.path;
    const view = focusGraph(scanGraph!.graph, { path }, path.length + 1);
    const ids = new Set(view.graph.nodes.map((n) => n.id));
    expect(view.total).toBe(scanGraph!.graph.nodes.length);
    expect(view.graph.nodes.length).toBeLessThan(view.total);
    expect(path.every((id) => ids.has(id))).toBe(true);
    expect(view.graph.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  });

  it("sin camino muestra solo los nodos del archivo elegido", () => {
    const { output } = scan(CROSS_FILE);
    const view = focusGraph(output.graphs[0]!.graph, { file: "app/repo.ts" }, 1);
    expect(view.graph.nodes.length).toBeGreaterThan(0);
    expect(view.graph.nodes.every((n) => n.loc.file === "app/repo.ts")).toBe(true);
  });
});
