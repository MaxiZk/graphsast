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

  /**
   * Umbrales, no perfección. Exigir 100% obligaba a que el corpus solo
   * contuviera casos que ya pasaban: la suite era estructuralmente incapaz
   * de exponer una debilidad. Con umbral, se pueden incorporar casos duros
   * (y ver bajar la métrica) sin romper CI.
   */
  it("precisión y recall por encima del umbral acordado", () => {
    const { precision, recall } = report.metrics;
    expect(precision).toBeGreaterThanOrEqual(0.85);
    expect(recall).toBeGreaterThanOrEqual(0.85);
  });

  it("reporta qué casos fallan (diagnóstico, no umbral)", () => {
    const failed = report.cases.filter((c) => !c.correct);
    if (failed.length > 0) {
      console.warn(
        `Casos fallidos: ${failed
          .map((c) => `${c.id}(esperado=${c.label}, findings=${c.findings})`)
          .join(", ")}`,
      );
    }
    expect(failed.length).toBeLessThanOrEqual(Math.ceil(report.cases.length * 0.15));
  });

  it("los casos vulnerables reportan la cantidad esperada de hallazgos", () => {
    const offBy = report.cases.filter((c) => !c.countOk);
    expect(offBy.map((c) => c.id)).toEqual([]);
  });

  it("cubre los patrones que antes se perdían por matching textual", () => {
    const ids = new Set(BENCHMARK_CORPUS.map((c) => c.id));
    for (const id of ["M1", "M2", "M3", "M7", "M12", "N1"]) {
      expect(ids.has(id)).toBe(true);
    }
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
