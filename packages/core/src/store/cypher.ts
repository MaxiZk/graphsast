import type { IREdgeKind, IRGraph, IRNode } from "../ir/types.js";
import type { TaintAnnotations } from "../taint/analyzer.js";
import type { TaintRoles } from "../taint/types.js";

export const EDGE_KINDS: IREdgeKind[] = [
  "FLOWS_TO",
  "SANITIZED_BY",
  "CALLS",
  "BINDS_TO",
  "RETURNS",
];

/** En Neo4j no hay `undefined` dentro de una lista: -1 es "sin CWE". */
const NO_CWE = -1;

export function taintRoleFor(
  nodeId: string,
  roles: TaintRoles,
): string | null {
  if (roles.sourceIds.includes(nodeId)) return "source";
  if (roles.sinkIds.includes(nodeId)) return "sink";
  if (roles.sanitizerIds.includes(nodeId)) return "sanitizer";
  return null;
}

/**
 * Propiedades de un nodo en Neo4j. Además del rol, lleva las decisiones de
 * `annotateTaint` que la consulta necesita: CWE y argumentos del sink
 * (`sinkCwe`, `sinkArgs`) y para qué CWE vale el sanitizer (`sanitizerCwes`).
 */
export function nodeProperties(
  node: IRNode,
  roles: TaintRoles,
  annotations?: TaintAnnotations,
) {
  const sink = annotations?.sinks.get(node.id);
  const sanitizer = annotations?.sanitizers.get(node.id);
  const base = {
    id: node.id,
    kind: node.kind,
    name: node.name,
    code: node.code,
    file: node.loc.file,
    line: node.loc.line,
    col: node.loc.col,
    taintRole: taintRoleFor(node.id, roles),
    sinkCwe: sink ? sink.cwe ?? NO_CWE : null,
    sinkArgs: sink?.args ? [...sink.args] : null,
    sanitizerCwes: sanitizer ? sanitizer.map((c) => c ?? NO_CWE) : null,
  };
  if (node.kind === "Call") {
    return { ...base, callee: node.callee };
  }
  return { ...base, callee: null };
}

/** Sentencias Cypher para cargar un IRGraph (útil para tests y depuración). */
export function buildPersistStatements(
  graph: IRGraph,
  roles: TaintRoles,
  annotations?: TaintAnnotations,
): string[] {
  const stmts: string[] = ["MATCH (n:GSNode) DETACH DELETE n"];
  for (const node of graph.nodes) {
    const props = JSON.stringify(nodeProperties(node, roles, annotations));
    stmts.push(`CREATE (n:GSNode ${cypherProps(props)})`);
  }
  for (const edge of graph.edges) {
    if (!EDGE_KINDS.includes(edge.kind)) continue;
    const props = edge.arg === undefined ? "" : ` {arg: ${edge.arg}}`;
    stmts.push(
      `MATCH (a:GSNode {id: ${cypherStr(edge.from)}}), (b:GSNode {id: ${cypherStr(edge.to)}}) CREATE (a)-[:${edge.kind}${props}]->(b)`,
    );
  }
  return stmts;
}

function cypherStr(value: string): string {
  return JSON.stringify(value);
}

function cypherProps(json: string): string {
  const obj = JSON.parse(json) as Record<string, unknown>;
  const parts = Object.entries(obj).map(([k, v]) => {
    if (v === null) return `${k}: null`;
    if (typeof v === "number") return `${k}: ${v}`;
    if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
    return `${k}: ${cypherStr(String(v))}`;
  });
  return `{ ${parts.join(", ")} }`;
}

/**
 * Plantilla Cypher del motor de taint (arquitectura §7). `$run` limita la
 * consulta a un análisis (`null`: todo el grafo). Aplica las mismas reglas que
 * `analyzeTaint`:
 *
 * - un nodo intermedio corta el camino si es un sanitizer que vale para la CWE
 *   del sink (`sanitizerApplies`);
 * - si el sink restringe argumentos, la última arista tiene que entrar por
 *   uno de ellos (`entersSink`).
 */
export const TAINT_PATH_CYPHER = `
MATCH (s:GSNode {taintRole: 'source'}) WHERE $run IS NULL OR s.run = $run
MATCH (k:GSNode) WHERE k.sinkCwe IS NOT NULL AND ($run IS NULL OR k.run = $run)
MATCH p = (s)-[:FLOWS_TO|SANITIZED_BY|CALLS|BINDS_TO|RETURNS*1..15]->(k)
WHERE NONE(n IN nodes(p)[1..-1] WHERE n.sanitizerCwes IS NOT NULL
        AND (k.sinkCwe = -1 OR -1 IN n.sanitizerCwes OR k.sinkCwe IN n.sanitizerCwes))
  AND (k.sinkArgs IS NULL
       OR (type(last(relationships(p))) IN ['FLOWS_TO', 'SANITIZED_BY']
           AND last(relationships(p)).arg IN k.sinkArgs))
RETURN s.id AS sourceId, k.id AS sinkId, [n IN nodes(p) | n.id] AS path
`.trim();

export function parseTaintRows(
  records: { get: (key: string) => unknown }[],
): { sourceId: string; sinkId: string; path: string[] }[] {
  return records.map((r) => ({
    sourceId: String(r.get("sourceId")),
    sinkId: String(r.get("sinkId")),
    path: (r.get("path") as string[]) ?? [],
  }));
}
