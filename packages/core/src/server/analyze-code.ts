import type { Driver } from "neo4j-driver";
import { analyzeWithEngine } from "../engine/analyze.js";
import {
  analysisPayload,
  notAnalyzablePayload,
  prepareAnalysis,
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
  const { parse, graph } = prepareAnalysis(code, file);
  if (!graph) return notAnalyzablePayload(code, file, parse, started);

  const { engine, findings } = await analyzeWithEngine(graph, { driver: options.driver });
  return analysisPayload({ code, file, parsed: parse, graph, engine, findings, started });
}
