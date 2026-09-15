export type IRNodeKind =
  | "Function"
  | "Parameter"
  | "Variable"
  | "Literal"
  | "Call";

export interface Loc {
  file: string;
  line: number;
  col: number;
}

export interface IRNodeBase {
  id: string;        // identificador estable: `${file}#${kind}@${line}:${col}`
  kind: IRNodeKind;
  name: string;      // nombre legible (nombre de var/función/callee; "" si no aplica)
  code: string;      // texto fuente del nodo
  loc: Loc;
}

export interface IRFunction extends IRNodeBase {
  kind: "Function";
  paramIds: string[];
  returnTexts: string[]; // textos de las expresiones retornadas (para RETURNS)
}

export interface IRParameter extends IRNodeBase {
  kind: "Parameter";
  index: number;
  ownerFnId: string;
}

export interface IRVariable extends IRNodeBase {
  kind: "Variable";
  initText: string | null;
  ownerFnId: string | null;
}

export interface IRLiteral extends IRNodeBase {
  kind: "Literal";
  value: string;
  ownerFnId: string | null;
}

export interface IRCall extends IRNodeBase {
  kind: "Call";
  callee: string;
  argTexts: string[];
  ownerFnId: string | null;
}

export type IRNode =
  | IRFunction
  | IRParameter
  | IRVariable
  | IRLiteral
  | IRCall;

export interface IRModule {
  file: string;
  nodes: IRNode[];
}

export type IREdgeKind =
  | "CALLS"
  | "FLOWS_TO"
  | "BINDS_TO"
  | "RETURNS"
  | "SANITIZED_BY";

export interface IREdge {
  kind: IREdgeKind;
  from: string; // id de nodo origen
  to: string;   // id de nodo destino
}

export interface IRGraph {
  file: string;
  nodes: IRNode[];
  edges: IREdge[];
}
