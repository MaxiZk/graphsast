import type { IRGraph } from "../ir/types.js";
import { graphFromSourceFile } from "../ir/graph.js";
import { parseSource, type ParseResult } from "../parser/parser.js";
import { buildAnalysisReport } from "../report/json.js";
import { analyzeTaint, getTaintRoles } from "../taint/analyzer.js";
import { getCatalogBundle, getRuleLabels } from "../taint/rules.js";
import type { TaintFinding } from "../taint/types.js";
import { buildVerdict } from "./verdict.js";

/** Motor que resolvió los caminos. Espeja `TaintEngine` sin importar Neo4j. */
type Engine = "memory" | "neo4j";

function countEdges(edges: { kind: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of edges) {
    out[e.kind] = (out[e.kind] ?? 0) + 1;
  }
  return out;
}

/**
 * Respuesta cuando el parser no entendió el texto: no hay grafo que mostrar,
 * y un panel vacío se leería como «sin vulnerabilidades». Se responde el
 * veredicto explícito en su lugar.
 */
export function notAnalyzablePayload(
  code: string,
  file: string,
  parsed: ParseResult,
  started: number,
) {
  const verdict = buildVerdict({
    graph: { file, nodes: [], edges: [] },
    roles: { sourceIds: [], sinkIds: [], sanitizerIds: [] },
    findings: [],
    parse: parsed,
  });
  return {
    graph: { file, nodes: [], edges: [] } as IRGraph,
    findings: [] as TaintFinding[],
    roles: { sourceIds: [], sinkIds: [], sanitizerIds: [] },
    engine: "memory" as Engine,
    verdict,
    report: null,
    stats: {
      elapsedMs: Math.round(performance.now() - started),
      lineCount: code.split("\n").length,
      nodeCount: 0,
      edgeCount: 0,
      edgeKinds: {} as Record<string, number>,
      findingCount: 0,
    },
    rules: getRuleLabels(),
    catalog: [] as ReturnType<typeof catalogSummary>,
  };
}

function catalogSummary() {
  return getCatalogBundle().entries.map((e) => ({
    cwe: e.cwe,
    name: e.name,
    description: e.description ?? "",
    sinks: e.sinks.length,
    sanitizers: e.sanitizers.length,
  }));
}

/**
 * Respuesta que consume la interfaz de visualización (grafo, hallazgos,
 * roles, veredicto, informe) para un análisis ya resuelto.
 */
export function analysisPayload(input: {
  code: string;
  file: string;
  parsed: ParseResult;
  graph: IRGraph;
  engine: Engine;
  findings: TaintFinding[];
  started: number;
}) {
  const { code, file, parsed, graph, engine, findings } = input;
  const roles = getTaintRoles(graph);
  const elapsedMs = Math.round(performance.now() - input.started);
  const rules = getRuleLabels();

  const report = buildAnalysisReport({
    code,
    file,
    engine,
    findings,
    graph,
    elapsedMs,
    rules,
    catalog: getCatalogBundle(),
  });

  return {
    graph,
    findings,
    roles,
    engine,
    verdict: buildVerdict({ graph, roles, findings, parse: parsed }),
    report,
    stats: {
      elapsedMs,
      lineCount: code.split("\n").length,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      edgeKinds: countEdges(graph.edges),
      findingCount: findings.length,
    },
    rules,
    catalog: catalogSummary(),
  };
}

export type AnalysisPayload =
  | ReturnType<typeof analysisPayload>
  | ReturnType<typeof notAnalyzablePayload>;

/** Análisis de un fragmento con el motor en memoria, sin Neo4j. */
export function analyzeSource(code: string, file: string): AnalysisPayload {
  const started = performance.now();
  const parsed = parseSource(code, file);
  if (parsed.syntaxErrors > 0) return notAnalyzablePayload(code, file, parsed, started);
  const graph = graphFromSourceFile(parsed.sourceFile, file);
  const findings = analyzeTaint(graph);
  return analysisPayload({ code, file, parsed, graph, engine: "memory", findings, started });
}
