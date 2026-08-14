import { describe, it, expect } from "vitest";
import { analyzeGraph, reaches } from "../index.js";
import { analyzeTaint } from "../taint/analyzer.js";
import type { IRCall, IRNode } from "../ir/types.js";

/** Sink sintético: la llamada `db.query(...)`. */
function sinkNode(nodes: IRNode[]) {
  return nodes.find(
    (n): n is IRCall => n.kind === "Call" && n.callee === "db.query",
  )!;
}

/** Source sintético: el parámetro de entrada de usuario `input`. */
function sourceNode(nodes: IRNode[]) {
  return nodes.find((n) => n.kind === "Parameter" && n.name === "input")!;
}

describe("validación temprana — alcanzabilidad source ⇝ sink", () => {
  it("Caso A (vulnerable, intra-procedural): input ⇝ db.query", () => {
    const g = analyzeGraph(
      `function handler(input){ const q = input; db.query(q); }`,
      "caseA.ts",
    );
    const source = sourceNode(g.nodes);
    const sink = sinkNode(g.nodes);
    expect(reaches(g, source.id, sink.id)).toBe(true);
    expect(analyzeTaint(g)).toHaveLength(1);
  });

  it("Caso B (vulnerable, inter-procedural): cruza función vía BINDS_TO", () => {
    const g = analyzeGraph(
      `function sink(q){ db.query(q); } function handler(input){ sink(input); }`,
      "caseB.ts",
    );
    const source = sourceNode(g.nodes);
    const sink = sinkNode(g.nodes);
    expect(reaches(g, source.id, sink.id)).toBe(true);
    expect(analyzeTaint(g)).toHaveLength(1);
  });

  it("Caso C (no vulnerable): el sink no consume el dato tainted", () => {
    const g = analyzeGraph(
      `function handler(input){ db.query("SELECT 1"); }`,
      "caseC.ts",
    );
    const source = sourceNode(g.nodes);
    const sink = sinkNode(g.nodes);
    expect(source).toBeDefined();
    expect(sink).toBeDefined();
    expect(reaches(g, source.id, sink.id)).toBe(false);
    expect(analyzeTaint(g)).toHaveLength(0);
  });
});
