import { describe, it, expect } from "vitest";
import { analyze, analyzeGraph } from "./index.js";

describe("analyze (fachada)", () => {
  it("dado código fuente, devuelve un IRModule poblado", () => {
    const ir = analyze('function h(name){ db.query(name); }', "svc.ts");
    expect(ir.file).toBe("svc.ts");
    const kinds = ir.nodes.map((n) => n.kind).sort();
    expect(kinds).toContain("Function");
    expect(kinds).toContain("Parameter");
    expect(kinds).toContain("Call");
  });
});

describe("analyzeGraph (fachada)", () => {
  it("devuelve un IRGraph con nodos y aristas CALLS", () => {
    const g = analyzeGraph(
      `function helper(x){ return x; } function main(){ helper(1); }`,
      "svc.ts",
    );
    expect(g.file).toBe("svc.ts");
    expect(g.nodes.length).toBeGreaterThan(0);
    expect(g.edges.filter((e) => e.kind === "CALLS")).toHaveLength(1);
  });

  it("incluye aristas FLOWS_TO (def-use)", () => {
    const g = analyzeGraph(`function f(name){ db.query(name); }`, "svc.ts");
    expect(
      g.edges.filter((e) => e.kind === "FLOWS_TO").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("incluye aristas BINDS_TO inter-procedurales", () => {
    const g = analyzeGraph(
      `function sink(q){ db.query(q); } function h(name){ sink(name); }`,
      "svc.ts",
    );
    expect(
      g.edges.filter((e) => e.kind === "BINDS_TO").length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("SANITIZED_BY", () => {
  it("marca la arista que sale de la llamada de saneamiento", () => {
    const graph = analyzeGraph(
      `function handler(input) {
  const safe = sanitize(input);
  db.query(safe);
}`,
      "a.ts",
    );
    const sanitizeCall = graph.nodes.find(
      (n) => n.kind === "Call" && n.name === "sanitize",
    )!;
    const out = graph.edges.filter((e) => e.from === sanitizeCall.id);
    expect(out).not.toHaveLength(0);
    expect(out.every((e) => e.kind === "SANITIZED_BY")).toBe(true);

    // La entrada al sanitizer sigue siendo flujo normal.
    expect(
      graph.edges.some((e) => e.to === sanitizeCall.id && e.kind === "FLOWS_TO"),
    ).toBe(true);
  });

  it("no altera un grafo sin sanitizers", () => {
    const graph = analyzeGraph(
      `function handler(input) {
  db.query(input);
}`,
      "a.ts",
    );
    expect(graph.edges.some((e) => e.kind === "SANITIZED_BY")).toBe(false);
  });
});
