import { readFileSync } from "node:fs";
import path from "node:path";
import { graphFromSourceFile } from "../index.js";
import { parseSource } from "../parser/parser.js";
import { analyzeTaint } from "../taint/analyzer.js";
import type { IRGraph, IRNode } from "../ir/types.js";
import type { TaintFinding } from "../taint/types.js";
import { discoverFiles, commonRoot } from "./files.js";
import type {
  ScanFinding,
  ScanFileResult,
  ScanOptions,
  ScanResult,
  ScanStep,
} from "./types.js";

function stepOf(node: IRNode | undefined): ScanStep {
  if (!node) {
    return { kind: "Variable", name: "?", code: "", line: 0, col: 0 };
  }
  return {
    kind: node.kind,
    name: node.name,
    code: node.code.replace(/\s+/g, " ").trim(),
    line: node.loc.line,
    col: node.loc.col,
  };
}

/** Convierte hallazgos con ids internos en hallazgos ubicables. */
export function toScanFindings(
  file: string,
  graph: IRGraph,
  findings: TaintFinding[],
): ScanFinding[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return findings.map((f) => ({
    file,
    cwe: f.cwe,
    cweName: f.cweName,
    ruleId: f.ruleId,
    source: stepOf(byId.get(f.sourceId)),
    sink: stepOf(byId.get(f.sinkId)),
    steps: f.path.map((id) => stepOf(byId.get(id))),
  }));
}

/** Analiza un único archivo ya leído. `relPath` se usa como identidad. */
export function scanSource(
  code: string,
  relPath: string,
  options: ScanOptions = {},
): ScanFileResult {
  const started = performance.now();
  const parsed = parseSource(code, relPath);

  // Un archivo que el parser no entiende no da «0 hallazgos»: da error. Sin
  // esto, pasarle Go o Python devolvía un verde indistinguible de un archivo
  // limpio, y en CI el exit code 0 lo daba por aprobado.
  if (parsed.syntaxErrors > 0) {
    const sample = parsed.messages[0] ? ` (${parsed.messages[0]})` : "";
    return {
      file: relPath,
      findings: [],
      lineCount: code.split("\n").length,
      nodeCount: 0,
      edgeCount: 0,
      elapsedMs: performance.now() - started,
      error:
        `No se pudo analizar: ${parsed.syntaxErrors} error(es) de sintaxis`
        + `. Solo se admite JavaScript/TypeScript${sample}`,
    };
  }

  const graph = graphFromSourceFile(parsed.sourceFile, relPath);
  const raw = analyzeTaint(graph, { maxDepth: options.maxDepth });
  const filtered = options.cwe?.length
    ? raw.filter((f) => f.cwe !== undefined && options.cwe!.includes(f.cwe))
    : raw;
  return {
    file: relPath,
    findings: toScanFindings(relPath, graph, filtered),
    lineCount: code.split("\n").length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    elapsedMs: performance.now() - started,
  };
}

/**
 * Escanea archivos y/o directorios.
 *
 * Alcance actual: el análisis de taint es **por archivo**. El flujo que cruza
 * módulos vía `import`/`require` todavía no se sigue (alcance ampliado).
 */
export function scanPaths(
  targets: string[],
  options: ScanOptions = {},
): ScanResult {
  const root = commonRoot(targets);
  const seen = new Set<string>();
  const files: string[] = [];
  for (const target of targets) {
    for (const file of discoverFiles(target, options)) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }

  const results: ScanFileResult[] = [];
  for (const abs of files) {
    const rel = path.relative(root, abs) || path.basename(abs);
    try {
      const code = readFileSync(abs, "utf8");
      results.push(scanSource(code, rel, options));
    } catch (err) {
      results.push({
        file: rel,
        findings: [],
        lineCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        elapsedMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const findings = results.flatMap((r) => r.findings);
  return {
    analyzedAt: new Date().toISOString(),
    root,
    files: results,
    findings,
    totals: {
      files: results.length,
      filesWithFindings: results.filter((r) => r.findings.length > 0).length,
      findings: findings.length,
      lines: results.reduce((n, r) => n + r.lineCount, 0),
      elapsedMs: results.reduce((n, r) => n + r.elapsedMs, 0),
      errors: results.filter((r) => r.error).length,
    },
  };
}
