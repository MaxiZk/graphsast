import type { IRNode, IRParameter, IRVariable, IRCall } from "../ir/types.js";

export function nodeOwnerFnId(node: IRNode): string | null {
  if (node.kind === "Parameter") return (node as IRParameter).ownerFnId;
  if (node.kind === "Variable") return (node as IRVariable).ownerFnId;
  if (node.kind === "Call") return (node as IRCall).ownerFnId;
  return null;
}

export function nodeScopePath(node: IRNode): string[] {
  return node.scopePath ?? [];
}

/**
 * ¿El ámbito de la def encierra al del uso? Se cumple cuando la cadena de
 * ámbitos de la def es prefijo de la del uso: la def está en el mismo bloque
 * o en uno más externo. Dos bloques hermanos —dos `case`, las dos ramas de un
 * `if`— divergen en algún segmento, así que no se ven entre sí.
 *
 * Una def sin `scopePath` (IR de una versión anterior) no se filtra, para
 * degradar hacia la sobre-aproximación previa y no perder hallazgos.
 */
export function scopeEncloses(defPath: string[], usePath: string[]): boolean {
  if (defPath.length === 0) return true;
  if (defPath.length > usePath.length) return false;
  return defPath.every((segment, i) => segment === usePath[i]);
}

/**
 * Defs visibles desde un uso: mismo ámbito de función y, dentro de ella,
 * mismo bloque o uno que lo contenga.
 */
export function defsInScope(
  defs: IRNode[],
  useOwnerFnId: string | null,
  useScopePath?: string[],
): IRNode[] {
  const byFunction = useOwnerFnId
    ? defs.filter((d) => nodeOwnerFnId(d) === useOwnerFnId)
    : defs;
  if (!useScopePath || useScopePath.length === 0) return byFunction;
  return byFunction.filter((d) => scopeEncloses(nodeScopePath(d), useScopePath));
}
