import { readFileSync } from "node:fs";
import path from "node:path";
import { discoverFiles } from "../../scan/files.js";
import { scanSource } from "../../scan/scan.js";
import { DEFAULT_IGNORE } from "../../scan/types.js";
import { fetchAndExtract, looksMinified } from "./packages.js";
import type {
  CveCase,
  CveCaseResult,
  CveMetrics,
  CveReport,
} from "./types.js";

const MAX_FILE_BYTES = 300_000;
const MAX_FILES_PER_PACKAGE = 400;

/** Carpetas de build: contienen código generado, no fuente del autor. */
const CVE_IGNORE = [...DEFAULT_IGNORE, "bundles", "umd", "esm", "cjs", "min"];

export interface PackageScanSummary {
  findings: number;
  files: number;
  lines: number;
}

/** Escanea un paquete extraído contando solo hallazgos del CWE indicado. */
export function scanPackage(dir: string, cwe: number): PackageScanSummary {
  const files = discoverFiles(dir, {
    ignore: CVE_IGNORE,
    maxFileBytes: MAX_FILE_BYTES,
  }).slice(0, MAX_FILES_PER_PACKAGE);

  let findings = 0;
  let lines = 0;
  let scanned = 0;

  for (const abs of files) {
    let code: string;
    try {
      code = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(dir, abs);
    if (looksMinified(code, rel)) continue;
    scanned++;
    try {
      const result = scanSource(code, rel, { cwe: [cwe] });
      findings += result.findings.length;
      lines += result.lineCount;
    } catch {
      // Un archivo que no parsea no invalida el paquete entero.
    }
  }

  return { findings, files: scanned, lines };
}

/**
 * Evalúa un caso: escanea la versión vulnerable y la corregida.
 *
 * `detected` = reportó algo del CWE del advisory en la versión vulnerable.
 * `discriminated` = además, el arreglo del mantenedor hizo bajar ese número.
 * Lo segundo es la evidencia fuerte: sugiere que el hallazgo se relaciona con
 * la vulnerabilidad y no es ruido presente en todo el paquete.
 */
export async function runCveCase(
  testCase: CveCase,
  cacheRoot: string,
): Promise<CveCaseResult> {
  const started = performance.now();
  const base: CveCaseResult = {
    ghsaId: testCase.ghsaId,
    cveId: testCase.cveId,
    package: testCase.package,
    cwe: testCase.cwe,
    vulnerableVersion: testCase.vulnerableVersion,
    fixedVersion: testCase.fixedVersion,
    outcome: "error",
    findingsVulnerable: 0,
    findingsFixed: 0,
    discriminated: false,
    filesScanned: 0,
    linesScanned: 0,
    elapsedMs: 0,
  };

  try {
    const vulnPkg = await fetchAndExtract(
      testCase.package,
      testCase.vulnerableVersion,
      cacheRoot,
    );
    const fixedPkg = await fetchAndExtract(
      testCase.package,
      testCase.fixedVersion,
      cacheRoot,
    );

    const vuln = scanPackage(vulnPkg.dir, testCase.cwe);
    const fixed = scanPackage(fixedPkg.dir, testCase.cwe);

    return {
      ...base,
      outcome: vuln.findings > 0 ? "detected" : "missed",
      findingsVulnerable: vuln.findings,
      findingsFixed: fixed.findings,
      discriminated: vuln.findings > 0 && fixed.findings < vuln.findings,
      filesScanned: vuln.files,
      linesScanned: vuln.lines,
      elapsedMs: performance.now() - started,
    };
  } catch (err) {
    return {
      ...base,
      elapsedMs: performance.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function computeCveMetrics(results: CveCaseResult[]): CveMetrics {
  const errors = results.filter((r) => r.outcome === "error").length;
  const detected = results.filter((r) => r.outcome === "detected").length;
  const missed = results.filter((r) => r.outcome === "missed").length;
  const discriminated = results.filter((r) => r.discriminated).length;
  const evaluated = detected + missed;
  return {
    total: results.length,
    evaluated,
    detected,
    missed,
    errors,
    discriminated,
    detectionRate: evaluated === 0 ? 0 : detected / evaluated,
    discriminationRate: detected === 0 ? 0 : discriminated / detected,
  };
}

export async function runCveBenchmark(
  cases: CveCase[],
  cacheRoot: string,
  onProgress?: (done: number, total: number, result: CveCaseResult) => void,
): Promise<CveReport> {
  const results: CveCaseResult[] = [];
  for (const testCase of cases) {
    const result = await runCveCase(testCase, cacheRoot);
    results.push(result);
    onProgress?.(results.length, cases.length, result);
  }

  const byCwe: Record<number, { evaluated: number; detected: number }> = {};
  for (const r of results) {
    if (r.outcome === "error") continue;
    const entry = byCwe[r.cwe] ?? { evaluated: 0, detected: 0 };
    entry.evaluated++;
    if (r.outcome === "detected") entry.detected++;
    byCwe[r.cwe] = entry;
  }

  return {
    analyzedAt: new Date().toISOString(),
    results,
    metrics: computeCveMetrics(results),
    byCwe,
  };
}

export function formatCveReport(report: CveReport): string {
  const out: string[] = [];
  const m = report.metrics;

  out.push("ID                     Paquete                        CWE  vuln→fix        Resultado");
  out.push("─".repeat(96));
  for (const r of report.results) {
    const versions = `${r.vulnerableVersion}→${r.fixedVersion}`;
    const verdict = r.outcome === "error"
      ? `error: ${(r.error ?? "").slice(0, 30)}`
      : r.outcome === "detected"
        ? `detectado (${r.findingsVulnerable}→${r.findingsFixed})${r.discriminated ? " *" : ""}`
        : "no detectado";
    out.push(
      `${r.ghsaId.padEnd(22)} ${r.package.slice(0, 30).padEnd(30)} ${String(r.cwe).padEnd(4)} ${versions.padEnd(15)} ${verdict}`,
    );
  }

  out.push("");
  out.push("── Métricas sobre vulnerabilidades reales ──");
  out.push(`Casos totales: ${m.total}  ·  evaluados: ${m.evaluated}  ·  errores: ${m.errors}`);
  out.push(`Detectados: ${m.detected}  ·  no detectados: ${m.missed}`);
  out.push(`Tasa de detección: ${(m.detectionRate * 100).toFixed(1)}%`);
  out.push(
    `Discriminación (el fix baja el conteo): ${m.discriminated}/${m.detected}`
    + ` = ${(m.discriminationRate * 100).toFixed(1)}%`,
  );
  out.push("");
  out.push("Por CWE:");
  for (const [cwe, v] of Object.entries(report.byCwe)) {
    const rate = v.evaluated === 0 ? 0 : (v.detected / v.evaluated) * 100;
    out.push(`  CWE-${cwe}: ${v.detected}/${v.evaluated} (${rate.toFixed(1)}%)`);
  }
  out.push("");
  out.push("* = el arreglo del mantenedor eliminó al menos un hallazgo.");
  return out.join("\n");
}
