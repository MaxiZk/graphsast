import type { IREdgeKind, IRNode } from "../ir/types.js";

export interface TaintRule {
  id: string;
  kind: "source" | "sink" | "sanitizer";
  cwe?: number;
  cweName?: string;
  match: (node: IRNode) => boolean;
  /**
   * Solo sinks: argumentos por los que el dato peligroso puede entrar. Sin
   * esto cuentan todos y el receptor (ver `SinkSpec.args`).
   */
  args?: readonly number[];
}

export interface TaintFinding {
  sourceId: string;
  sinkId: string;
  path: string[];
  sanitized: boolean;
  cwe?: number;
  cweName?: string;
  ruleId?: string;
}

export interface TaintConfig {
  rules?: TaintRule[];
  maxDepth?: number;
  propagateEdges?: readonly IREdgeKind[];
}

export interface TaintRoles {
  sourceIds: string[];
  sinkIds: string[];
  sanitizerIds: string[];
}
