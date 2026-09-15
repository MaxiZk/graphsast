import type { IRModule, IRNode, IREdge, IRCall, IRFunction } from "../ir/types.js";
import { buildCallGraph } from "../cfg/callgraph.js";
import { buildDefIndex, flowInputIds } from "./dataflow.js";
import { nodeOwnerFnId } from "./scope.js";

/**
 * Construye el data-flow inter-procedural: aristas que cruzan funciones.
 * `BINDS_TO` liga argumento → parámetro; `RETURNS` liga función → def retornada.
 */
export function buildInterproc(mod: IRModule): IREdge[] {
  const byId = new Map<string, IRNode>();
  for (const node of mod.nodes) byId.set(node.id, node);

  const defsByName = buildDefIndex(mod);
  const edges: IREdge[] = [];

  for (const callEdge of buildCallGraph(mod)) {
    const call = byId.get(callEdge.from) as IRCall | undefined;
    const fn = byId.get(callEdge.to) as IRFunction | undefined;
    if (!call || !fn) continue;
    const scope = nodeOwnerFnId(call);
    call.argFlows.forEach((flow, i) => {
      const paramId = fn.paramIds[i];
      if (!paramId) return;
      for (const from of flowInputIds(flow, scope, defsByName)) {
        edges.push({ kind: "BINDS_TO", from, to: paramId });
      }
    });
  }

  for (const node of mod.nodes) {
    if (node.kind !== "Function") continue;
    const fn = node as IRFunction;
    for (const flow of fn.returnFlows) {
      for (const to of flowInputIds(flow, fn.id, defsByName)) {
        edges.push({ kind: "RETURNS", from: fn.id, to });
      }
    }
  }

  return edges;
}
