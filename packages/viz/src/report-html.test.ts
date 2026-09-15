import { describe, it, expect } from "vitest";
import { reportToHtml, type VizAnalysisReport } from "./report-html.js";

function report(overrides: Partial<VizAnalysisReport> = {}): VizAnalysisReport {
  return {
    analyzedAt: "2026-09-15T00:00:00.000Z",
    engine: "memory",
    code: "db.query(x);",
    file: "demo.ts",
    findings: [],
    stats: {
      elapsedMs: 5,
      lineCount: 1,
      nodeCount: 1,
      edgeCount: 1,
      findingCount: 0,
    },
    ...overrides,
  };
}

function finding(cwe: number) {
  return { sourceId: "a", sinkId: "b", path: ["a", "b"], sanitized: false, cwe };
}

describe("reportToHtml — concordancia de número", () => {
  it("un hallazgo va en singular", () => {
    const html = reportToHtml(report({ findings: [finding(89)] }));
    expect(html).toContain("<strong>1 vulnerabilidad</strong> detectada.");
  });

  it("varios hallazgos van en plural", () => {
    const html = reportToHtml(
      report({ findings: [finding(89), finding(943), finding(79)] }),
    );
    expect(html).toContain("<strong>3 vulnerabilidades</strong> detectadas.");
  });

  it("la línea de métricas concuerda en singular", () => {
    const html = reportToHtml(report());
    expect(html).toContain("1 línea · 1 nodo · 1 arista");
  });

  it("la línea de métricas concuerda en plural", () => {
    const html = reportToHtml(
      report({ stats: { elapsedMs: 5, lineCount: 4, nodeCount: 6, edgeCount: 2, findingCount: 0 } }),
    );
    expect(html).toContain("4 líneas · 6 nodos · 2 aristas");
  });

  it("no queda ningún «(s)» sin resolver", () => {
    for (const r of [report(), report({ findings: [finding(89)] })]) {
      expect(reportToHtml(r)).not.toMatch(/\(e?s\)/);
    }
  });
});
