import type { Driver } from "neo4j-driver";
import { cweForSinkNode } from "../catalog/rules.js";
import type { IRCall, IRGraph } from "../ir/types.js";
import { analyzeTaint, getTaintRoles } from "../taint/analyzer.js";
import { defaultTaintRules } from "../taint/rules.js";
import type { TaintConfig, TaintFinding } from "../taint/types.js";
import { persistGraph, queryTaintPaths } from "../store/neo4j.js";

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
 * Persiste el grafo en Neo4j y ejecuta la consulta Cypher de taint.
 * Si no hay driver, usa el motor en memoria.
 */
export async function analyzeWithEngine(
  graph: IRGraph,
  options: EngineOptions = {},
): Promise<EngineResult> {
  const config = { rules: options.taint?.rules ?? defaultTaintRules(), ...options.taint };
  if (!options.driver) {
    return { engine: "memory", findings: analyzeTaint(graph, config) };
  }

  const roles = getTaintRoles(graph, config);
  await persistGraph(options.driver, graph, roles, options.database);
  const raw = await queryTaintPaths(options.driver, options.database);
  const rules = config.rules ?? defaultTaintRules();
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
