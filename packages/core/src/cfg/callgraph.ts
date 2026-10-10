import type { IRModule, IREdge, IRCall, IRNode } from "../ir/types.js";
import { defsInScope, nodeOwnerFnId, nodeScopePath } from "../dfg/scope.js";
import { FunctionIndex, normalizeCallee } from "./resolve.js";

export interface CallResolution {
  /** Aristas `CALLS` del nodo Call al nodo Function. */
  edges: IREdge[];
  /** Llamadas resueltas con certeza (ver `Resolution.exact`). */
  exactCallIds: Set<string>;
}

/**
 * Resuelve cada `IRCall` contra las `IRFunction` del módulo: funciones
 * declaradas, arrows y function expressions guardadas en una variable, campo o
 * propiedad, y métodos de clase u objeto literal. Las reglas, de la más a la
 * menos precisa, están en `FunctionIndex.resolve`.
 *
 * Anota `resolution` en cada llamada resuelta: el emparejamiento de sinks lo
 * usa para no tomar `this.save()` de un método propio por el `.save` de
 * Mongoose.
 */
export function resolveCalls(mod: IRModule): CallResolution {
  const index = new FunctionIndex(mod.nodes);
  const paramsByName = new Map<string, IRNode[]>();
  for (const node of mod.nodes) {
    if (node.kind !== "Parameter") continue;
    const list = paramsByName.get(node.name);
    if (list) list.push(node);
    else paramsByName.set(node.name, [node]);
  }

  const edges: IREdge[] = [];
  const exactCallIds = new Set<string>();
  for (const node of mod.nodes) {
    if (node.kind !== "Call") continue;
    // `function h(req, run) { run(x) }`: `run` es el callback recibido, no
    // una función del módulo que se llame igual.
    const callee = normalizeCallee((node as IRCall).callee);
    const shadowing = paramsByName.get(callee);
    if (shadowing && defsInScope(shadowing, nodeOwnerFnId(node), nodeScopePath(node)).length > 0) {
      continue;
    }
    const { targets, exact } = index.resolve(node as IRCall);
    if (targets.length === 0) continue;
    if (exact) exactCallIds.add(node.id);
    (node as IRCall).resolution = exact ? "exact" : "guess";
    for (const fn of targets) edges.push({ kind: "CALLS", from: node.id, to: fn.id });
  }
  return { edges, exactCallIds };
}

/** Call graph: una arista `CALLS` por cada llamada resuelta. */
export function buildCallGraph(mod: IRModule): IREdge[] {
  return resolveCalls(mod).edges;
}
