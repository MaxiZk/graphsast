import type { IRNodeKind } from "../ir/types.js";
import type { AliasResolver } from "../project/tsconfig.js";

/** Un paso del camino de taint, ya resuelto a ubicación y código fuente. */
export interface ScanStep {
  /** Archivo del paso: con análisis entre archivos, un camino cruza varios. */
  file: string;
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
  /** Archivo del sink. */
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
  /** Llamadas resueltas a funciones de otro archivo del escaneo. */
  crossFileCalls: number;
}

export interface ScanResult {
  analyzedAt: string;
  root: string;
  files: ScanFileResult[];
  findings: ScanFinding[];
  totals: ScanTotals;
}

/**
 * Archivo con sintaxis .gitignore para excluir rutas del análisis sin
 * sacarlas de git: casos vulnerables a propósito, fixtures, tests.
 */
export const GRAPHSAST_IGNORE_FILE = ".graphsastignore";

export interface ScanOptions {
  /** Extensiones a incluir (con punto). */
  extensions?: string[];
  /** Nombres de carpeta a excluir (se suman a ALWAYS_IGNORE). */
  ignore?: string[];
  /** Patrones con sintaxis .gitignore, relativos a cada carpeta escaneada. */
  exclude?: string[];
  /**
   * Respetar los .gitignore del proyecto analizado (default: true). Los
   * `.graphsastignore` se respetan siempre.
   */
  gitignore?: boolean;
  /** Omitir archivos mayores a este tamaño (bytes). */
  maxFileBytes?: number;
  /** Seguir llamadas a funciones importadas de otros archivos (default: true). */
  crossFile?: boolean;
  /** Profundidad máxima del BFS de taint. */
  maxDepth?: number;
  /** Filtrar por CWE (vacío = todos). */
  cwe?: number[];
  /** Qué parámetros son entradas no confiables (default: `params`). */
  sources?: "params" | "catalog";
  /**
   * Alias de imports (`@/x`) en el espacio de rutas del escaneo (`/` + ruta
   * relativa). `scanPaths` lo arma con los tsconfig del disco; sin esto se
   * usan los tsconfig/jsconfig que vengan entre los archivos.
   */
  aliases?: AliasResolver;
}

export const DEFAULT_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".java", ".php", ".go"];

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
  // Plugins y versiones de Yarn guardados en el proyecto: código de terceros
  // empaquetado (un plugin de 900 KB tardaba minutos en analizarse).
  ".yarn",
];

export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

/**
 * Bibliotecas minificadas (`jquery.min.js`, `jquery-3.2.1-min.js`) y el
 * cargador que genera Yarn PnP (`.pnp.cjs`): código de terceros o generado,
 * sin nombres legibles. Al recorrer una carpeta no se analizan; nombrados
 * directamente, sí.
 */
export function isMinifiedName(name: string): boolean {
  return /[.-]min\.[cm]?js$/i.test(name) || /^\.pnp\.(?:c?js|loader\.mjs)$/.test(name);
}

/**
 * `materialize.js` junto a `materialize.min.js`: la versión legible de una
 * biblioteca copiada al proyecto con su minificada. `paths` son las rutas de
 * la misma carpeta o del proyecto entero, con `/`.
 */
export function hasMinifiedTwin(path: string, paths: ReadonlySet<string>): boolean {
  const match = /^(.*)\.([cm]?js)$/i.exec(path);
  if (!match || isMinifiedName(path.slice(path.lastIndexOf("/") + 1))) return false;
  return paths.has(`${match[1]}.min.${match[2]}`) || paths.has(`${match[1]}-min.${match[2]}`);
}
