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

describe("G+ · asignación masiva Mongoose", () => {
  const { findings } = analyze(getExample("finance-full").code);

  it("clasifica los tres sinks como CWE-943, no CWE-89", () => {
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.cwe === 943)).toBe(true);
  });
});

describe("B+ · dos caminos al mismo sink", () => {
  const { graph, findings } = analyze(getExample("two-paths").code);

  it("reporta solo el camino sin sanear", () => {
    expect(findings).toHaveLength(1);
    const names = findings[0]!.path.map(
      (id) => graph.nodes.find((n) => n.id === id)!.name,
    );
    expect(names).toContain("rawTerm");
    expect(names).not.toContain("safeTerm");
  });

  it("las dos ramas convergen en el mismo parámetro del sink", () => {
    const sqlParam = graph.nodes.find((n) => n.name === "sql")!;
    const incoming = graph.edges.filter(
      (e) => e.to === sqlParam.id && e.kind === "BINDS_TO",
    );
    expect(incoming).toHaveLength(2);
  });

  it("la rama saneada pasa por una arista SANITIZED_BY", () => {
    const safeTerm = graph.nodes.find((n) => n.name === "safeTerm")!;
    expect(
      graph.edges.some((e) => e.kind === "SANITIZED_BY" && e.to === safeTerm.id),
    ).toBe(true);
  });
});
