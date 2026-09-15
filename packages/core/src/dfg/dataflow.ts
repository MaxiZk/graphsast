import type { IRModule, IRNode, IREdge, FlowRef } from "../ir/types.js";
import { defsInScope, nodeOwnerFnId, nodeScopePath } from "./scope.js";

/** Índice de definiciones (variables y parámetros) por nombre. */
export function buildDefIndex(mod: IRModule): Map<string, IRNode[]> {
  const defsByName = new Map<string, IRNode[]>();
  for (const node of mod.nodes) {
    if (node.kind !== "Variable" && node.kind !== "Parameter") continue;
    const list = defsByName.get(node.name);
    if (list) list.push(node);
    else defsByName.set(node.name, [node]);
  }
  return defsByName;
}

/**
 * Ids que alimentan una referencia de flujo dentro de un ámbito:
 * defs de los identificadores raíz + nodos Call cuyo retorno se consume.
 */
export function flowInputIds(
  flow: FlowRef,
  scope: string | null,
  defsByName: Map<string, IRNode[]>,
  scopePath?: string[],
): string[] {
  const out: string[] = [];
  for (const name of flow.names) {
    for (const def of defsInScope(defsByName.get(name) ?? [], scope, scopePath)) {
      out.push(def.id);
    }
  }
  out.push(...flow.callIds);
  return out;
}

/**
 * Construye el data-flow graph intra-procedural (aristas `FLOWS_TO`).
 * Las defs solo conectan con usos dentro de la misma función.
 */
export function buildDataFlow(mod: IRModule): IREdge[] {
  const defsByName = buildDefIndex(mod);
  const edges: IREdge[] = [];
  const seen = new Set<string>();

  const link = (from: string, to: string): void => {
    if (from === to) return;
    const key = `${from}\t${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ kind: "FLOWS_TO", from, to });
  };

  const linkFlow = (
    flow: FlowRef,
    to: string,
    scope: string | null,
    scopePath?: string[],
  ): void => {
    for (const from of flowInputIds(flow, scope, defsByName, scopePath)) link(from, to);
  };

  // Argumentos y receptor de cada llamada fluyen al nodo Call.
  for (const node of mod.nodes) {
    if (node.kind !== "Call") continue;
    const scope = nodeOwnerFnId(node);
    const path = nodeScopePath(node);
    for (const flow of node.argFlows) linkFlow(flow, node.id, scope, path);
    linkFlow(node.receiverFlow, node.id, scope, path);
  }

  // El inicializador fluye a la variable declarada.
  for (const node of mod.nodes) {
    if (node.kind !== "Variable") continue;
    linkFlow(node.initFlow, node.id, nodeOwnerFnId(node), nodeScopePath(node));
  }

  // `q = expr` alimenta la def existente de `q` en el mismo ámbito.
  for (const assign of mod.assignments) {
    const defs = defsInScope(
      defsByName.get(assign.target) ?? [],
      assign.ownerFnId,
      assign.scopePath,
    );
    for (const def of defs) {
      linkFlow(assign.flow, def.id, assign.ownerFnId, assign.scopePath);
    }
  }

  return edges;
}
