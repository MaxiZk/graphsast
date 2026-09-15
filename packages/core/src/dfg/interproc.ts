import type { IRModule, IRNode, IREdge, IRCall, IRFunction } from "../ir/types.js";
import { buildCallGraph } from "../cfg/callgraph.js";
import { isFlowOperand, resolveFlowDefs } from "./identifiers.js";
import { defsInScope, nodeOwnerFnId } from "./scope.js";

/**
 * Construye el data-flow inter-procedural: aristas que cruzan funciones.
 */
export function buildInterproc(mod: IRModule): IREdge[] {
  const byId = new Map<string, IRNode>();
  for (const node of mod.nodes) byId.set(node.id, node);

  const defsByName = new Map<string, IRNode[]>();
  for (const node of mod.nodes) {
    if (node.kind !== "Variable" && node.kind !== "Parameter") continue;
    const list = defsByName.get(node.name);
    if (list) list.push(node);
    else defsByName.set(node.name, [node]);
  }

  const edges: IREdge[] = [];

  for (const callEdge of buildCallGraph(mod)) {
    const call = byId.get(callEdge.from) as IRCall | undefined;
    const fn = byId.get(callEdge.to) as IRFunction | undefined;
    if (!call || !fn) continue;
    call.argTexts.forEach((arg, i) => {
      if (!isFlowOperand(arg)) return;
      const paramId = fn.paramIds[i];
      if (!paramId) return;
      const defs = defsInScope(resolveFlowDefs(arg, defsByName), nodeOwnerFnId(call));
      for (const def of defs) {
        edges.push({ kind: "BINDS_TO", from: def.id, to: paramId });
      }
    });
  }

  for (const node of mod.nodes) {
    if (node.kind !== "Function") continue;
    const fn = node as IRFunction;
    for (const ret of fn.returnTexts) {
      if (!isFlowOperand(ret)) continue;
      const defs = defsInScope(resolveFlowDefs(ret, defsByName), fn.id);
      for (const def of defs) {
        edges.push({ kind: "RETURNS", from: fn.id, to: def.id });
      }
    }
  }

  return edges;
}
