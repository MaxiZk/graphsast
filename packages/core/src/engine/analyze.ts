import type { Driver } from "neo4j-driver";
import { cweForSinkNode } from "../catalog/rules.js";
import type { IRCall, IRGraph } from "../ir/types.js";
import { analyzeTaint, annotateTaint, getTaintRoles } from "../taint/analyzer.js";
import { DEFAULT_MAX_DEPTH } from "../taint/reach.js";
import { defaultTaintRules } from "../taint/rules.js";
import type { TaintConfig, TaintFinding } from "../taint/types.js";
import { deleteRun, persistGraph, queryTaintPaths } from "../store/neo4j.js";

export type TaintEngine = "memory" | "neo4j";

export interface EngineResult {
  engine: TaintEngine;
  findings: TaintFinding[];
}

export interface EngineOptions {
  driver?: Driver;
  database?: string;
  taint?: TaintConfig;
}

/** Análisis en memoria (BFS) — motor por defecto y oráculo de tests. */
export function analyzeInMemory(
  graph: IRGraph,
  config: TaintConfig = {},
): TaintFinding[] {
  return analyzeTaint(graph, config);
}

/**
 * Persiste el grafo en Neo4j, ejecuta la consulta Cypher de taint y borra el
 * grafo persistido. Si no hay driver, usa el motor en memoria.
 */
export async function analyzeWithEngine(
  graph: IRGraph,
  options: EngineOptions = {},
): Promise<EngineResult> {
  const config = { rules: options.taint?.rules ?? defaultTaintRules(graph.language), ...options.taint };
  if (!options.driver) {
    return { engine: "memory", findings: analyzeTaint(graph, config) };
  }

  const roles = getTaintRoles(graph, config);
  const annotations = annotateTaint(graph, config.rules ?? defaultTaintRules(graph.language));
  const run = await persistGraph(options.driver, graph, roles, options.database, annotations);
  let raw: TaintFinding[];
  try {
    const familyDepths = [...annotations.sinks.values()].map((s) => s.maxDepth ?? DEFAULT_MAX_DEPTH);
    raw = await queryTaintPaths(options.driver, options.database, run, {
      maxDepth: config.maxDepth,
      maxHops: Math.max(DEFAULT_MAX_DEPTH, ...familyDepths),
    });
  } finally {
    await deleteRun(options.driver, run, options.database);
  }
  const rules = config.rules ?? defaultTaintRules(graph.language);
  const findings = enrichFindings(graph, raw, rules);
  return { engine: "neo4j", findings };
}

function enrichFindings(
  graph: IRGraph,
  findings: TaintFinding[],
  rules: ReturnType<typeof defaultTaintRules>,
): TaintFinding[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return findings.map((f) => {
    const sink = byId.get(f.sinkId);
    if (!sink || sink.kind !== "Call") return f;
    return { ...f, ...cweForSinkNode(rules, sink as IRCall) };
  });
}
