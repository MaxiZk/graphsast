import type { IREdge, IREdgeKind, IRGraph, IRNode } from "../ir/types.js";
import type { TaintRoles } from "../taint/types.js";

const EDGE_KINDS: IREdgeKind[] = [
  "FLOWS_TO",
  "CALLS",
  "BINDS_TO",
  "RETURNS",
];

export function taintRoleFor(
  nodeId: string,
  roles: TaintRoles,
): string | null {
  if (roles.sourceIds.includes(nodeId)) return "source";
  if (roles.sinkIds.includes(nodeId)) return "sink";
  if (roles.sanitizerIds.includes(nodeId)) return "sanitizer";
  return null;
}

export function nodeProperties(node: IRNode, roles: TaintRoles) {
  const base = {
    id: node.id,
    kind: node.kind,
    name: node.name,
    code: node.code,
    file: node.loc.file,
    line: node.loc.line,
    col: node.loc.col,
    taintRole: taintRoleFor(node.id, roles),
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
): string[] {
  const stmts: string[] = ["MATCH (n:GSNode) DETACH DELETE n"];
  for (const node of graph.nodes) {
    const props = JSON.stringify(nodeProperties(node, roles));
    stmts.push(`CREATE (n:GSNode ${cypherProps(props)})`);
  }
  for (const edge of graph.edges) {
    if (!EDGE_KINDS.includes(edge.kind)) continue;
    stmts.push(
      `MATCH (a:GSNode {id: ${cypherStr(edge.from)}}), (b:GSNode {id: ${cypherStr(edge.to)}}) CREATE (a)-[:${edge.kind}]->(b)`,
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
    return `${k}: ${cypherStr(String(v))}`;
  });
  return `{ ${parts.join(", ")} }`;
}

/** Plantilla Cypher del motor de taint (arquitectura §7). */
export const TAINT_PATH_CYPHER = `
MATCH (s:GSNode {taintRole: 'source'})
MATCH (k:GSNode {taintRole: 'sink'})
MATCH p = (s)-[:FLOWS_TO|CALLS|BINDS_TO|RETURNS*1..15]->(k)
WHERE NONE(n IN nodes(p) WHERE n.taintRole = 'sanitizer')
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
