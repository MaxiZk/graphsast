import type { SourceFile } from "ts-morph";
import { loadSource } from "../parser/parser.js";
import { buildCallGraph } from "../cfg/callgraph.js";
import { buildDataFlow } from "../dfg/dataflow.js";
import { buildInterproc } from "../dfg/interproc.js";
import { markSanitizedEdges } from "../taint/sanitized.js";
import { buildIR } from "./builder.js";
import type { IRGraph } from "./types.js";

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
