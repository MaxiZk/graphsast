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

describe("report — concordancia de número", () => {
  function htmlFor(code: string) {
    const graph = analyzeGraph(code, "t.ts");
    const findings = analyzeTaint(graph);
    return reportToHtml(
      buildAnalysisReport({
        code,
        file: "t.ts",
        engine: "memory",
        findings,
        graph,
        elapsedMs: 5,
      }),
    );
  }

  it("un hallazgo va en singular", () => {
    const html = htmlFor(`function handler(input){ db.query(input); }`);
    expect(html).toContain("<strong>1 vulnerabilidad</strong> detectada.");
  });

  it("varios hallazgos van en plural", () => {
    const html = htmlFor(`function postFinances(req, res) {
  const data = req.body;
  Finance.create(data);
}
function putFinance(req, res) {
  const id = req.params.id;
  const data = req.body;
  Finance.findByIdAndUpdate(id, data);
}
function deleteFinance(req, res) {
  Finance.findByIdAndDelete(req.params.id);
}`);
    expect(html).toContain("<strong>3 vulnerabilidades</strong> detectadas.");
  });

  it("la línea de métricas concuerda con una sola línea de código", () => {
    const html = htmlFor(`db.query(x);`);
    expect(html).toContain("1 línea ·");
    expect(html).not.toContain("1 líneas");
  });

  it("no queda ningún «(s)» sin resolver en el informe", () => {
    const html = htmlFor(`function handler(input){ db.query(input); }`);
    expect(html).not.toMatch(/\(e?s\)/);
  });
});
