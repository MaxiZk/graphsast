import { describe, it, expect } from "vitest";
import { analyzeGraph, analyzeTaint } from "@graphsast/core";
import { DEFAULT_EXAMPLE_ID, DEMO_EXAMPLES, getExample } from "./examples.js";

function analyze(code: string) {
  const graph = analyzeGraph(code, "demo.ts");
  return { graph, findings: analyzeTaint(graph) };
}

describe("ejemplos de la demo", () => {
  it.each(DEMO_EXAMPLES.map((e) => [e.id, e] as const))(
    "%s: el motor coincide con expectFinding",
    (_id, ex) => {
      const { findings } = analyze(ex.code);
      expect(findings.length > 0).toBe(ex.expectFinding);
    },
  );

  it("el ejemplo por defecto cruza al menos dos funciones", () => {
    const ex = getExample(DEFAULT_EXAMPLE_ID);
    const { graph, findings } = analyze(ex.code);
    const finding = findings[0]!;
    const owners = new Set(
      finding.path
        .map((id) => graph.nodes.find((n) => n.id === id))
        .map((n) => (n && "ownerFnId" in n ? n.ownerFnId : null))
        .filter(Boolean),
    );
    expect(owners.size).toBeGreaterThanOrEqual(2);
  });
});

describe("par vulnerable / sanitizado", () => {
  it("difieren en una sola línea", () => {
    const a = getExample("vulnerable").code.split("\n");
    const b = getExample("sanitized").code.split("\n");
    expect(a).toHaveLength(b.length);
    expect(a.filter((line, i) => line !== b[i])).toHaveLength(1);
  });

  it("la versión sanitizada corta el camino con una arista SANITIZED_BY", () => {
    const { graph, findings } = analyze(getExample("sanitized").code);
    expect(findings).toHaveLength(0);
    expect(graph.edges.some((e) => e.kind === "SANITIZED_BY")).toBe(true);
  });
});
