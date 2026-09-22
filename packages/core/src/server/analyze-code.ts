import type { Driver } from "neo4j-driver";
import { graphFromSourceFile } from "../index.js";
import { parseSource } from "../parser/parser.js";
import { analyzeWithEngine } from "../engine/analyze.js";
import { buildVerdict } from "../engine/verdict.js";
import { buildAnalysisReport } from "../report/json.js";
import { getTaintRoles } from "../taint/analyzer.js";
import { getCatalogBundle, getRuleLabels } from "../taint/rules.js";

function countEdges(edges: { kind: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of edges) {
    out[e.kind] = (out[e.kind] ?? 0) + 1;
  }
  return out;
}

/**
 * Analiza código fuente recibido como texto y arma la respuesta que consume
 * la interfaz de visualización (grafo, hallazgos, roles, veredicto, informe).
 */
export async function analyzeCode(
  code: string,
  file: string,
  options: { driver?: Driver } = {},
) {
  const started = performance.now();
  const parsed = parseSource(code, file);

  // Si el parser no entendió el texto no hay grafo que mostrar, y un
  // panel vacío se leería como «sin vulnerabilidades». Se responde el
  // veredicto explícito en su lugar.
  if (parsed.syntaxErrors > 0) {
    const verdict = buildVerdict({
      graph: { file, nodes: [], edges: [] },
      roles: { sourceIds: [], sinkIds: [], sanitizerIds: [] },
      findings: [],
      parse: parsed,
    });
    return {
      graph: { file, nodes: [], edges: [] },
      findings: [],
      roles: { sourceIds: [], sinkIds: [], sanitizerIds: [] },
      engine: "memory",
      verdict,
      report: null,
      stats: {
        elapsedMs: Math.round(performance.now() - started),
        lineCount: code.split("\n").length,
        nodeCount: 0,
        edgeCount: 0,
        edgeKinds: {},
        findingCount: 0,
      },
      rules: getRuleLabels(),
      catalog: [],
    };
  }

  const graph = graphFromSourceFile(parsed.sourceFile, file);
  const { engine, findings } = await analyzeWithEngine(graph, { driver: options.driver });
  const roles = getTaintRoles(graph);
  const elapsedMs = Math.round(performance.now() - started);
  const lineCount = code.split("\n").length;
  const rules = getRuleLabels();
  const catalog = getCatalogBundle();

  const report = buildAnalysisReport({
    code,
    file,
    engine,
    findings,
    graph,
    elapsedMs,
    rules,
    catalog,
  });

  const verdict = buildVerdict({ graph, roles, findings, parse: parsed });

  return {
    graph,
    findings,
    roles,
    engine,
    verdict,
    report,
    stats: {
      elapsedMs,
      lineCount,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      edgeKinds: countEdges(graph.edges),
      findingCount: findings.length,
    },
    rules,
    catalog: catalog.entries.map((e) => ({
      cwe: e.cwe,
      name: e.name,
      description: e.description ?? "",
      sinks: e.sinks.length,
      sanitizers: e.sanitizers.length,
    })),
  };
}
