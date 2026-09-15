import type { IREdge, IRNode } from "../ir/types.js";
import { defaultTaintRules } from "./rules.js";
import type { TaintRule } from "./types.js";

/**
 * Reetiqueta como `SANITIZED_BY` las aristas que **salen** de una llamada de
 * saneamiento: son el tramo donde el dato deja de estar tainted
 * (`sanitize(input)` → `safe`).
 *
 * `IREdgeKind` ya declaraba el tipo pero ningún constructor lo emitía, así que
 * el grafo no distinguía un camino saneado de uno que no lo está: ambos se
 * dibujaban como FLOWS_TO y solo el color del nodo sanitizer lo delataba.
 *
 * No cambia los hallazgos. El analizador ya saca los nodos sanitizer del
 * recorrido (ver `analyzeTaint`), y `SANITIZED_BY` tampoco está en
 * `DEFAULT_TAINT_PROPAGATE_EDGES`: el corte queda expresado dos veces, en el
 * nodo y en la arista, y el grafo lo muestra.
 */
export function markSanitizedEdges(
  nodes: readonly IRNode[],
  edges: IREdge[],
  rules: TaintRule[] = defaultTaintRules(),
): IREdge[] {
  const sanitizerRules = rules.filter((r) => r.kind === "sanitizer");
  const sanitizerIds = new Set(
    nodes
      .filter((n) => n.kind === "Call" && sanitizerRules.some((r) => r.match(n)))
      .map((n) => n.id),
  );
  if (sanitizerIds.size === 0) return edges;

  return edges.map((e) =>
    e.kind === "FLOWS_TO" && sanitizerIds.has(e.from)
      ? { ...e, kind: "SANITIZED_BY" as const }
      : e,
  );
}
