import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadCatalogBundle } from "../../catalog/load.js";
import { discoverFiles } from "../../scan/files.js";
import { scanPaths } from "../../scan/scan.js";
import type { ScanOptions } from "../../scan/types.js";
import { baselineScan } from "../baseline/pattern-baseline.js";

/**
 * Validación sobre OWASP NodeGoat con vulnerabilidades etiquetadas antes de
 * ejecutar los detectores (eval-nodegoat.json). GraphSAST y la línea de base
 * se miden con la misma regla de conteo.
 */

export interface LabeledVulnerability {
  id: string;
  owasp: string;
  cwe: number;
  catalogFamily: number;
  description: string;
  sinkFile: string;
  sinkLines: [number, number];
  sinkInCatalog: boolean;
}

export interface NodeGoatManifest {
  repository: string;
  commit: string;
  scan: { exclude: string[] };
  vulnerabilities: LabeledVulnerability[];
}

/** Hallazgo normalizado: archivo relativo a la raíz de NodeGoat, línea del sink y CWE. */
export interface LocatedFinding {
  file: string;
  line: number;
  cwe?: number;
  code: string;
}

export interface VulnerabilityOutcome {
  id: string;
  detected: boolean;
  sinkInCatalog: boolean;
  matchedBy: LocatedFinding[];
}

export interface DetectorResult {
  detector: "GraphSAST" | "Línea de base";
  tp: number;
  fn: number;
  recall: number;
  outcomes: VulnerabilityOutcome[];
  /** Hallazgos que no coinciden con ninguna etiqueta: se revisan a mano. */
  unmatched: LocatedFinding[];
  totalFindings: number;
  elapsedMs: number;
}

/**
 * Regla de conteo del manifiesto: un hallazgo cuenta para una vulnerabilidad
 * si está en el archivo del destino y su línea cae dentro del rango. Cada
 * vulnerabilidad cuenta una sola vez; lo que no coincide queda para revisión.
 */
export function matchFindings(
  vulns: LabeledVulnerability[],
  findings: LocatedFinding[],
): { outcomes: VulnerabilityOutcome[]; unmatched: LocatedFinding[] } {
  const used = new Set<LocatedFinding>();
  const outcomes = vulns.map((v) => {
    const matchedBy = findings.filter(
      (f) => f.file === v.sinkFile && f.line >= v.sinkLines[0] && f.line <= v.sinkLines[1],
    );
    matchedBy.forEach((f) => used.add(f));
    return { id: v.id, detected: matchedBy.length > 0, sinkInCatalog: v.sinkInCatalog, matchedBy };
  });
  return { outcomes, unmatched: findings.filter((f) => !used.has(f)) };
}

function summarize(
  detector: DetectorResult["detector"],
  vulns: LabeledVulnerability[],
  findings: LocatedFinding[],
  elapsedMs: number,
): DetectorResult {
  const { outcomes, unmatched } = matchFindings(vulns, findings);
  const tp = outcomes.filter((o) => o.detected).length;
  const fn = outcomes.length - tp;
  return {
    detector,
    tp,
    fn,
    recall: outcomes.length === 0 ? 0 : tp / outcomes.length,
    outcomes,
    unmatched,
    totalFindings: findings.length,
    elapsedMs,
  };
}

/** Clona NodeGoat en el commit del manifiesto, o reutiliza la copia en caché. */
export function ensureCheckout(manifest: NodeGoatManifest, cacheRoot: string): string {
  const dir = path.join(cacheRoot, manifest.commit.slice(0, 12));
  const head = () =>
    spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  if (existsSync(path.join(dir, ".git")) && head() === manifest.commit) return dir;
  mkdirSync(cacheRoot, { recursive: true });
  const run = (args: string[]) => {
    const r = spawnSync("git", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  };
  if (!existsSync(path.join(dir, ".git"))) run(["clone", "--quiet", manifest.repository, dir]);
  run(["-C", dir, "checkout", "--quiet", manifest.commit]);
  if (head() !== manifest.commit) throw new Error(`No se pudo fijar el commit ${manifest.commit}`);
  return dir;
}

export function runNodeGoat(manifest: NodeGoatManifest, root: string): DetectorResult[] {
  const options: ScanOptions = { exclude: manifest.scan.exclude, gitignore: false };

  const t0 = performance.now();
  const scan = scanPaths([root], options);
  const graphMs = performance.now() - t0;
  const graphFindings: LocatedFinding[] = scan.findings.map((f) => ({
    file: f.file,
    line: f.sink.line,
    cwe: f.cwe,
    code: f.sink.code,
  }));

  const entries = loadCatalogBundle().entries;
  const t1 = performance.now();
  const baseFindings: LocatedFinding[] = [];
  for (const abs of discoverFiles(root, options)) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    for (const f of baselineScan(readFileSync(abs, "utf8"), entries)) {
      baseFindings.push({ file: rel, line: f.line, cwe: f.cwe, code: f.code });
    }
  }
  const baseMs = performance.now() - t1;

  return [
    summarize("Línea de base", manifest.vulnerabilities, baseFindings, baseMs),
    summarize("GraphSAST", manifest.vulnerabilities, graphFindings, graphMs),
  ];
}

export function formatNodeGoatReport(results: DetectorResult[], lines: number): string {
  const out: string[] = [];
  out.push(["Detector", "TP", "FN", "Exhaustividad", "Hallazgos", "Sin etiqueta", "ms"].join("\t"));
  for (const r of results) {
    out.push([
      r.detector, r.tp, r.fn, `${(r.recall * 100).toFixed(1)}%`,
      r.totalFindings, r.unmatched.length, r.elapsedMs.toFixed(0),
    ].join("\t"));
  }
  out.push("", `Líneas analizadas: ${lines}`, "");
  const ids = results[0]?.outcomes.map((o) => o.id) ?? [];
  out.push(["Vulnerabilidad", "Sink en catálogo", ...results.map((r) => r.detector)].join("\t"));
  for (const id of ids) {
    const inCat = results[0]!.outcomes.find((o) => o.id === id)!.sinkInCatalog;
    out.push([id, inCat ? "sí" : "no", ...results.map((r) =>
      r.outcomes.find((o) => o.id === id)!.detected ? "detectada" : "no")].join("\t"));
  }
  for (const r of results) {
    out.push("", `Hallazgos sin etiqueta de ${r.detector} (revisar a mano): ${r.unmatched.length}`);
    for (const f of r.unmatched) {
      out.push(`  ${f.file}:${f.line}\tCWE-${f.cwe ?? "?"}\t${f.code.slice(0, 90)}`);
    }
  }
  return out.join("\n");
}
