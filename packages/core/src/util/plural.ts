/**
 * Concordancia de número para texto de salida.
 *
 * Vive acá y no dentro de un módulo porque lo usan el veredicto y el informe
 * HTML: dos copias del mismo helper se desincronizan, y estas plantillas son
 * justo las que se leen proyectadas o se entregan como entregable.
 */
export function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}
