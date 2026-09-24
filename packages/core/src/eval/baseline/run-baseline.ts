import { loadCatalogBundle } from "../../catalog/load.js";
import type { CweCatalogEntry } from "../../catalog/types.js";
import { BENCHMARK_CORPUS } from "../benchmark/corpus.js";
import { classify, computeMetrics, countWithinRange, formatPct, predictLabel } from "../metrics.js";
import { runBenchmark } from "../run-benchmark.js";
import type { BenchmarkCase, BenchmarkCaseResult, BenchmarkMetrics, BenchmarkReport } from "../types.js";
import { baselineScan } from "./pattern-baseline.js";

/** Mismo criterio que `runCase`: vulnerable ⟺ al menos un hallazgo. */
export function runBaselineCase(
  testCase: BenchmarkCase,
  entries: CweCatalogEntry[],
): BenchmarkCaseResult {
  const t0 = performance.now();
  const findings = baselineScan(testCase.code, entries);
  const elapsedMs = performance.now() - t0;

  const predicted = predictLabel(findings.length);
  const classification = classify(testCase.label, predicted);
  const countOk = testCase.label === "safe"
    ? findings.length === 0
    : countWithinRange(findings.length, testCase.minFindings ?? 1, testCase.maxFindings);

  return {
    id: testCase.id,
    title: testCase.title,
    label: testCase.label,
    findings: findings.length,
    predicted,
    classification,
    correct: classification === "TP" || classification === "TN",
    countOk,
    elapsedMs,
    lineCount: testCase.code.split("\n").length,
    cwe: testCase.cwe,
    tags: testCase.tags,
  };
}

export function runBaselineBenchmark(
  corpus: BenchmarkCase[] = BENCHMARK_CORPUS,
  entries: CweCatalogEntry[] = loadCatalogBundle().entries,
): BenchmarkReport {
  const cases = corpus.map((c) => runBaselineCase(c, entries));
  return { analyzedAt: new Date().toISOString(), cases, metrics: computeMetrics(cases) };
}

export interface ComparisonRow {
  id: string;
  title: string;
  label: BenchmarkCaseResult["label"];
  graph: BenchmarkCaseResult["classification"];
  baseline: BenchmarkCaseResult["classification"];
}

export interface Comparison {
  graph: BenchmarkMetrics;
  baseline: BenchmarkMetrics;
  /** Casos en los que los dos detectores clasifican distinto. */
  differences: ComparisonRow[];
}

export function compareWithBaseline(corpus: BenchmarkCase[] = BENCHMARK_CORPUS): Comparison {
  const graph = runBenchmark(corpus);
  const baseline = runBaselineBenchmark(corpus);
  const differences: ComparisonRow[] = [];
  graph.cases.forEach((g, i) => {
    const b = baseline.cases[i]!;
    if (g.classification !== b.classification) {
      differences.push({
        id: g.id,
        title: g.title,
        label: g.label,
        graph: g.classification,
        baseline: b.classification,
      });
    }
  });
  return { graph: graph.metrics, baseline: baseline.metrics, differences };
}

export function formatComparison(c: Comparison): string {
  const row = (name: string, m: BenchmarkMetrics) =>
    [name, m.tp, m.fp, m.tn, m.fn, formatPct(m.precision), formatPct(m.recall), formatPct(m.f1)].join("\t");
  const lines = [
    ["Detector", "TP", "FP", "TN", "FN", "Precisión", "Exhaustividad", "F1"].join("\t"),
    row("Línea de base", c.baseline),
    row("GraphSAST", c.graph),
    "",
    `Casos en los que difieren: ${c.differences.length}`,
    ...c.differences.map((d) =>
      `  ${d.id}\t${d.label}\tbase=${d.baseline}\tgrafo=${d.graph}\t${d.title}`),
  ];
  return lines.join("\n");
}
