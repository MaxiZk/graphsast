import type { Driver } from "neo4j-driver";
import { graphFromSourceFile } from "../ir/graph.js";
import { parseSource } from "../parser/parser.js";
import { analyzeWithEngine } from "../engine/analyze.js";
import {
  analysisPayload,
  notAnalyzablePayload,
  type AnalysisPayload,
} from "../engine/payload.js";

/**
 * Analiza código fuente recibido como texto y arma la respuesta que consume
 * la interfaz de visualización (grafo, hallazgos, roles, veredicto, informe).
 * Con `driver` los caminos se resuelven con Cypher sobre Neo4j.
 */
export async function analyzeCode(
  code: string,
  file: string,
  options: { driver?: Driver } = {},
): Promise<AnalysisPayload> {
  const started = performance.now();
  const parsed = parseSource(code, file);
  if (parsed.syntaxErrors > 0) return notAnalyzablePayload(code, file, parsed, started);

  const graph = graphFromSourceFile(parsed.sourceFile, file);
  const { engine, findings } = await analyzeWithEngine(graph, { driver: options.driver });
  return analysisPayload({ code, file, parsed, graph, engine, findings, started });
}
