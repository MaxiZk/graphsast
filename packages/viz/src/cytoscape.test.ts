import { describe, it, expect } from "vitest";
import { analyzeGraph, analyzeTaint } from "@graphsast/core";
import {
  PATH_MARGIN,
  axisPan,
  graphExport,
  linesOnPath,
  nodeMatchesQuery,
  toCytoscapeElements,
} from "./cytoscape.js";

describe("toCytoscapeElements", () => {
  it("genera nodos y aristas del grafo", () => {
    const graph = analyzeGraph(
      `function handler(input){ const q = input; db.query(q); }`,
    );
    const [finding] = analyzeTaint(graph);
    const elements = toCytoscapeElements(graph, { highlight: finding });
    const nodes = elements.filter((e) => !e.data.source);
    const edges = elements.filter((e) => e.data.source);
    expect(nodes.length).toBe(graph.nodes.length);
    expect(edges.length).toBe(graph.edges.length);
  });

  it("marca source, sink y camino de riesgo", () => {
    const graph = analyzeGraph(
      `function handler(input){ const q = input; db.query(q); }`,
    );
    const findings = analyzeTaint(graph);
    const [finding] = findings;
    const roles = {
      sourceIds: findings.map((f) => f.sourceId),
      sinkIds: findings.map((f) => f.sinkId),
      sanitizerIds: [],
    };
    const elements = toCytoscapeElements(graph, { highlight: finding, roles });
    expect(elements.some((e) => e.classes?.includes("source"))).toBe(true);
    expect(elements.some((e) => e.classes?.includes("sink"))).toBe(true);
    expect(elements.some((e) => e.classes?.includes("risk-path"))).toBe(true);
    expect(elements.some((e) => e.classes?.includes("risk-edge"))).toBe(true);
  });

  it("filtra aristas por tipo", () => {
    const graph = analyzeGraph(
      `function handler(input){ const q = input; db.query(q); }`,
    );
    const elements = toCytoscapeElements(graph, {
      visibleEdges: new Set(["FLOWS_TO"]),
    });
    const edges = elements.filter((e) => e.data.source);
    expect(edges.every((e) => e.data.kind === "FLOWS_TO")).toBe(true);
  });
});

describe("linesOnPath", () => {
  it("devuelve líneas de los nodos del camino", () => {
    const graph = analyzeGraph(
      `function handler(input){ const q = input; db.query(q); }`,
    );
    const [finding] = analyzeTaint(graph);
    const lines = linesOnPath(graph, finding);
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe("nodeMatchesQuery", () => {
  const node = { label: "db.query", code: "db.query(sql)", file: "src/users.repository.ts", line: 12 };

  it("busca en rótulo, código y archivo sin distinguir mayúsculas", () => {
    expect(nodeMatchesQuery(node, "DB.QUERY")).toBe(true);
    expect(nodeMatchesQuery(node, "sql")).toBe(true);
    expect(nodeMatchesQuery(node, "repository")).toBe(true);
    expect(nodeMatchesQuery(node, "exec")).toBe(false);
  });

  it("archivo:línea busca por ubicación", () => {
    expect(nodeMatchesQuery(node, "users.repository.ts:12")).toBe(true);
    expect(nodeMatchesQuery(node, "users.repository.ts:13")).toBe(false);
  });

  it("una búsqueda vacía no marca nada", () => {
    expect(nodeMatchesQuery(node, "   ")).toBe(false);
  });
});

describe("graphExport", () => {
  it("exporta el grafo completo y los hallazgos", () => {
    const graph = analyzeGraph(`function handler(input){ const q = input; db.query(q); }`);
    const findings = analyzeTaint(graph);
    const out = graphExport(graph, findings, { generator: "GraphSAST", version: "x" });
    expect(out.nodes).toHaveLength(graph.nodes.length);
    expect(out.edges).toHaveLength(graph.edges.length);
    expect(out.findings).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(out)).generator).toBe("GraphSAST");
  });
});

describe("axisPan", () => {
  it("centra el camino si entra", () => {
    // Camino de 0 a 100 a zoom 1 en 400 px: su centro (50) queda en 200.
    expect(axisPan(0, 100, 0, 400, 1)).toBe(150);
  });

  it("si no entra, pega al margen el borde del lado de la entrada", () => {
    // Entrada a la izquierda (x = 0): el borde izquierdo queda en el margen.
    expect(axisPan(0, 1000, 0, 400, 1)).toBe(PATH_MARGIN);
    // Entrada a la derecha (x = 1000): el borde derecho queda a un margen del final.
    expect(axisPan(0, 1000, 1000, 400, 1)).toBe(400 - PATH_MARGIN - 1000);
  });
});
