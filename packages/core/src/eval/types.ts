/** Etiqueta de ground truth por snippet. */
export type BenchmarkLabel = "vulnerable" | "safe";

export interface BenchmarkCase {
  id: string;
  title: string;
  label: BenchmarkLabel;
  code: string;
  file?: string;
  cwe?: string;
  tags?: string[];
  /** Mínimo de findings esperados si label=vulnerable (default 1). */
  minFindings?: number;
  /** Máximo de findings esperados si label=vulnerable (opcional). */
  maxFindings?: number;
}

export type Classification = "TP" | "FP" | "TN" | "FN";

export interface BenchmarkCaseResult {
  id: string;
  title: string;
  label: BenchmarkLabel;
  findings: number;
  predicted: BenchmarkLabel;
  classification: Classification;
  correct: boolean;
  elapsedMs: number;
  lineCount: number;
  cwe?: string;
  tags?: string[];
}

export interface BenchmarkMetrics {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  totalCases: number;
  totalFindings: number;
  totalElapsedMs: number;
  msPerLine: number;
}

export interface BenchmarkReport {
  analyzedAt: string;
  cases: BenchmarkCaseResult[];
  metrics: BenchmarkMetrics;
}
