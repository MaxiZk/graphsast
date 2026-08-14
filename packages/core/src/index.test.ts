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
