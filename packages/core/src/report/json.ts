import type { CatalogBundle } from "../catalog/types.js";
import type { TaintFinding } from "../taint/types.js";
import type { TaintEngine } from "../engine/analyze.js";

export interface AnalysisReport {
  analyzedAt: string;
  engine: TaintEngine;
  code: string;
  file: string;
  findings: TaintFinding[];
  stats: {
    elapsedMs: number;
    lineCount: number;
    nodeCount: number;
    edgeCount: number;
    findingCount: number;
  };
  catalog?: {
    cwe: number;
    name: string;
  }[];
  rules?: Record<string, string>;
}

export function buildAnalysisReport(input: {
  code: string;
  file: string;
  engine: TaintEngine;
  findings: TaintFinding[];
  graph: { nodes: unknown[]; edges: unknown[] };
  elapsedMs: number;
  rules?: Record<string, string>;
  catalog?: CatalogBundle;
}): AnalysisReport {
  const catalog = input.catalog?.entries.map((e) => ({
    cwe: e.cwe,
    name: e.name,
  }));
  return {
    analyzedAt: new Date().toISOString(),
    engine: input.engine,
    code: input.code,
    file: input.file,
    findings: input.findings,
    stats: {
      elapsedMs: input.elapsedMs,
      lineCount: input.code.split("\n").length,
      nodeCount: input.graph.nodes.length,
      edgeCount: input.graph.edges.length,
      findingCount: input.findings.length,
    },
    catalog,
    rules: input.rules,
  };
}

export function reportToJson(report: AnalysisReport, pretty = true): string {
  return JSON.stringify(report, null, pretty ? 2 : 0);
}
