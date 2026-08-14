import { describe, it, expect } from "vitest";
import { analyzeGraph, analyzeTaint } from "@graphsast/core";
import { linesOnPath, toCytoscapeElements } from "./cytoscape.js";

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
