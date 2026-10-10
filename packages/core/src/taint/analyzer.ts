import type { IRCall, IREdge, IRGraph, IRNode } from "../ir/types.js";
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

/**
 * Sanitizers a excluir del recorrido para un par (source, sink) dado: los de
 * la CWE del sink, más los que no declaran CWE. `escape` para SQL no protege
 * un sink XSS, ni `String(x)` —que neutraliza operadores de MongoDB— una
 * consulta SQL. Los extremos nunca se bloquean: un nodo puede ser sink y
 * sanitizer a la vez.
 */
function blockedFor(
  sanitizersByCwe: ReadonlyMap<number | undefined, ReadonlySet<string>>,
  cwe: number | undefined,
  sourceId: string,
  sinkId: string,
): Set<string> {
  const blocked = new Set([
    ...(sanitizersByCwe.get(undefined) ?? []),
    ...(cwe === undefined
      ? [...sanitizersByCwe.values()].flatMap((ids) => [...ids])
      : sanitizersByCwe.get(cwe) ?? []),
  ]);
  blocked.delete(sourceId);
  blocked.delete(sinkId);
  return blocked;
}

/** Sanitizers del grafo agrupados por la CWE de la regla que los reconoce. */
function sanitizersByCweOf(
  rules: TaintRule[],
  nodes: IRNode[],
): Map<number | undefined, Set<string>> {
  const out = new Map<number | undefined, Set<string>>();
  for (const rule of rules) {
    if (rule.kind !== "sanitizer") continue;
    for (const n of nodes) {
      if (!rule.match(n)) continue;
      const set = out.get(rule.cwe) ?? new Set<string>();
      set.add(n.id);
      out.set(rule.cwe, set);
    }
  }
  return out;
}

/**
 * Por dónde puede entrar el dato al sink. Si la regla del sink restringe los
 * argumentos (`db.query(sql, [id])` → solo `sql`), solo cuentan los
 * `FLOWS_TO` de esas posiciones; sin restricción, cualquier arista.
 */
function entersSink(rule: TaintRule | undefined): (edge: IREdge) => boolean {
  const args = rule?.args;
  if (!args) return () => true;
  return (edge) =>
    (edge.kind === "FLOWS_TO" || edge.kind === "SANITIZED_BY")
    && edge.arg !== undefined
    && args.includes(edge.arg);
}

/**
 * Detecta caminos source → sink sin sanitizer intermedio sobre el grafo IR.
 *
 * Los sanitizers se **quitan del grafo** antes de buscar el camino, de modo
 * que todo camino hallado es por construcción no sanitizado. Inspeccionar un
 * único camino más corto a posteriori era incorrecto: un sanitizer sobre el
 * camino corto suprimía hallazgos alcanzables por otra ruta.
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
  const sanitizersByCwe = sanitizersByCweOf(rules, graph.nodes);
  const sinkRules = rules.filter((r) => r.kind === "sink");

  const findings: TaintFinding[] = [];
  const reachConfig = {
    maxDepth: config.maxDepth,
    propagateEdges: config.propagateEdges,
  };

  for (const sink of sinks) {
    // La primera regla que reconoce al sink decide su CWE y sus argumentos.
    const rule = sinkRules.find((r) => r.match(sink));
    const enters = entersSink(rule);
    for (const source of sources) {
      const path = findPath(
        graph,
        source.id,
        sink.id,
        reachConfig,
        blockedFor(sanitizersByCwe, rule?.cwe, source.id, sink.id),
        enters,
      );
      if (!path) continue;

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
