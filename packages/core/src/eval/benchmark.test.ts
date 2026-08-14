import { describe, it, expect } from "vitest";
import { runBenchmark } from "./run-benchmark.js";
import { BENCHMARK_CORPUS, corpusStats } from "./benchmark/corpus.js";

describe("benchmark de validación cuantitativa", () => {
  const report = runBenchmark();

  it("corpus tiene al menos 10 casos etiquetados", () => {
    const stats = corpusStats();
    expect(stats.total).toBeGreaterThanOrEqual(10);
    expect(stats.vulnerable).toBeGreaterThan(0);
    expect(stats.safe).toBeGreaterThan(0);
  });

  it("todos los casos del corpus clasifican correctamente", () => {
    const failed = report.cases.filter((c) => !c.correct);
    if (failed.length > 0) {
      const detail = failed
        .map((c) => `${c.id}: esperado=${c.label}, findings=${c.findings}`)
        .join("; ");
      expect.fail(`Benchmark falló: ${detail}`);
    }
    expect(failed).toHaveLength(0);
  });

  it("métricas objetivo: precisión, recall y F1 al 100%", () => {
    const { precision, recall, f1, accuracy } = report.metrics;
    expect(precision).toBe(1);
    expect(recall).toBe(1);
    expect(f1).toBe(1);
    expect(accuracy).toBe(1);
  });

  it("tiempo de análisis razonable (< 50 ms/línea en corpus sintético)", () => {
    expect(report.metrics.msPerLine).toBeLessThan(50);
  });

  it("casos conocidos A–C siguen en el corpus", () => {
    const ids = new Set(BENCHMARK_CORPUS.map((c) => c.id));
    expect(ids.has("A")).toBe(true);
    expect(ids.has("B")).toBe(true);
    expect(ids.has("C")).toBe(true);
  });
});
