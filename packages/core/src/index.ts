import { loadSource } from "./parser/parser.js";
import { buildIR } from "./ir/builder.js";
import { analyzeGraph } from "./ir/graph.js";
import { analyzeTaint } from "./taint/analyzer.js";
import type { IRModule } from "./ir/types.js";

export * from "./ir/types.js";
export { analyzeGraph, graphFromSourceFile } from "./ir/graph.js";
export { buildCallGraph } from "./cfg/callgraph.js";
export { buildDataFlow } from "./dfg/dataflow.js";
export { buildInterproc } from "./dfg/interproc.js";
export { analyzeTaint, getTaintRoles } from "./taint/analyzer.js";
export { markSanitizedEdges } from "./taint/sanitized.js";
export { parseSource, loadSource } from "./parser/parser.js";
export type { ParseResult, Dialect } from "./parser/parser.js";
export { buildVerdict } from "./engine/verdict.js";
export type { Verdict, VerdictKind, VerdictInput } from "./engine/verdict.js";
export { defaultTaintRules, getRuleLabels, getCatalogBundle, RULE_LABELS } from "./taint/rules.js";
export { findPath, reaches, DEFAULT_TAINT_PROPAGATE_EDGES } from "./taint/reach.js";
export type { TaintConfig, TaintFinding, TaintRule, TaintRoles } from "./taint/types.js";

export { loadCatalogBundle, defaultCatalogDir } from "./catalog/load.js";
export { rulesFromCatalog, labelsFromCatalog, calleeMatchesPattern } from "./catalog/rules.js";
export type { CweCatalogEntry, CatalogBundle } from "./catalog/types.js";

export {
  buildPersistStatements,
  TAINT_PATH_CYPHER,
} from "./store/cypher.js";
export {
  createNeo4jDriver,
  persistGraph,
  queryTaintPaths,
  verifyNeo4j,
  neo4jConfigFromEnv,
} from "./store/neo4j.js";
export type { Neo4jConfig } from "./store/neo4j.js";

export {
  analyzeInMemory,
  analyzeWithEngine,
} from "./engine/analyze.js";
export type { EngineResult, EngineOptions, TaintEngine } from "./engine/analyze.js";

export { buildAnalysisReport, reportToJson } from "./report/json.js";
export { reportToHtml } from "./report/html.js";
export type { AnalysisReport } from "./report/json.js";

export { scanPaths, scanSource, toScanFindings } from "./scan/scan.js";
export { scanFiles, scanFilesWithGraphs } from "./scan/scan-files.js";
export type { ScanInput, ScanGraph, ScanFilesOutput } from "./scan/scan-files.js";
export {
  discoverFiles,
  commonRoot,
  assertReadableTarget,
  ScanInputError,
} from "./scan/files.js";
export { reportToText } from "./scan/reporters/text.js";
export { reportToSarif } from "./scan/reporters/sarif.js";
export {
  API_HOST,
  DEFAULT_API_PORT,
  MAX_BODY_BYTES,
  createApiHandler,
  isLoopbackUri,
  resolveLocalNeo4j,
  startApiServer,
} from "./server/server.js";
export { analyzeCode } from "./server/analyze-code.js";
export { analyzeSource } from "./engine/payload.js";
export type { AnalysisPayload } from "./engine/payload.js";
export { resolveInsideRoot, PathRejectedError } from "./server/paths.js";
export { VERSION } from "./version.js";
export {
  ALWAYS_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_BYTES,
} from "./scan/types.js";
export type {
  ScanResult,
  ScanFileResult,
  ScanFinding,
  ScanStep,
  ScanOptions,
  ScanTotals,
} from "./scan/types.js";

export { runBenchmark, formatReportTable } from "./eval/run-benchmark.js";
export { BENCHMARK_CORPUS, corpusStats } from "./eval/benchmark/corpus.js";
export type {
  BenchmarkCase,
  BenchmarkReport,
  BenchmarkMetrics,
  BenchmarkCaseResult,
} from "./eval/types.js";

/** Punto de entrada del core: texto fuente -> IRModule. */
export function analyze(code: string, file = "input.ts"): IRModule {
  return buildIR(loadSource(code, file), file);
}

/** Texto fuente → findings de taint sobre el grafo completo. */
export function analyzeTaintFromCode(code: string, file = "input.ts") {
  return analyzeTaint(analyzeGraph(code, file));
}
