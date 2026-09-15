import { describe, it, expect } from "vitest";
import { scanSource } from "../scan.js";
import type { ScanResult } from "../types.js";
import { reportToText } from "./text.js";
import { reportToSarif } from "./sarif.js";

const ESC = String.fromCharCode(27);

function resultOf(code: string, file = "a.js"): ScanResult {
  const fileResult = scanSource(code, file);
  return {
    analyzedAt: new Date().toISOString(),
    root: "/proyecto",
    files: [fileResult],
    findings: fileResult.findings,
    totals: {
      files: 1,
      filesWithFindings: fileResult.findings.length > 0 ? 1 : 0,
      findings: fileResult.findings.length,
      lines: fileResult.lineCount,
      elapsedMs: fileResult.elapsedMs,
      errors: 0,
    },
  };
}

const VULN = "function h(req){\n  const q = req.body;\n  db.query(q);\n}";

describe("reportToText", () => {
  it("incluye archivo, CWE y linea del sink", () => {
    const text = reportToText(resultOf(VULN));
    expect(text).toContain("a.js");
    expect(text).toContain("CWE-89");
    expect(text).toContain("a.js:3:3");
  });

  it("sin color no emite secuencias ANSI", () => {
    expect(reportToText(resultOf(VULN), { color: false }).includes(ESC)).toBe(false);
  });

  it("con color emite secuencias ANSI", () => {
    expect(reportToText(resultOf(VULN), { color: true }).includes(ESC)).toBe(true);
  });

  it("informa explicitamente cuando no hay hallazgos", () => {
    const text = reportToText(resultOf('db.query("SELECT 1");'));
    expect(text).toContain("Sin hallazgos");
  });

  it("showPath false muestra solo source y sink", () => {
    const full = reportToText(resultOf(VULN), { showPath: true });
    const brief = reportToText(resultOf(VULN), { showPath: false });
    expect(full.split("\n").length).toBeGreaterThan(brief.split("\n").length);
  });
});

describe("reportToSarif", () => {
  it("produce SARIF 2.1.0 valido con reglas referenciadas", () => {
    const sarif = JSON.parse(reportToSarif(resultOf(VULN)));
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0];
    expect(run.tool.driver.name).toBe("GraphSAST");
    const ruleIds = new Set(run.tool.driver.rules.map((r: { id: string }) => r.id));
    for (const res of run.results) {
      expect(ruleIds.has(res.ruleId)).toBe(true);
    }
  });

  it("emite el camino de taint como codeFlows", () => {
    const sarif = JSON.parse(reportToSarif(resultOf(VULN)));
    const flow = sarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations;
    expect(flow).toHaveLength(3);
    expect(flow[0].location.physicalLocation.region.startLine).toBe(1);
    expect(flow[2].location.physicalLocation.region.startLine).toBe(3);
  });

  it("usa rutas con separador POSIX", () => {
    const sarif = JSON.parse(reportToSarif(resultOf(VULN, "src\\routes\\a.js")));
    const uri = sarif.runs[0].results[0].locations[0].physicalLocation
      .artifactLocation.uri;
    expect(uri).toBe("src/routes/a.js");
  });
});
