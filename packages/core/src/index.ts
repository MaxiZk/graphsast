import type { SourceFile } from "ts-morph";
import { loadSource } from "./parser/parser.js";
import { buildIR } from "./ir/builder.js";
import { buildCallGraph } from "./cfg/callgraph.js";
import { buildDataFlow } from "./dfg/dataflow.js";
import { buildInterproc } from "./dfg/interproc.js";
import { analyzeTaint } from "./taint/analyzer.js";
import { markSanitizedEdges } from "./taint/sanitized.js";
import type { IRModule, IRGraph } from "./ir/types.js";

export * from "./ir/types.js";
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
export { discoverFiles, commonRoot } from "./scan/files.js";
export { reportToText } from "./scan/reporters/text.js";
export { reportToSarif } from "./scan/reporters/sarif.js";
export {
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

/**
 * Texto fuente -> IRGraph: nodos + aristas CALLS (call graph), FLOWS_TO
 * (def-use intra-procedural), BINDS_TO/RETURNS (cruce inter-procedural) y
 * SANITIZED_BY (salida de una llamada de saneamiento).
 */
export function analyzeGraph(code: string, file = "input.ts"): IRGraph {
  return graphFromSourceFile(loadSource(code, file), file);
}

/** Igual que `analyzeGraph` pero sobre un SourceFile ya parseado. */
export function graphFromSourceFile(
  sourceFile: SourceFile,
  file = "input.ts",
): IRGraph {
  const mod = buildIR(sourceFile, file);
  const edges = markSanitizedEdges(mod.nodes, [
    ...buildCallGraph(mod),
    ...buildDataFlow(mod),
    ...buildInterproc(mod),
  ]);
  return { file: mod.file, nodes: mod.nodes, edges };
}

/** Texto fuente → findings de taint sobre el grafo completo. */
export function analyzeTaintFromCode(code: string, file = "input.ts") {
  return analyzeTaint(analyzeGraph(code, file));
}
