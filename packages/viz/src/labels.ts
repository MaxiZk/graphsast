/** Concordancia de número. Compartido con el veredicto de respaldo de main.ts. */
export function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * Lectura cuando no hay hallazgo. Distingue «no hay nada que evaluar» de
 * «hay qué evaluar y da limpio»: un panel que dijera lo mismo en los dos
 * casos afirmaría seguridad donde solo hubo falta de cobertura.
 */
export function describeNoFinding(sources: number, sinks: number): string {
  if (sources === 0 || sinks === 0) {
    return (
      "No hay camino que describir: el código tiene "
      + `${plural(sources, "entrada", "entradas")} y `
      + `${plural(sinks, "operación sensible", "operaciones sensibles")}.`
    );
  }
  return (
    `Ningún dato llega de ${plural(sources, "entrada", "entradas")} a `
    + `${plural(sinks, "operación sensible", "operaciones sensibles")} `
    + "sin pasar por una función de saneamiento."
  );
}
