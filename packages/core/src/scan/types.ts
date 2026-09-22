import type { IRNodeKind } from "../ir/types.js";

/** Un paso del camino de taint, ya resuelto a ubicación y código fuente. */
export interface ScanStep {
  kind: IRNodeKind;
  name: string;
  code: string;
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
}

/** Hallazgo listo para reportar: sin ids internos, con ubicaciones. */
export interface ScanFinding {
  file: string;
  cwe?: number;
  cweName?: string;
  ruleId?: string;
  source: ScanStep;
  sink: ScanStep;
  /** Camino completo source → sink, incluidos ambos extremos. */
  steps: ScanStep[];
}

export interface ScanFileResult {
  file: string;
  findings: ScanFinding[];
  lineCount: number;
  nodeCount: number;
  edgeCount: number;
  elapsedMs: number;
  /** Mensaje si el archivo no pudo analizarse (no aborta el escaneo). */
  error?: string;
}

export interface ScanTotals {
  files: number;
  filesWithFindings: number;
  findings: number;
  lines: number;
  elapsedMs: number;
  errors: number;
}

export interface ScanResult {
  analyzedAt: string;
  root: string;
  files: ScanFileResult[];
  findings: ScanFinding[];
  totals: ScanTotals;
}

export interface ScanOptions {
  /** Extensiones a incluir (con punto). */
  extensions?: string[];
  /** Nombres de carpeta a excluir (se suman a ALWAYS_IGNORE). */
  ignore?: string[];
  /** Patrones con sintaxis .gitignore, relativos a cada carpeta escaneada. */
  exclude?: string[];
  /** Respetar los .gitignore del proyecto analizado (default: true). */
  gitignore?: boolean;
  /** Omitir archivos mayores a este tamaño (bytes). */
  maxFileBytes?: number;
  /** Profundidad máxima del BFS de taint. */
  maxDepth?: number;
  /** Filtrar por CWE (vacío = todos). */
  cwe?: number[];
}

export const DEFAULT_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"];

/** Carpetas excluidas siempre, aunque `ignore` reemplace la lista por defecto. */
export const ALWAYS_IGNORE = ["node_modules", ".git", "dist", "build", "coverage"];

export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "vendor",
  ".venv",
];

export const DEFAULT_MAX_FILE_BYTES = 1_000_000;
