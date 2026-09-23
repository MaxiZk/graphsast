import type { ScanFilesOutput, ScanFinding, Verdict } from "@graphsast/core/browser";
import { plural } from "./labels.js";

/** Hallazgo del proyecto con el grafo donde se encontró, para poder dibujarlo. */
export interface ProjectFinding {
  finding: ScanFinding;
  /** Índice en `output.graphs`. */
  graphIndex: number;
  /** Índice del hallazgo crudo dentro de ese grafo. */
  findingIndex: number;
}

/** Hallazgos de todos los grafos, ordenados por archivo y línea del sink. */
export function projectFindings(output: ScanFilesOutput): ProjectFinding[] {
  const all = output.graphs.flatMap((g, graphIndex) =>
    g.scanFindings.map((finding, findingIndex) => ({ finding, graphIndex, findingIndex })),
  );
  return all.sort(
    (a, b) =>
      a.finding.file.localeCompare(b.finding.file)
      || a.finding.sink.line - b.finding.sink.line,
  );
}

/** Índice del grafo que contiene el archivo, o -1 si no se pudo analizar. */
export function graphIndexOfFile(output: ScanFilesOutput, file: string): number {
  return output.graphs.findIndex((g) => g.files.includes(file));
}

/** Líneas del camino que caen en `file`: un camino entre archivos cruza varios. */
export function linesInFile(finding: ScanFinding, file: string): Set<number> {
  return new Set(finding.steps.filter((s) => s.file === file && s.line > 0).map((s) => s.line));
}

export function findingHeading(finding: ScanFinding): string {
  return finding.cwe ? `CWE-${finding.cwe} · ${finding.cweName ?? ""}`.trim() : "Flujo sin sanitizar";
}

export function findingLocation(finding: ScanFinding): string {
  return `${finding.file}:${finding.sink.line}`;
}

/** `req → q → db.query`, marcando los saltos a otro archivo. */
export function findingPath(finding: ScanFinding): string {
  return finding.steps
    .map((s, i) => {
      const prev = finding.steps[i - 1];
      return prev && prev.file !== s.file ? `[${s.file}] ${s.name}` : s.name;
    })
    .join(" → ");
}

/**
 * Veredicto del proyecto, con la misma distinción que el de un archivo: «0
 * hallazgos» no es lo mismo si no se pudo analizar nada, si no había nada que
 * evaluar o si se evaluó y está limpio.
 */
export function projectVerdict(
  output: ScanFilesOutput,
  roles: { sources: number; sinks: number },
): Verdict {
  const { totals } = output.result;
  const analyzed = totals.files - totals.errors;
  const base = {
    sources: roles.sources,
    sinks: roles.sinks,
    findings: totals.findings,
    syntaxErrors: totals.errors,
  };
  const skipped = totals.errors > 0
    ? ` ${plural(totals.errors, "archivo no se pudo analizar", "archivos no se pudieron analizar")}.`
    : "";

  if (analyzed === 0) {
    return {
      ...base,
      kind: "not-analyzable",
      conclusive: false,
      title: totals.files === 0
        ? "No hay archivos JavaScript o TypeScript para analizar"
        : "No se pudo analizar ningún archivo",
      detail: totals.files === 0
        ? "GraphSAST analiza archivos .js, .jsx, .mjs, .cjs, .ts y .tsx fuera de "
          + "node_modules, dist y build."
        : `Los ${plural(totals.files, "archivo tiene", "archivos tienen")} errores de sintaxis `
          + "o no son JavaScript/TypeScript.",
    };
  }

  if (totals.findings > 0) {
    return {
      ...base,
      kind: "vulnerable",
      conclusive: true,
      title: `${plural(totals.findings, "vulnerabilidad detectada", "vulnerabilidades detectadas")} `
        + `en ${plural(totals.filesWithFindings, "archivo", "archivos")}`,
      detail:
        `Hay ${plural(totals.findings, "camino", "caminos")} de datos desde una entrada `
        + `no confiable hasta una operación peligrosa, sin sanitizador en el medio.${skipped}`,
    };
  }

  if (roles.sources === 0 || roles.sinks === 0) {
    return {
      ...base,
      kind: "no-coverage",
      conclusive: false,
      title: "Sin vulnerabilidades, pero no hay nada que evaluar",
      detail:
        `Se analizaron ${plural(analyzed, "archivo", "archivos")}, pero hay `
        + `${plural(roles.sources, "source", "sources")} y ${plural(roles.sinks, "sink", "sinks")}. `
        + `El resultado no afirma que el código sea seguro.${skipped}`,
    };
  }

  return {
    ...base,
    kind: "clean",
    conclusive: true,
    title: "Sin caminos source → sink sin sanitizar",
    detail:
      `Se recorrieron los caminos de ${plural(analyzed, "archivo", "archivos")}, incluidas las `
      + `llamadas entre archivos, y ninguno llega sin sanitizar.${skipped}`,
  };
}
