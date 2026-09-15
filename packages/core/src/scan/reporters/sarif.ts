import type { ScanFinding, ScanResult } from "../types.js";

/**
 * SARIF 2.1.0 — formato que consume GitHub Code Scanning.
 * El camino de taint se emite como `codeFlows`, de modo que GitHub muestra
 * el recorrido paso a paso en vez de solo la línea del sink.
 */
export interface SarifOptions {
  toolVersion?: string;
  informationUri?: string;
}

function ruleIdOf(f: ScanFinding): string {
  return f.ruleId ?? (f.cwe ? `cwe-${f.cwe}` : "graphsast-taint");
}

function locationOf(file: string, line: number, col: number, snippet?: string) {
  return {
    physicalLocation: {
      artifactLocation: { uri: file.split("\\").join("/") },
      region: {
        startLine: Math.max(1, line),
        startColumn: Math.max(1, col),
        ...(snippet ? { snippet: { text: snippet } } : {}),
      },
    },
  };
}

export function reportToSarif(
  result: ScanResult,
  options: SarifOptions = {},
): string {
  const rules = new Map<string, Record<string, unknown>>();
  for (const f of result.findings) {
    const id = ruleIdOf(f);
    if (rules.has(id)) continue;
    rules.set(id, {
      id,
      name: f.cweName ?? "TaintedFlow",
      shortDescription: {
        text: f.cweName ?? "Flujo de datos no sanitizado",
      },
      fullDescription: {
        text: `Un dato de entrada no confiable alcanza un sink sensible sin `
          + `atravesar un sanitizer.${f.cwe ? ` Clasificado como CWE-${f.cwe}.` : ""}`,
      },
      defaultConfiguration: { level: "error" },
      ...(f.cwe
        ? {
            properties: {
              tags: ["security", `external/cwe/cwe-${f.cwe}`],
            },
            helpUri: `https://cwe.mitre.org/data/definitions/${f.cwe}.html`,
          }
        : {}),
    });
  }

  const results = result.findings.map((f) => ({
    ruleId: ruleIdOf(f),
    level: "error",
    message: {
      text: `${f.cweName ?? "Flujo no sanitizado"}: `
        + `\`${f.source.name || f.source.code}\` (línea ${f.source.line}) alcanza `
        + `\`${f.sink.name || f.sink.code}\` (línea ${f.sink.line}) sin sanitizar.`,
    },
    locations: [locationOf(f.file, f.sink.line, f.sink.col, f.sink.code)],
    codeFlows: [
      {
        threadFlows: [
          {
            locations: f.steps.map((s) => ({
              location: {
                ...locationOf(f.file, s.line, s.col, s.code),
                message: { text: `${s.kind}: ${s.name || s.code}` },
              },
            })),
          },
        ],
      },
    ],
  }));

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
              options.informationUri ?? "https://github.com/mzuidwijk/graphsast",
            rules: [...rules.values()],
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
