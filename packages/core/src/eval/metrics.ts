import type {
  BenchmarkCaseResult,
  BenchmarkLabel,
  BenchmarkMetrics,
  Classification,
} from "./types.js";

/**
 * Predicción del analizador: vulnerable ⟺ reportó al menos un hallazgo.
 *
 * NO recibe la etiqueta real. La versión anterior sí la recibía y ramificaba
 * sobre ella, lo que constituye fuga de etiqueta (label leakage): las métricas
 * dejaban de medir al analizador. El chequeo de `minFindings`/`maxFindings`
 * se reporta aparte, en `countWithinRange`, sin contaminar la matriz de
 * confusión.
 */
export function predictLabel(findings: number): BenchmarkLabel {
  return findings > 0 ? "vulnerable" : "safe";
}

/** ¿La cantidad de hallazgos cae en el rango esperado del caso? */
export function countWithinRange(
  findings: number,
  minFindings = 1,
  maxFindings = Number.POSITIVE_INFINITY,
): boolean {
  return findings >= minFindings && findings <= maxFindings;
}

export function classify(
  label: BenchmarkLabel,
  predicted: BenchmarkLabel,
): Classification {
  if (label === "vulnerable" && predicted === "vulnerable") return "TP";
  if (label === "safe" && predicted === "vulnerable") return "FP";
  if (label === "safe" && predicted === "safe") return "TN";
  return "FN";
}

export function computeMetrics(results: BenchmarkCaseResult[]): BenchmarkMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let totalFindings = 0;
  let totalElapsedMs = 0;
  let totalLines = 0;

  for (const r of results) {
    if (r.classification === "TP") tp++;
    else if (r.classification === "FP") fp++;
    else if (r.classification === "TN") tn++;
    else fn++;
    totalFindings += r.findings;
    totalElapsedMs += r.elapsedMs;
    totalLines += r.lineCount;
  }

  // Sin predicciones positivas la precisión es indefinida, no perfecta.
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = results.length === 0 ? 0 : (tp + tn) / results.length;

  return {
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1,
    accuracy,
    totalCases: results.length,
    totalFindings,
    totalElapsedMs,
    msPerLine: totalLines === 0 ? 0 : totalElapsedMs / totalLines,
  };
}

export function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
