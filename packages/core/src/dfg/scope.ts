import type { IRNode, IRParameter, IRVariable, IRCall } from "../ir/types.js";

export function nodeOwnerFnId(node: IRNode): string | null {
  if (node.kind === "Parameter") return (node as IRParameter).ownerFnId;
  if (node.kind === "Variable") return (node as IRVariable).ownerFnId;
  if (node.kind === "Call") return (node as IRCall).ownerFnId;
  return null;
}

/** Defs del mismo ámbito de función que el nodo de uso. */
export function defsInScope(
  defs: IRNode[],
  useOwnerFnId: string | null,
): IRNode[] {
  if (!useOwnerFnId) return defs;
  return defs.filter((d) => nodeOwnerFnId(d) === useOwnerFnId);
}
