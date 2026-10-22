import type { SourceFile } from "ts-morph";
import { loadSource } from "../parser/parser.js";
import { resolveCalls } from "../cfg/callgraph.js";
import { buildDataFlow } from "../dfg/dataflow.js";
import { buildInterproc } from "../dfg/interproc.js";
import { markSanitizedEdges } from "../taint/sanitized.js";
import { buildIR } from "./builder.js";
import { foreignGraph } from "../lang/graph.js";
import { isForeignLanguage, languageOf } from "../lang/language.js";
import type { IRGraph } from "./types.js";

/**
 * Texto fuente -> IRGraph: nodos + aristas CALLS (call graph), FLOWS_TO
 * (def-use intra-procedural), BINDS_TO/RETURNS (argumento → parámetro y
 * valor retornado → llamada) y
 * SANITIZED_BY (salida de una llamada de saneamiento). Python, Java, PHP y Go
 * pasan por tree-sitter (ver `lang/`); sus gramáticas tienen que estar
 * cargadas (`loadNodeLanguages` o `loadLanguages`).
 */
export function analyzeGraph(code: string, file = "input.ts"): IRGraph {
  const language = languageOf(file);
  if (isForeignLanguage(language)) {
    const result = foreignGraph(code, file, language);
    if ("error" in result) throw new Error(result.error);
    return result.graph;
  }
  return graphFromSourceFile(loadSource(code, file), file);
}

/** Igual que `analyzeGraph` pero sobre un SourceFile ya parseado. */
export function graphFromSourceFile(
  sourceFile: SourceFile,
  file = "input.ts",
): IRGraph {
  const mod = buildIR(sourceFile, file);
  const calls = resolveCalls(mod);
  const edges = markSanitizedEdges(mod.nodes, [
    ...calls.edges,
    ...buildDataFlow(mod, calls.exactCallIds),
    ...buildInterproc(mod, calls.edges),
  ]);
  return { file: mod.file, nodes: mod.nodes, edges };
}
