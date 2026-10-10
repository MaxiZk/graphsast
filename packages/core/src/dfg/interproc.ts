import type { IRModule, IRNode, IREdge, IRCall, IRFunction } from "../ir/types.js";
import { buildCallGraph } from "../cfg/callgraph.js";
import { buildDefIndex, flowInputIds } from "./dataflow.js";
import { nodeOwnerFnId, nodeScopePath } from "./scope.js";

/**
 * Aristas que cruzan de una llamada a la función que invoca:
 *
 * - `BINDS_TO`: cada argumento al parámetro de la misma posición.
 * - `RETURNS`: lo que la función retorna, al nodo de la llamada. Es el valor
 *   con el que sigue el llamador (`const s = f(x)`).
 *
 * Las comparten el análisis de un archivo y el de varios: `link.ts` las usa
 * para las llamadas a funciones de otro archivo.
 */
export function callSiteEdges(
  call: IRCall,
  fn: IRFunction,
  callerDefs: Map<string, IRNode[]>,
  calleeDefs: Map<string, IRNode[]>,
): IREdge[] {
  const edges: IREdge[] = [];
  const scope = nodeOwnerFnId(call);
  const callPath = nodeScopePath(call);
  call.argFlows.forEach((flow, i) => {
    const paramId = fn.paramIds[i];
    if (!paramId) return;
    for (const from of flowInputIds(flow, scope, callerDefs, callPath)) {
      edges.push({ kind: "BINDS_TO", from, to: paramId });
    }
  });
  fn.returnFlows.forEach((flow, i) => {
    for (const from of flowInputIds(flow, fn.id, calleeDefs, fn.returnScopePaths?.[i])) {
      edges.push({ kind: "RETURNS", from, to: call.id });
    }
  });
  return edges;
}

/** Data-flow inter-procedural dentro de un módulo (ver `callSiteEdges`). */
export function buildInterproc(
  mod: IRModule,
  callEdges: IREdge[] = buildCallGraph(mod),
): IREdge[] {
  const byId = new Map<string, IRNode>();
  for (const node of mod.nodes) byId.set(node.id, node);

  const defsByName = buildDefIndex(mod);
  const edges: IREdge[] = [];
  for (const callEdge of callEdges) {
    const call = byId.get(callEdge.from) as IRCall | undefined;
    const fn = byId.get(callEdge.to) as IRFunction | undefined;
    if (!call || !fn) continue;
    edges.push(...callSiteEdges(call, fn, defsByName, defsByName));
  }
  return edges;
}
