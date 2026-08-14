import { describe, it, expect } from "vitest";
import { analyzeGraph, analyzeTaint } from "../index.js";
import { analyzeInMemory, analyzeWithEngine } from "./analyze.js";

describe("engine/analyze", () => {
  const code = `function handler(input){ const q = input; db.query(q); }`;

  it("memoria: detecta SQLi intra-procedural", () => {
    const g = analyzeGraph(code, "a.ts");
    expect(analyzeInMemory(g)).toHaveLength(1);
  });

  it("sin driver Neo4j usa motor memory", async () => {
    const g = analyzeGraph(code, "a.ts");
    const result = await analyzeWithEngine(g);
    expect(result.engine).toBe("memory");
    expect(result.findings).toHaveLength(1);
  });

  it("findings enriquecidos con CWE-89", () => {
    const g = analyzeGraph(code, "a.ts");
    const [f] = analyzeTaint(g);
    expect(f?.cwe).toBe(89);
    expect(f?.cweName).toContain("SQL");
  });
});
