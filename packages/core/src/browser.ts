/**
 * Punto de entrada para el navegador: el análisis completo sin nada que
 * dependa de Node (disco, servidor HTTP, Neo4j). Lo usa la versión web, que
 * analiza en el navegador los archivos que sube el usuario.
 *
 * El catálogo CWE se carga desde el disco en `catalog/load.ts`; quien empaquete
 * este módulo para el navegador tiene que reemplazar ese archivo por uno que
 * entregue el mismo `CatalogBundle` (ver `packages/viz/vite.config.ts`).
 */
export * from "./ir/types.js";
export { analyzeGraph, graphFromSourceFile } from "./ir/graph.js";
export { parseSource } from "./parser/parser.js";
export type { ParseResult, Dialect } from "./parser/parser.js";
export { analyzeTaint, getTaintRoles } from "./taint/analyzer.js";
export type { TaintConfig, TaintFinding, TaintRule, TaintRoles } from "./taint/types.js";
export { getRuleLabels, getCatalogBundle, taintRulesFor } from "./taint/rules.js";
export type { SourceMode } from "./catalog/rules.js";
export type { CweCatalogEntry, CatalogBundle } from "./catalog/types.js";
export { buildVerdict, vulnerableDetail } from "./engine/verdict.js";
export type { Verdict, VerdictKind } from "./engine/verdict.js";
export { analyzeSource } from "./engine/payload.js";
export type { AnalysisPayload } from "./engine/payload.js";
export { scanFiles, scanFilesWithGraphs, scanSource } from "./scan/scan-files.js";
export type { ScanInput, ScanGraph, ScanFilesOutput } from "./scan/scan-files.js";
export {
  ALWAYS_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_BYTES,
  GRAPHSAST_IGNORE_FILE,
} from "./scan/types.js";
export type {
  ScanResult,
  ScanFileResult,
  ScanFinding,
  ScanStep,
  ScanOptions,
  ScanTotals,
} from "./scan/types.js";
export { isProjectConfigName } from "./project/config-name.js";
export { VERSION } from "./version.js";
