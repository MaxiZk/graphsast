import type { AnalysisPayload } from "@graphsast/core/browser";
import type {
  ProjectAnalysis,
  UploadedFile,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.js";

type Progress = (done: number, total: number, file: string) => void;

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  onProgress?: Progress;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(reason: Error) {
  for (const p of pending.values()) p.reject(reason);
  pending.clear();
  // Un worker que falló al cargar no se recupera: el próximo pedido crea otro.
  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.kind === "progress") {
      p.onProgress?.(msg.done, msg.total, msg.file);
      return;
    }
    pending.delete(msg.id);
    if (msg.kind === "error") p.reject(new Error(msg.message));
    else if (msg.kind === "snippet") p.resolve(msg.payload as never);
    else p.resolve(msg.analysis as never);
  });
  worker.addEventListener("error", (event) => {
    failAll(new Error(event.message || "El analizador no pudo iniciarse en este navegador."));
  });
  return worker;
}

function request<T>(message: WorkerRequest, onProgress?: Progress): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(message.id, { resolve: resolve as (v: never) => void, reject, onProgress });
    ensureWorker().postMessage(message);
  });
}

/** Analiza un fragmento pegado o de ejemplo. */
export function analyzeSnippet(code: string, file: string): Promise<AnalysisPayload> {
  return request({ id: nextId++, kind: "snippet", code, file });
}

/** Analiza los archivos subidos, con llamadas entre archivos. */
export function analyzeProject(
  files: UploadedFile[],
  onProgress?: Progress,
): Promise<ProjectAnalysis> {
  return request({ id: nextId++, kind: "project", files }, onProgress);
}
