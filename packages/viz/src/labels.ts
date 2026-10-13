import type { IREdgeKind, IRNodeKind } from "@graphsast/core/browser";

/** Concordancia de número. Compartido con el veredicto de respaldo de main.ts. */
export function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/** Cómo se muestra cada tipo de nodo: el nombre interno (`Parameter`) es jerga. */
export const NODE_KIND_LABEL: Record<IRNodeKind, string> = {
  Function: "Función",
  Parameter: "Parámetro",
  Variable: "Variable",
  Literal: "Valor fijo",
  Call: "Llamada",
};

/** Cómo se muestra cada tipo de arista; los filtros siguen usando el nombre interno. */
export const EDGE_KIND_LABEL: Record<IREdgeKind, string> = {
  FLOWS_TO: "pasa a",
  CALLS: "llama a",
  BINDS_TO: "entra como parámetro",
  RETURNS: "devuelve",
  SANITIZED_BY: "filtrado",
};

/**
 * Lectura cuando no hay hallazgo. Distingue «no hay nada que evaluar» de
 * «hay qué evaluar y da limpio»: un panel que dijera lo mismo en los dos
 * casos afirmaría seguridad donde solo hubo falta de cobertura.
 */
export function describeNoFinding(sources: number, sinks: number): string {
  if (sources === 0 || sinks === 0) {
    return (
      "No hay camino que describir: el código tiene "
      + `${plural(sources, "entrada del usuario", "entradas del usuario")} y `
      + `${plural(sinks, "operación peligrosa", "operaciones peligrosas")}.`
    );
  }
  return (
    `Ningún dato llega de ${plural(sources, "entrada del usuario", "entradas del usuario")} a `
    + `${plural(sinks, "operación peligrosa", "operaciones peligrosas")} `
    + "sin pasar por un filtro."
  );
}
