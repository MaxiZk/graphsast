import type {
  IRModule, IRNode, IREdge, IRCall, IRVariable,
} from "../ir/types.js";
import {
  isFlowOperand,
  parseCallInit,
  parseNewInit,
  receiverOfCallee,
  resolveFlowDefs,
} from "./identifiers.js";
import { defsInScope, nodeOwnerFnId } from "./scope.js";

/**
 * Construye el data-flow graph intra-procedural (aristas `FLOWS_TO`).
 * Las defs solo conectan con usos dentro de la misma función.
 */
export function buildDataFlow(mod: IRModule): IREdge[] {
  const defsByName = new Map<string, IRNode[]>();
  for (const node of mod.nodes) {
    if (node.kind !== "Variable" && node.kind !== "Parameter") continue;
    const list = defsByName.get(node.name);
    if (list) list.push(node);
    else defsByName.set(node.name, [node]);
  }

  const edges: IREdge[] = [];

  for (const node of mod.nodes) {
    if (node.kind !== "Call") continue;
    const call = node as IRCall;
    const scope = nodeOwnerFnId(call);
    for (const arg of call.argTexts) {
      if (!isFlowOperand(arg)) continue;
      const defs = defsInScope(resolveFlowDefs(arg, defsByName), scope);
      for (const def of defs) {
        edges.push({ kind: "FLOWS_TO", from: def.id, to: call.id });
      }
    }
    const recv = receiverOfCallee(call.callee);
    if (recv) {
      const defs = defsInScope(resolveFlowDefs(recv, defsByName), scope);
      for (const def of defs) {
        edges.push({ kind: "FLOWS_TO", from: def.id, to: call.id });
      }
    }
  }

  for (const node of mod.nodes) {
    if (node.kind !== "Variable") continue;
    const variable = node as IRVariable;
    const init = variable.initText;
    if (!init) continue;
    const scope = nodeOwnerFnId(variable);

    const newArg = parseNewInit(init);
    if (newArg) {
      const defs = defsInScope(resolveFlowDefs(newArg, defsByName), scope);
      for (const def of defs) {
        if (def.id === variable.id) continue;
        edges.push({ kind: "FLOWS_TO", from: def.id, to: variable.id });
      }
      continue;
    }

    if (!isFlowOperand(init)) continue;
    const defs = defsInScope(resolveFlowDefs(init, defsByName), scope);
    for (const def of defs) {
      if (def.id === variable.id) continue;
      edges.push({ kind: "FLOWS_TO", from: def.id, to: variable.id });
    }
  }

  for (const node of mod.nodes) {
    if (node.kind !== "Variable") continue;
    const variable = node as IRVariable;
    const init = variable.initText;
    if (!init) continue;
    const parsed = parseCallInit(init);
    if (!parsed) continue;
    const scope = nodeOwnerFnId(variable);
    for (const callNode of mod.nodes) {
      if (callNode.kind !== "Call") continue;
      const call = callNode as IRCall;
      if (nodeOwnerFnId(call) !== scope) continue;
      if (call.callee !== parsed.callee) continue;
      if (call.argTexts.length !== 1 || call.argTexts[0] !== parsed.arg) continue;
      edges.push({ kind: "FLOWS_TO", from: call.id, to: variable.id });
    }
  }

  return edges;
}
