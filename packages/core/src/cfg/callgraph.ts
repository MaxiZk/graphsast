import type { IRModule, IREdge, IRFunction, IRCall } from "../ir/types.js";

/**
 * Construye el call graph: por cada `IRCall` cuyo `callee` coincide con el
 * nombre de una `IRFunction` declarada, emite una arista `CALLS` desde el
 * nodo Call al nodo Function.
 *
 * Resolución acotada (ADR-5): solo `function` declarations por nombre.
 * Llamadas a miembro (`db.query`) o a nombres no declarados no resuelven.
 */
export function buildCallGraph(mod: IRModule): IREdge[] {
  const functionsByName = new Map<string, IRFunction[]>();
  for (const node of mod.nodes) {
    if (node.kind === "Function" && node.name) {
      const list = functionsByName.get(node.name);
      if (list) list.push(node);
      else functionsByName.set(node.name, [node]);
    }
  }

  const edges: IREdge[] = [];
  for (const node of mod.nodes) {
    if (node.kind !== "Call") continue;
    const call = node as IRCall;
    const targets = functionsByName.get(call.callee);
    if (!targets) continue;
    for (const fn of targets) {
      edges.push({ kind: "CALLS", from: call.id, to: fn.id });
    }
  }

  return edges;
}
