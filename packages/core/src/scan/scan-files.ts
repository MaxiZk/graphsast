import { graphFromSourceFile } from "../ir/graph.js";
import { parseSource, type ParseResult } from "../parser/parser.js";
import { analyzeTaint } from "../taint/analyzer.js";
import type { IREdge, IRGraph, IRNode } from "../ir/types.js";
import type { TaintFinding } from "../taint/types.js";
import { extractLinks, projectIndexOf, type ModuleLinks } from "../project/links.js";
import { buildCrossModuleEdges, connectedComponents } from "../project/link.js";
import type {
  ScanFinding,
  ScanFileResult,
  ScanOptions,
  ScanResult,
  ScanStep,
} from "./types.js";

function stepOf(node: IRNode | undefined, fallbackFile: string): ScanStep {
  if (!node) {
    return { file: fallbackFile, kind: "Variable", name: "?", code: "", line: 0, col: 0 };
  }
  return {
    file: node.loc.file,
    kind: node.kind,
    // Un callee encadenado en varias líneas (`lines\n  .map`) queda en una.
    name: node.name.replace(/\s*\.\s*/g, ".").replace(/\s+/g, " ").trim(),
    code: node.code.replace(/\s+/g, " ").trim(),
    line: node.loc.line,
    col: node.loc.col,
    endLine: node.loc.endLine,
    endCol: node.loc.endCol,
  };
}

/**
 * Convierte hallazgos con ids internos en hallazgos ubicables. Cada paso
 * lleva su archivo; el hallazgo se asigna al archivo del sink.
 */
export function toScanFindings(
  file: string,
  graph: IRGraph,
  findings: TaintFinding[],
): ScanFinding[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return findings.map((f) => {
    const sink = stepOf(byId.get(f.sinkId), file);
    return {
      file: sink.file,
      cwe: f.cwe,
      cweName: f.cweName,
      ruleId: f.ruleId,
      source: stepOf(byId.get(f.sourceId), file),
      sink,
      steps: f.path.map((id) => stepOf(byId.get(id), file)),
    };
  });
}

// Un archivo que el parser no entiende no da «0 hallazgos»: da error. Sin
// esto, pasarle Go o Python devolvía un verde indistinguible de un archivo
// limpio, y en CI el exit code 0 lo daba por aprobado.
function syntaxErrorOf(parsed: ParseResult): string | null {
  if (parsed.syntaxErrors === 0) return null;
  const sample = parsed.messages[0] ? ` (${parsed.messages[0]})` : "";
  return `No se pudo analizar: ${parsed.syntaxErrors} error(es) de sintaxis`
    + `. Solo se admite JavaScript/TypeScript${sample}`;
}

function filterCwe(raw: TaintFinding[], options: ScanOptions): TaintFinding[] {
  return options.cwe?.length
    ? raw.filter((f) => f.cwe !== undefined && options.cwe!.includes(f.cwe))
    : raw;
}

function failedFile(rel: string, lineCount: number, elapsedMs: number, error: string): ScanFileResult {
  return { file: rel, findings: [], lineCount, nodeCount: 0, edgeCount: 0, elapsedMs, error };
}

/** Analiza un único archivo ya leído. `relPath` se usa como identidad. */
export function scanSource(
  code: string,
  relPath: string,
  options: ScanOptions = {},
): ScanFileResult {
  const started = performance.now();
  const parsed = parseSource(code, relPath);
  const lineCount = code.split("\n").length;
  const error = syntaxErrorOf(parsed);
  if (error) return failedFile(relPath, lineCount, performance.now() - started, error);

  const graph = graphFromSourceFile(parsed.sourceFile, relPath);
  const raw = analyzeTaint(graph, { maxDepth: options.maxDepth });
  return {
    file: relPath,
    findings: toScanFindings(relPath, graph, filterCwe(raw, options)),
    lineCount,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    elapsedMs: performance.now() - started,
  };
}

/**
 * Un archivo del escaneo, identificado por su ruta relativa a la raíz con
 * `/`. Si no se pudo leer, trae el motivo en lugar del contenido.
 */
export type ScanInput =
  | { path: string; content: string }
  | { path: string; error: string };

/**
 * Grafo sobre el que se corrió el taint: un archivo solo, o varios unidos por
 * llamadas entre ellos. `findings[i]` es el hallazgo crudo de
 * `scanFindings[i]`, para quien necesite volver a los ids del grafo.
 */
export interface ScanGraph {
  files: string[];
  graph: IRGraph;
  findings: TaintFinding[];
  scanFindings: ScanFinding[];
}

export interface ScanFilesOutput {
  result: ScanResult;
  graphs: ScanGraph[];
}

interface ParsedFile {
  /** Ruta virtual (`/` + relativa): la identidad para resolver imports. */
  abs: string;
  rel: string;
  graph: IRGraph;
  links: ModuleLinks;
  lineCount: number;
  elapsedMs: number;
}

/** El id de un nodo empieza con su archivo: `${file}#${kind}@${line}:${col}`. */
function fileOfNodeId(id: string): string {
  return id.slice(0, id.lastIndexOf("#"));
}

