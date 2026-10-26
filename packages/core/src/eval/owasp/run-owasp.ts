import { readFileSync } from "node:fs";
import path from "node:path";
import { scanSource } from "../../scan/scan-files.js";
import type { ScanOptions } from "../../scan/types.js";

/**
 * OWASP Benchmark para Java (v1.2): 2740 servlets de prueba, cada uno
 * etiquetado en `expectedresults-1.2.csv` como vulnerable o no. Los casos no
 * vulnerables están armados para engañar a un análisis que no sigue el valor
 * (una rama que no corre, la clave equivocada de un mapa); los vulnerables,
 * para exigir seguir el dato por colecciones, `StringBuilder` y métodos.
 *
 * Se evalúan las cuatro categorías del catálogo; cada archivo se analiza solo,
 * como en la web. La métrica del Benchmark es TPR − FPR («score»).
 */

export const OWASP_BENCHMARK = {
  repository: "https://github.com/OWASP-Benchmark/BenchmarkJava.git",
  commit: "c3379bd3a2cd09c41f14324dae3cdc54c6eb3de8",
} as const;

/** Categoría del Benchmark → familia del catálogo. */
export const OWASP_CATEGORIES: Record<string, number> = { cmdi: 78, sqli: 89, xss: 79, pathtraver: 22 };

export interface OwaspCase {
  name: string;
  category: string;
  vulnerable: boolean;
}

export interface OwaspScore {
  category: string;
  tp: number;
  fn: number;
  fp: number;
  tn: number;
}

export function parseExpected(csv: string): OwaspCase[] {
  return csv
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.split(","))
    .filter(([, category]) => category !== undefined && category in OWASP_CATEGORIES)
    .map(([name, category, real]) => ({ name: name!, category: category!, vulnerable: real === "true" }));
}

/** Matriz de confusión por categoría; `detects` dice si el caso da un hallazgo de su familia. */
export function scoreOwasp(cases: readonly OwaspCase[], detects: (c: OwaspCase) => boolean): OwaspScore[] {
  const byCategory = new Map<string, OwaspScore>();
  for (const c of cases) {
    const s = byCategory.get(c.category) ?? { category: c.category, tp: 0, fn: 0, fp: 0, tn: 0 };
    const hit = detects(c);
    if (c.vulnerable) s[hit ? "tp" : "fn"]++;
    else s[hit ? "fp" : "tn"]++;
    byCategory.set(c.category, s);
  }
  return [...byCategory.values()];
}

export const tprOf = (s: Pick<OwaspScore, "tp" | "fn">) => s.tp / Math.max(s.tp + s.fn, 1);
export const fprOf = (s: Pick<OwaspScore, "fp" | "tn">) => s.fp / Math.max(s.fp + s.tn, 1);

export function runOwasp(root: string, sources: NonNullable<ScanOptions["sources"]>): OwaspScore[] {
  const cases = parseExpected(readFileSync(path.join(root, "expectedresults-1.2.csv"), "utf8"));
  const dir = path.join(root, "src/main/java/org/owasp/benchmark/testcode");
  return scoreOwasp(cases, (c) => {
    const result = scanSource(readFileSync(path.join(dir, `${c.name}.java`), "utf8"), `${c.name}.java`, { sources });
    return !result.error && result.findings.some((f) => f.cwe === OWASP_CATEGORIES[c.category]);
  });
}

export function formatOwasp(scores: readonly OwaspScore[]): string {
  const total = scores.reduce((t, s) => ({ tp: t.tp + s.tp, fn: t.fn + s.fn, fp: t.fp + s.fp, tn: t.tn + s.tn }), { tp: 0, fn: 0, fp: 0, tn: 0 });
  const row = (name: string, s: Omit<OwaspScore, "category">) => {
    const tpr = tprOf(s);
    const fpr = fprOf(s);
    return [name, s.tp, s.fn, s.fp, s.tn, tpr.toFixed(3), fpr.toFixed(3), (tpr - fpr).toFixed(3)].join("\t");
  };
  return [
    ["Categoría", "TP", "FN", "FP", "TN", "TPR", "FPR", "Score"].join("\t"),
    ...scores.map((s) => row(s.category, s)),
    row("Total", total),
  ].join("\n");
}
