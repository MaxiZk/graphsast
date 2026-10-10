import type { IRGraph } from "../ir/types.js";
import type { TaintFinding, TaintRoles } from "../taint/types.js";
import type { ParseResult } from "../parser/parser.js";
import { plural } from "../util/plural.js";

export type VerdictKind =
  /** El parser no entendió el texto: no hay veredicto que dar. */
  | "not-analyzable"
  /** Se analizó, pero faltan sources o sinks: el verde es trivial. */
  | "no-coverage"
  /** Hay sources y sinks, y ningún camino sin sanitizar entre ellos. */
  | "clean"
  /** Hay al menos un camino source → sink sin sanitizar. */
  | "vulnerable";

export interface Verdict {
  kind: VerdictKind;
  /** Titular corto, apto para encabezar el panel o la salida del CLI. */
  title: string;
  /** Qué significa exactamente, incluido lo que el veredicto NO afirma. */
  detail: string;
  /** true solo cuando el resultado sostiene una afirmación sobre seguridad. */
  conclusive: boolean;
  sources: number;
  sinks: number;
  findings: number;
  syntaxErrors: number;
}

export interface VerdictInput {
  graph: IRGraph;
  roles: TaintRoles;
  findings: TaintFinding[];
  parse: Pick<ParseResult, "syntaxErrors" | "messages" | "dialect">;
}

/**
 * Traduce el resultado del análisis a una afirmación que se sostiene.
 *
 * Existe porque «0 hallazgos» tiene tres causas muy distintas —no se entendió
 * el código, no hay nada que evaluar, o se evaluó y está limpio— y presentar
 * las tres como el mismo tilde verde es afirmar de más. Solo la tercera es
 * concluyente.
 */
export function buildVerdict(input: VerdictInput): Verdict {
  const sources = input.roles.sourceIds.length;
  const sinks = input.roles.sinkIds.length;
  const findings = input.findings.length;
  const syntaxErrors = input.parse.syntaxErrors;

  const base = { sources, sinks, findings, syntaxErrors };

  if (syntaxErrors > 0) {
    const muestra = input.parse.messages.length
      ? ` Primer error — ${input.parse.messages[0]}`
      : "";
    return {
      ...base,
      kind: "not-analyzable",
      conclusive: false,
      title: "No se pudo analizar este código",
      detail:
        `El parser encontró ${plural(syntaxErrors, "error", "errores")} de `
        + "sintaxis, así que no llegó a construir el grafo. "
        + "GraphSAST solo analiza JavaScript y "
        + `TypeScript: si esto es Go, Python, Java o PHP, no está soportado.${muestra}`,
    };
  }

  if (findings > 0) {
    return {
      ...base,
      kind: "vulnerable",
      conclusive: true,
      title: plural(
        findings,
        "vulnerabilidad detectada",
        "vulnerabilidades detectadas",
      ),
      detail:
        `Hay ${plural(findings, "camino", "caminos")} de datos desde una `
        + "entrada no confiable hasta una operación peligrosa, "
        + "sin sanitizador en el medio.",
    };
  }

  if (sources === 0 || sinks === 0) {
    const falta = sinks === 0 && sources === 0
      ? "ni entradas no confiables ni operaciones peligrosas"
      : sinks === 0
        ? "ninguna operación peligrosa (sink) del catálogo"
        : "ninguna entrada no confiable (source)";
    return {
      ...base,
      kind: "no-coverage",
      conclusive: false,
      title: "Sin vulnerabilidades, pero no hay nada que evaluar",
      detail:
        `Se analizó el código correctamente, pero no contiene ${falta}. `
        + "El resultado no afirma que el código sea seguro: afirma que este "
        + "catálogo no tiene nada que revisar acá "
        + `(${plural(sources, "source", "sources")}, `
        + `${plural(sinks, "sink", "sinks")}).`,
    };
  }

  return {
    ...base,
    kind: "clean",
    conclusive: true,
    title: "Sin caminos source → sink sin sanitizar",
    detail:
      `Se recorrieron los caminos entre ${plural(sources, "source", "sources")} `
      + `y ${plural(sinks, "sink", "sinks")} `
      + "y ninguno llega sin sanitizar. Alcance: este archivo; el flujo que "
      + "entra o sale por imports no se sigue.",
  };
}
