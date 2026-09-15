import { describe, it, expect } from "vitest";
import { analyzeGraph, analyzeTaint, buildAnalysisReport } from "../index.js";
import { reportToHtml } from "./html.js";

describe("report", () => {
  it("genera informe HTML con CWE y código", () => {
    const code = `function handler(input){ db.query(input); }`;
    const graph = analyzeGraph(code, "t.ts");
    const findings = analyzeTaint(graph);
    const report = buildAnalysisReport({
      code,
      file: "t.ts",
      engine: "memory",
      findings,
      graph,
      elapsedMs: 5,
    });
    const html = reportToHtml(report);
    expect(html).toContain("GraphSAST");
    expect(html).toContain("CWE-89");
    expect(html).toContain("db.query");
  });
});
