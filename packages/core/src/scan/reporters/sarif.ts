import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ScanFinding, ScanResult, ScanStep } from "../types.js";

/**
 * SARIF 2.1.0 — formato que consume GitHub Code Scanning.
 * El camino de taint se emite como `codeFlows`, de modo que GitHub muestra
 * el recorrido paso a paso en vez de solo la línea del sink.
 */
export interface SarifOptions {
  toolVersion?: string;
  informationUri?: string;
  /**
   * Directorio contra el que se expresan las URIs (default: cwd). GitHub
   * interpreta las rutas relativas como relativas a la raíz del repositorio,
   * así que en CI tiene que ser esa raíz, no la carpeta escaneada.
   */
  baseDir?: string;
  /** Familias activas del catálogo: una regla SARIF por familia. */
  families?: SarifFamily[];
}

export interface SarifFamily {
  cwe: number;
  name: string;
  description?: string;
}

const SRCROOT = "%SRCROOT%";
/** Límite de GitHub para shortDescription y fullDescription. */
const MAX_DESCRIPTION = 1024;

function familyIdOf(cwe: number | undefined): string {
  return cwe ? `cwe-${cwe}` : "graphsast-taint";
}

function clip(text: string): string {
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 3)}...` : text;
}

/** Relativa a `baseDir` si el archivo está adentro; si no, URI `file:` absoluta. */
function artifactLocationOf(root: string, file: string, baseDir: string) {
  const abs = path.resolve(root, file.split("\\").join("/"));
  const rel = path.relative(baseDir, abs);
  const outside = rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (rel && !outside) {
    return { uri: rel.split(path.sep).join("/"), uriBaseId: SRCROOT };
  }
  return { uri: pathToFileURL(abs).href };
}

function regionOf(s: ScanStep) {
  const startLine = Math.max(1, s.line);
  const startColumn = Math.max(1, s.col);
  const endLine = Math.max(startLine, s.endLine ?? startLine);
  const endColumn = s.endCol ?? startColumn + 1;
  return {
    startLine,
    startColumn,
    endLine,
    endColumn: endLine === startLine ? Math.max(startColumn + 1, endColumn) : endColumn,
    ...(s.code ? { snippet: { text: s.code } } : {}),
  };
}

function ruleOf(cwe: number | undefined, name: string, description?: string) {
  const summary = description
    ?? "Un dato de entrada no confiable alcanza un sink sensible sin atravesar un sanitizer.";
  return {
    id: familyIdOf(cwe),
    name,
    shortDescription: { text: clip(name) },
    fullDescription: { text: clip(summary) },
    help: {
      text: `${summary}${cwe ? ` Ver https://cwe.mitre.org/data/definitions/${cwe}.html` : ""}`,
    },
    defaultConfiguration: { level: "error" },
    ...(cwe
      ? {
          helpUri: `https://cwe.mitre.org/data/definitions/${cwe}.html`,
          properties: { tags: ["security", `external/cwe/cwe-${cwe}`] },
        }
      : { properties: { tags: ["security"] } }),
  };
}

export function reportToSarif(
  result: ScanResult,
  options: SarifOptions = {},
): string {
  const baseDir = path.resolve(options.baseDir ?? process.cwd());
  const where = (file: string) => artifactLocationOf(result.root, file, baseDir);

  // Una regla por familia CWE: las activas del catálogo y, por las dudas,
  // cualquier familia que aparezca en un hallazgo y no esté en la lista.
  const rules = new Map<string, ReturnType<typeof ruleOf>>();
  for (const fam of options.families ?? []) {
    rules.set(familyIdOf(fam.cwe), ruleOf(fam.cwe, fam.name, fam.description));
  }
  for (const f of result.findings) {
    const id = familyIdOf(f.cwe);
    if (!rules.has(id)) rules.set(id, ruleOf(f.cwe, f.cweName ?? "Flujo no sanitizado"));
  }
  const ruleIds = [...rules.keys()];

  const results = result.findings.map((f: ScanFinding) => ({
    ruleId: familyIdOf(f.cwe),
    ruleIndex: ruleIds.indexOf(familyIdOf(f.cwe)),
    level: "error",
    message: {
      text: `${f.cweName ?? "Flujo no sanitizado"}: `
        + `\`${f.source.name || f.source.code}\` (`
        + `${f.source.file === f.file ? "" : `${f.source.file}, `}línea ${f.source.line}) alcanza `
        + `\`${f.sink.name || f.sink.code}\` (línea ${f.sink.line}) sin sanitizar.`,
    },
    locations: [
      { physicalLocation: { artifactLocation: where(f.file), region: regionOf(f.sink) } },
    ],
    codeFlows: [
      {
        threadFlows: [
          {
            locations: f.steps.map((s) => ({
              location: {
                physicalLocation: { artifactLocation: where(s.file), region: regionOf(s) },
                message: { text: `${s.kind}: ${s.name || s.code}` },
              },
            })),
          },
        ],
      },
    ],
    ...(f.ruleId ? { properties: { "graphsast/sinkRule": f.ruleId } } : {}),
  }));

  const failed = result.files.filter((r) => r.error);

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "GraphSAST",
            version: options.toolVersion ?? "0.0.0",
            informationUri:
              options.informationUri ?? "https://github.com/MaxiZk/graphsast",
            rules: [...rules.values()],
          },
        },
        originalUriBaseIds: {
          [SRCROOT]: { uri: `${pathToFileURL(baseDir).href.replace(/\/?$/, "/")}` },
        },
        // Un análisis parcial tiene que verse también en SARIF, no solo en el exit code.
        invocations: [
          {
            executionSuccessful: result.totals.files > 0 && failed.length === 0,
            toolExecutionNotifications: failed.map((r) => ({
              level: "error",
              message: { text: r.error! },
              locations: [{ physicalLocation: { artifactLocation: where(r.file) } }],
            })),
          },
        ],
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
