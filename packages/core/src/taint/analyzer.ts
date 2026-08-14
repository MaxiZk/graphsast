import type { IRCall, IRGraph, IRNode } from "../ir/types.js";
import { cweForSinkNode } from "../catalog/rules.js";
import { defaultTaintRules } from "./rules.js";
import { findPath } from "./reach.js";
import type { TaintConfig, TaintFinding, TaintRoles, TaintRule } from "./types.js";

function nodesMatching(rules: TaintRule[], kind: TaintRule["kind"], nodes: IRNode[]) {
  const matchers = rules.filter((r) => r.kind === kind);
  return nodes.filter((n) => matchers.some((r) => r.match(n)));
}

/** Parámetros alimentados por BINDS_TO no son entradas raíz del programa. */
function rootSources(graph: IRGraph, sources: IRNode[]): IRNode[] {
  const boundParams = new Set(
    graph.edges.filter((e) => e.kind === "BINDS_TO").map((e) => e.to),
  );
  return sources.filter(
    (n) => n.kind !== "Parameter" || !boundParams.has(n.id),
  );
}

/** ¿Hay un sanitizer estrictamente entre source y sink en el camino? */
function pathSanitized(
  path: string[],
  sourceId: string,
  sinkId: string,
  sanitizerIds: ReadonlySet<string>,
): boolean {
  const start = path.indexOf(sourceId);
  const end = path.indexOf(sinkId);
  if (start === -1 || end === -1 || start >= end) return false;
  for (let i = start + 1; i < end; i++) {
    if (sanitizerIds.has(path[i]!)) return true;
  }
  return false;
}

/**
 * Detecta caminos source → sink sin sanitizer intermedio sobre el grafo IR.
 * Motor en memoria (previo a persistencia Cypher del Hito 5).
 */
export function analyzeTaint(
  graph: IRGraph,
  config: TaintConfig = {},
): TaintFinding[] {
  const rules = config.rules ?? defaultTaintRules();
  const sources = rootSources(
    graph,
    nodesMatching(rules, "source", graph.nodes),
  );
  const sinks = nodesMatching(rules, "sink", graph.nodes);
  const sanitizers = nodesMatching(rules, "sanitizer", graph.nodes);
  const sanitizerIds = new Set(sanitizers.map((n) => n.id));

  const findings: TaintFinding[] = [];
  const reachConfig = {
    maxDepth: config.maxDepth,
    propagateEdges: config.propagateEdges,
  };

  for (const source of sources) {
    for (const sink of sinks) {
      const path = findPath(graph, source.id, sink.id, reachConfig);
      if (!path) continue;

      const sanitized = pathSanitized(path, source.id, sink.id, sanitizerIds);
      if (sanitized) continue;

      findings.push({
        sourceId: source.id,
        sinkId: sink.id,
        path,
        sanitized: false,
        ...enrichFinding(sink, rules),
      });
    }
  }

  return dedupeFindings(findings);
}

function enrichFinding(
  sink: IRNode,
  rules: TaintRule[],
): Pick<TaintFinding, "cwe" | "cweName" | "ruleId"> {
  if (sink.kind !== "Call") return {};
  return cweForSinkNode(rules, sink as IRCall);
}

function dedupeFindings(findings: TaintFinding[]): TaintFinding[] {
  const seen = new Set<string>();
  const out: TaintFinding[] = [];
  for (const f of findings) {
    const key = `${f.sinkId}\t${f.path.join("\t")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Marca nodos source/sink/sanitizer aunque no haya camino (para visualización). */
export function getTaintRoles(
  graph: IRGraph,
  config: TaintConfig = {},
): TaintRoles {
  const rules = config.rules ?? defaultTaintRules();
  const sources = rootSources(
    graph,
    nodesMatching(rules, "source", graph.nodes),
  );
  const sinks = nodesMatching(rules, "sink", graph.nodes);
  const sanitizers = nodesMatching(rules, "sanitizer", graph.nodes);
  return {
    sourceIds: sources.map((n) => n.id),
    sinkIds: sinks.map((n) => n.id),
    sanitizerIds: sanitizers.map((n) => n.id),
  };
}
