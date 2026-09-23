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
  type ScanInput,
} from "@graphsast/core/browser";
import type {
  CatalogSummary,
  ProjectAnalysis,
  UploadedFile,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.js";

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

async function analyzeProject(id: number, files: UploadedFile[]): Promise<ProjectAnalysis> {
  const inputs = await readAll(files);
  const output = scanFilesWithGraphs(inputs, {}, "", (done, total, file) =>
    reply({ id, kind: "progress", done, total, file }),
  );
  const roles = output.graphs.map(({ graph }) => getTaintRoles(graph));
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
      reply({ id: request.id, kind: "snippet", payload: analyzeSource(request.code, request.file) });
    } else {
      reply({ id: request.id, kind: "project", analysis: await analyzeProject(request.id, request.files) });
    }
  } catch (err) {
    reply({ id: request.id, kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
