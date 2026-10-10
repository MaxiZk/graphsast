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
 * Defs visibles desde un uso, por ámbito léxico.
 *
 * Una def es visible si su ámbito encierra al del uso, también a través de
 * funciones: una closure ve las variables de la función que la envuelve
 * (`run(() => db.query(q))`). Si varias lo son, gana la del ámbito más
 * interno, que es la que sombrea a las demás: `const q = "x"` dentro de la
 * closure tapa la `q` contaminada de afuera.
 *
 * Sin `useScopePath` (IR de una versión anterior) se aproxima como antes:
 * defs de la misma función.
 */
export function defsInScope(
  defs: IRNode[],
  useOwnerFnId: string | null,
  useScopePath?: string[],
): IRNode[] {
  if (!useScopePath || useScopePath.length === 0) {
    return useOwnerFnId
      ? defs.filter((d) => nodeOwnerFnId(d) === useOwnerFnId)
      : defs;
  }
  const visible = defs.filter((d) => scopeEncloses(nodeScopePath(d), useScopePath));
  if (visible.length <= 1) return visible;
  const innermost = Math.max(...visible.map((d) => nodeScopePath(d).length));
  return visible.filter((d) => nodeScopePath(d).length === innermost);
}
