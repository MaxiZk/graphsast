import type { AnalysisPayload, ScanFilesOutput, TaintRoles } from "@graphsast/core/browser";

/** Archivo elegido por el usuario, con su ruta relativa a lo que subió. */
export interface UploadedFile {
  path: string;
  file: File;
}

export interface CatalogSummary {
  cwe: number;
  name: string;
  description?: string;
  sinks: number;
  sanitizers: number;
}

export interface ProjectAnalysis {
  output: ScanFilesOutput;
  /** Contenido de cada archivo analizado, para mostrarlo sin volver a leerlo. */
  contents: Record<string, string>;
  /** Roles de cada grafo de `output.graphs`, para colorear sources y sinks. */
  roles: TaintRoles[];
  /** Totales de roles sobre todos los grafos: distinguen «limpio» de «nada que evaluar». */
  sources: number;
  sinks: number;
  rules: Record<string, string>;
  catalog: CatalogSummary[];
}

export type WorkerRequest =
  | { id: number; kind: "snippet"; code: string; file: string }
  | { id: number; kind: "project"; files: UploadedFile[] };

export type WorkerResponse =
  | { id: number; kind: "progress"; done: number; total: number; file: string }
  | { id: number; kind: "snippet"; payload: AnalysisPayload }
  | { id: number; kind: "project"; analysis: ProjectAnalysis }
  | { id: number; kind: "error"; message: string };
