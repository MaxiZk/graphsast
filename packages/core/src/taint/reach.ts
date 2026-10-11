import type { IREdge, IRGraph, IREdgeKind } from "../ir/types.js";
import type { TaintConfig } from "./types.js";

/**
 * Aristas por las que se propaga el dato. `SANITIZED_BY` también: es un
 * `FLOWS_TO` que sale de una llamada de saneamiento, y ese saneamiento puede
 * no valer para el sink de destino (`String(x)` protege una consulta MongoDB,
 * no una SQL). El corte lo hace el analizador quitando el nodo sanitizer,
 * según la CWE del sink.
 */
export const DEFAULT_TAINT_PROPAGATE_EDGES: readonly IREdgeKind[] = [
  "FLOWS_TO",
  "SANITIZED_BY",
  "BINDS_TO",
  "RETURNS",
  "CALLS",
];

function buildAdjacency(
  graph: IRGraph,
  propagateEdges: ReadonlySet<IREdgeKind>,
): Map<string, IREdge[]> {
  const adj = new Map<string, IREdge[]>();
  for (const e of graph.edges) {
    if (!propagateEdges.has(e.kind)) continue;
    const list = adj.get(e.from);
    if (list) list.push(e);
    else adj.set(e.from, [e]);
  }
  return adj;
}

/** Largo máximo de un camino (en aristas) si nada lo fija. */
export const DEFAULT_MAX_DEPTH = 15;

/**
 * BFS dirigido acotado. Devuelve un camino `from → to` o `null` si no hay
 * alcanzabilidad dentro de `maxDepth`.
 *
 * `blocked` excluye nodos del recorrido. El analizador de taint lo usa para
 * sacar los sanitizers del grafo: así "existe camino" equivale a "existe
 * camino sin sanitizar", en vez de inspeccionar un único camino más corto.
 *
 * `enters` filtra las aristas que llegan al destino: el analizador lo usa para
 * que el dato solo pueda entrar a un sink por sus argumentos peligrosos.
 */
export function findPath(
  graph: IRGraph,
  fromId: string,
  toId: string,
  config: Pick<TaintConfig, "maxDepth" | "propagateEdges"> = {},
  blocked: ReadonlySet<string> = new Set(),
  enters: (edge: IREdge) => boolean = () => true,
): string[] | null {
  const maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH;
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
      for (const edge of adj.get(id) ?? []) {
        const to = edge.to;
        if (blocked.has(to)) continue;
        if (to === toId) {
          if (!enters(edge)) continue;
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
  blocked: ReadonlySet<string> = new Set(),
): boolean {
  return findPath(graph, fromId, toId, config, blocked) !== null;
}
