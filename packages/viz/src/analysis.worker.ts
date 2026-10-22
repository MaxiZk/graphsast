/*
 * Corre el análisis fuera del hilo de la página: parsear una carpeta entera
 * con el compilador de TypeScript congelaría la interfaz. Todo sucede en el
 * navegador; el código del usuario no sale de su equipo.
 */

import {
  analyzeSource,
  getCatalogBundle,
  getRuleLabels,
  getTaintRoles,
  scanFilesWithGraphs,
  taintRulesFor,
  type ScanInput,
  type SourceMode,
} from "@graphsast/core/browser";
import type {
  CatalogSummary,
  ProjectAnalysis,
  UploadedFile,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.js";
import { ensureLanguagesFor } from "./grammars.js";

function reply(message: WorkerResponse) {
  self.postMessage(message);
}

function catalogSummary(): CatalogSummary[] {
  return getCatalogBundle().entries.map((e) => ({
    cwe: e.cwe,
    name: e.name,
    description: e.description ?? "",
    sinks: e.sinks.length,
    sanitizers: e.sanitizers.length,
  }));
}

async function readAll(files: UploadedFile[]): Promise<ScanInput[]> {
  return Promise.all(
    files.map(async ({ path, file }): Promise<ScanInput> => {
      try {
        return { path, content: await file.text() };
      } catch (err) {
        return { path, error: `No se pudo leer el archivo: ${String(err)}` };
      }
    }),
  );
}

async function analyzeProject(
  id: number,
  files: UploadedFile[],
  configs: UploadedFile[],
  sourceMode: SourceMode,
): Promise<ProjectAnalysis> {
  const inputs = await readAll(files);
  await ensureLanguagesFor(inputs.map((i) => i.path));
  // Los tsconfig van entre los archivos: el escaneo los separa y usa sus alias.
  const configInputs = (await readAll(configs)).filter((c) => "content" in c);
  const output = scanFilesWithGraphs(
    [...inputs, ...configInputs],
    { sources: sourceMode },
    "",
    (done, total, file) => reply({ id, kind: "progress", done, total, file }),
  );
  // Las mismas reglas que el escaneo: el grafo marca como entrada lo que el análisis usó.
  const roles = output.graphs.map(({ graph }) =>
    getTaintRoles(graph, { rules: taintRulesFor(sourceMode, graph.language) }));
  const sources = roles.reduce((n, r) => n + r.sourceIds.length, 0);
  const sinks = roles.reduce((n, r) => n + r.sinkIds.length, 0);
  const contents: Record<string, string> = {};
  for (const input of inputs) {
    if ("content" in input) contents[input.path] = input.content;
  }
  return {
    output,
    contents,
    roles,
    sources,
    sinks,
    rules: getRuleLabels(),
    catalog: catalogSummary(),
  };
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === "snippet") {
      await ensureLanguagesFor([request.file]);
      reply({ id: request.id, kind: "snippet", payload: analyzeSource(request.code, request.file) });
    } else {
      reply({ id: request.id, kind: "project", analysis: await analyzeProject(request.id, request.files, request.configs, request.sources) });
    }
  } catch (err) {
    reply({ id: request.id, kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
