import type { IRGraph, IREdgeKind } from "../ir/types.js";
import type { TaintConfig } from "./types.js";

export const DEFAULT_TAINT_PROPAGATE_EDGES: readonly IREdgeKind[] = [
  "FLOWS_TO",
  "BINDS_TO",
  "RETURNS",
  "CALLS",
];

function buildAdjacency(
  graph: IRGraph,
  propagateEdges: ReadonlySet<IREdgeKind>,
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!propagateEdges.has(e.kind)) continue;
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  return adj;
}

/**
 * BFS dirigido acotado. Devuelve un camino `from → to` o `null` si no hay
 * alcanzabilidad dentro de `maxDepth` (mismo oráculo que la validación temprana).
 */
export function findPath(
  graph: IRGraph,
  fromId: string,
  toId: string,
  config: Pick<TaintConfig, "maxDepth" | "propagateEdges"> = {},
): string[] | null {
  const maxDepth = config.maxDepth ?? 15;
  const propagate = new Set(
    config.propagateEdges ?? DEFAULT_TAINT_PROPAGATE_EDGES,
  );
  const adj = buildAdjacency(graph, propagate);

  const parent = new Map<string, string>();
  let frontier = [fromId];
  const seen = new Set<string>([fromId]);

  if (fromId === toId) return [fromId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const to of adj.get(id) ?? []) {
        if (to === toId) {
          parent.set(to, id);
          const path = [toId];
          let cur = id;
          while (cur !== fromId) {
            path.unshift(cur);
            cur = parent.get(cur)!;
          }
          path.unshift(fromId);
          return path;
        }
        if (!seen.has(to)) {
          seen.add(to);
          parent.set(to, id);
          next.push(to);
        }
      }
    }
    frontier = next;
  }
  return null;
}

export function reaches(
  graph: IRGraph,
  fromId: string,
  toId: string,
  config: Pick<TaintConfig, "maxDepth" | "propagateEdges"> = {},
): boolean {
  return findPath(graph, fromId, toId, config) !== null;
}
