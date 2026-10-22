import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCatalogBundle } from "../../catalog/load.js";
import { discoverFiles } from "../../scan/files.js";
import { scanPaths } from "../../scan/scan.js";
import type { ScanOptions } from "../../scan/types.js";
import { baselineScan } from "../baseline/pattern-baseline.js";
import { ensureCheckout } from "../nodegoat/run-nodegoat.js";

/**
 * Evaluación sobre proyectos de GitHub (eval-github.json): aplicaciones
 * vulnerables a propósito con vulnerabilidades etiquetadas antes de correr el
 * analizador, y proyectos normales donde toda alerta es una falsa alarma salvo
 * revisión. Se mide con los dos modelos de entrada y con la línea de base.
 */

export type SourcesMode = NonNullable<ScanOptions["sources"]>;
/** Los dos modelos de entrada de GraphSAST, o la línea de base por patrones. */
export type EvalMode = SourcesMode | "baseline";

export interface GithubVulnerability {
  id: string;
  /** null en los controles limpios. */
  cwe: number | null;
  /** Relativo a la carpeta analizada (root). */
  file: string;
  /** Sin línea: cuenta cualquier hallazgo de la familia en el archivo. */
  line?: number;
  description: string;
  /** Fuera del alcance (por ejemplo, en una plantilla): no se cuenta. */
  outOfScope?: string;
}

export interface ReviewedSink {
  file: string;
  line: number;
  note: string;
}

export interface GithubProject {
  id: string;
  repository: string;
  commit: string;
  kind: "vulnerable" | "banco" | "normal";
  /** Subcarpeta del repositorio que se analiza. */
  root?: string;
  exclude: string[];
  vulnerabilities: GithubVulnerability[];
  /** Destinos sin etiqueta que la revisión manual consideró problemas reales. */
  reviewedReal: ReviewedSink[];
}

export interface GithubManifest {
  lineTolerance: number;
  projects: GithubProject[];
}

/** Hallazgo reducido a lo que usa la regla de conteo. */
export interface SinkFinding {
  file: string;
  line: number;
  cwe?: number;
}

export interface ProjectResult {
  id: string;
  mode: EvalMode;
  labeled: number;
  detected: string[];
  missed: string[];
  /** Destinos sin etiqueta revisados como reales. */
  realExtra: number;
  /**
   * Destinos sin etiqueta que no son problemas reales. En la línea de base
   * incluye destinos que la revisión manual (hecha sobre GraphSAST) no vio.
   */
  falseAlarms: SinkFinding[];
  findings: number;
  files: number;
  elapsedMs: number;
}

const counted = (v: GithubVulnerability): v is GithubVulnerability & { cwe: number } =>
  v.cwe !== null && !v.outOfScope;

/**
 * Regla de conteo del manifiesto: misma familia, mismo archivo y destino a
 * `tolerance` líneas o menos. Lo que no coincide se agrupa por destino y se
 * separa en reales revisados y falsas alarmas.
 */
export function classify(
  project: Pick<GithubProject, "vulnerabilities" | "reviewedReal">,
  findings: SinkFinding[],
  tolerance: number,
): Pick<ProjectResult, "labeled" | "detected" | "missed" | "realExtra" | "falseAlarms"> {
  const labels = project.vulnerabilities.filter(counted);
  const matches = (f: SinkFinding, v: GithubVulnerability) =>
    f.file === v.file && f.cwe === v.cwe && (v.line === undefined || Math.abs(f.line - v.line) <= tolerance);
  const detected = labels.filter((v) => findings.some((f) => matches(f, v))).map((v) => v.id);
  const sinks = new Map<string, SinkFinding>();
  for (const f of findings) {
    if (labels.some((v) => matches(f, v))) continue;
    const key = `${f.file}:${f.line}`;
    if (!sinks.has(key)) sinks.set(key, f);
  }
  const isReal = (f: SinkFinding) => project.reviewedReal.some((r) => r.file === f.file && r.line === f.line);
  const unmatched = [...sinks.values()];
  return {
    labeled: labels.length,
    detected,
    missed: labels.filter((v) => !detected.includes(v.id)).map((v) => v.id),
    realExtra: unmatched.filter(isReal).length,
    falseAlarms: unmatched.filter((f) => !isReal(f)),
  };
}

/** Misma selección de archivos que el escaneo, recorrida con la línea de base. */
function baselineFindings(root: string, options: ScanOptions): { findings: SinkFinding[]; files: number } {
  const entries = loadCatalogBundle().entries;
  const files = discoverFiles(root, options);
  const findings: SinkFinding[] = [];
  for (const abs of files) {
    const file = path.relative(root, abs).split(path.sep).join("/");
    for (const f of baselineScan(readFileSync(abs, "utf8"), entries)) findings.push({ file, line: f.line, cwe: f.cwe });
  }
  return { findings, files: files.length };
}

export function runGithubProject(project: GithubProject, checkout: string, mode: EvalMode, tolerance: number): ProjectResult {
  const root = path.join(checkout, project.root ?? "");
  const t0 = performance.now();
  let findings: SinkFinding[];
  let files: number;
  if (mode === "baseline") {
    ({ findings, files } = baselineFindings(root, { exclude: project.exclude }));
  } else {
    const scan = scanPaths([root], { exclude: project.exclude, sources: mode });
    findings = scan.findings.map((f) => ({ file: f.file, line: f.sink.line, cwe: f.cwe }));
    files = scan.totals.files;
  }
  const elapsedMs = performance.now() - t0;
  return {
    id: project.id,
    mode,
    ...classify(project, findings, tolerance),
    findings: findings.length,
    files,
    elapsedMs,
  };
}

export function runGithub(manifest: GithubManifest, cacheRoot: string, modes: EvalMode[]): ProjectResult[] {
  const results: ProjectResult[] = [];
  for (const project of manifest.projects) {
    const checkout = ensureCheckout(project, cacheRoot);
    for (const mode of modes) results.push(runGithubProject(project, checkout, mode, manifest.lineTolerance));
  }
  return results;
}

const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((n / d) * 100)}%`);

export function formatGithubReport(results: ProjectResult[]): string {
  const out: string[] = [];
  for (const mode of [...new Set(results.map((r) => r.mode))]) {
    out.push(`Modo ${mode}`, ["Proyecto", "Detectadas", "Reales extra", "Falsas alarmas", "Hallazgos", "Archivos", "ms"].join("\t"));
    const rows = results.filter((r) => r.mode === mode);
    for (const r of rows) {
      out.push([r.id, `${r.detected.length}/${r.labeled}`, r.realExtra, r.falseAlarms.length, r.findings, r.files, r.elapsedMs.toFixed(0)].join("\t"));
    }
    const sum = (k: (r: ProjectResult) => number) => rows.reduce((n, r) => n + k(r), 0);
    const det = sum((r) => r.detected.length);
    const labeled = sum((r) => r.labeled);
    const real = sum((r) => r.realExtra);
    const fp = sum((r) => r.falseAlarms.length);
    out.push(
      `Total\t${det}/${labeled} (${pct(det, labeled)})\t${real}\t${fp}`,
      `Precisión por destino: ${pct(det + real, det + real + fp)}`,
      `Omitidas: ${rows.flatMap((r) => r.missed).join(", ") || "ninguna"}`,
      "",
    );
  }
  return out.join("\n");
}
