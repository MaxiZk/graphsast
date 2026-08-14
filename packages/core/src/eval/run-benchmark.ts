import { analyzeGraph, analyzeTaint } from "../index.js";
import type { BenchmarkCase, BenchmarkCaseResult, BenchmarkReport } from "./types.js";
import { BENCHMARK_CORPUS } from "./benchmark/corpus.js";
import { classify, computeMetrics, predictLabel } from "./metrics.js";

function lineCount(code: string): number {
  return code.split("\n").length;
}

export function runCase(testCase: BenchmarkCase): BenchmarkCaseResult {
  const file = testCase.file ?? `${testCase.id.toLowerCase()}.ts`;
  const t0 = performance.now();
  const graph = analyzeGraph(testCase.code, file);
  const findings = analyzeTaint(graph);
  const elapsedMs = performance.now() - t0;

  const min = testCase.minFindings ?? 1;
  const max = testCase.maxFindings ?? Number.POSITIVE_INFINITY;
  const predicted = predictLabel(findings.length, testCase.label, min, max);
  const classification = classify(testCase.label, predicted);

  return {
    id: testCase.id,
    title: testCase.title,
    label: testCase.label,
    findings: findings.length,
    predicted,
    classification,
    correct: classification === "TP" || classification === "TN",
    elapsedMs,
    lineCount: lineCount(testCase.code),
    cwe: testCase.cwe,
    tags: testCase.tags,
  };
}

/** Ejecuta el banco de pruebas y devuelve métricas agregadas. */
export function runBenchmark(
  corpus: BenchmarkCase[] = BENCHMARK_CORPUS,
): BenchmarkReport {
  const cases = corpus.map(runCase);
  return {
    analyzedAt: new Date().toISOString(),
    cases,
    metrics: computeMetrics(cases),
  };
}

export function formatReportTable(report: BenchmarkReport): string {
  const header = [
    "ID",
    "Título",
    "Esperado",
    "Findings",
    "Clase",
    "OK",
    "ms",
  ].join("\t");
  const rows = report.cases.map((c: BenchmarkCaseResult) =>
  [
    c.id,
    c.title,
    c.label,
    String(c.findings),
    c.classification,
    c.correct ? "✓" : "✗",
    c.elapsedMs.toFixed(1),
  ].join("\t"),
  );
  const m = report.metrics;
  const summary = [
    "",
    "── Métricas (clasificación por snippet) ──",
    `TP=${m.tp}  FP=${m.fp}  TN=${m.tn}  FN=${m.fn}`,
    `Precisión=${(m.precision * 100).toFixed(1)}%  Recall=${(m.recall * 100).toFixed(1)}%  F1=${(m.f1 * 100).toFixed(1)}%  Accuracy=${(m.accuracy * 100).toFixed(1)}%`,
    `Tiempo total=${m.totalElapsedMs.toFixed(1)}ms  ms/línea=${m.msPerLine.toFixed(2)}`,
  ].join("\n");
  return [header, ...rows, summary].join("\n");
}