function mergeGraphs(members: ParsedFile[], crossEdges: IREdge[]): IRGraph {
  const files = new Set(members.map((m) => m.rel));
  return {
    file: members[0]!.rel,
    nodes: members.flatMap((m) => m.graph.nodes),
    edges: [
      ...members.flatMap((m) => m.graph.edges),
      ...crossEdges.filter((e) => files.has(fileOfNodeId(e.from))),
    ],
  };
}

/**
 * Escanea archivos ya leídos en tres fases:
 *
 * 1. Cada archivo se parsea y se convierte en su grafo, como siempre.
 * 2. Las llamadas a funciones importadas de otro archivo del escaneo se ligan
 *    con aristas `CALLS` y `BINDS_TO` (ver `project/`).
 * 3. El taint se corre por componente conexo de esas llamadas. Un archivo que
 *    no llama a otros se analiza solo, con el mismo resultado que antes.
 *
 * Alcance del cruce entre archivos: imports ES con rutas relativas hacia
 * `function` declaradas. No cubre CommonJS, arrow functions ni métodos.
 *
 * No toca el disco: es lo que usan tanto `scanPaths` como la versión web.
 * `onFile` avisa antes de parsear cada archivo, para mostrar progreso.
 */
export function scanFilesWithGraphs(
  inputs: ScanInput[],
  options: ScanOptions = {},
  root = "",
  onFile?: (done: number, total: number, file: string) => void,
): ScanFilesOutput {
  // Fase 1: parseo y grafo por archivo.
  const failed = new Map<string, ScanFileResult>();
  const parsed: ParsedFile[] = [];
  const order: string[] = [];
  inputs.forEach((input, i) => {
    const rel = input.path;
    order.push(rel);
    onFile?.(i, inputs.length, rel);
    if ("error" in input) {
      failed.set(rel, failedFile(rel, 0, 0, input.error));
      return;
    }
    const started = performance.now();
    try {
      const code = input.content;
      const lineCount = code.split("\n").length;
      const result = parseSource(code, rel);
      const error = syntaxErrorOf(result);
      if (error) {
        failed.set(rel, failedFile(rel, lineCount, performance.now() - started, error));
        return;
      }
      parsed.push({
        abs: `/${rel}`,
        rel,
        graph: graphFromSourceFile(result.sourceFile, rel),
        links: extractLinks(result.sourceFile, rel),
        lineCount,
        elapsedMs: performance.now() - started,
      });
    } catch (err) {
      failed.set(rel, failedFile(rel, 0, 0, err instanceof Error ? err.message : String(err)));
    }
  });

  // Fase 2: llamadas entre archivos.
  const linkStarted = performance.now();
  const cross = options.crossFile === false
    ? { edges: [], calls: 0, pairs: [] }
    : buildCrossModuleEdges(projectIndexOf(parsed), parsed);
  const components = connectedComponents(parsed.map((p) => p.abs), cross.pairs);
  const linkMs = performance.now() - linkStarted;

  // Fase 3: taint por componente.
  const byAbs = new Map(parsed.map((p) => [p.abs, p]));
  const findingsByFile = new Map<string, ScanFinding[]>();
  const analysisMs = new Map<string, number>();
  const graphs: ScanGraph[] = [];
  for (const component of components) {
    const started = performance.now();
    const members = component.map((abs) => byAbs.get(abs)!);
    const graph = members.length === 1 ? members[0]!.graph : mergeGraphs(members, cross.edges);
    const raw = filterCwe(analyzeTaint(graph, { maxDepth: options.maxDepth }), options);
    const scanFindings = toScanFindings(members[0]!.rel, graph, raw);
    for (const f of scanFindings) {
      const list = findingsByFile.get(f.file);
      if (list) list.push(f);
      else findingsByFile.set(f.file, [f]);
    }
    graphs.push({ files: members.map((m) => m.rel), graph, findings: raw, scanFindings });
    // El tiempo del componente (y su parte del enlace) se reparte entre sus archivos.
    const share = (performance.now() - started + linkMs * (members.length / parsed.length))
      / members.length;
    for (const m of members) analysisMs.set(m.rel, share);
  }

  const crossEdgesByFile = new Map<string, number>();
  for (const e of cross.edges) {
    const file = fileOfNodeId(e.from);
    crossEdgesByFile.set(file, (crossEdgesByFile.get(file) ?? 0) + 1);
  }

  const parsedByRel = new Map(parsed.map((p) => [p.rel, p]));
  const results: ScanFileResult[] = order.map((rel) => {
    const p = parsedByRel.get(rel);
    if (!p) return failed.get(rel)!;
    return {
      file: rel,
      findings: findingsByFile.get(rel) ?? [],
      lineCount: p.lineCount,
      nodeCount: p.graph.nodes.length,
      edgeCount: p.graph.edges.length + (crossEdgesByFile.get(rel) ?? 0),
      elapsedMs: p.elapsedMs + (analysisMs.get(rel) ?? 0),
    };
  });

  const findings = results.flatMap((r) => r.findings);
  return {
    graphs,
    result: {
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
        crossFileCalls: cross.calls,
      },
    },
  };
}

/** `scanFilesWithGraphs` sin los grafos: solo el resultado reportable. */
export function scanFiles(
  inputs: ScanInput[],
  options: ScanOptions = {},
  root = "",
): ScanResult {
  return scanFilesWithGraphs(inputs, options, root).result;
}
