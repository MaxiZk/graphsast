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
  /** Fin del nodo (exclusivo, 1-based), para resaltar el rango en SARIF. */
  endLine?: number;
  endCol?: number;
}

/**
 * Referencia de flujo serializable: resultado de `flowSourcesOf` con las
 * llamadas ya resueltas a ids de nodos Call del IR.
 */
export interface FlowRef {
  /** Identificadores raíz que alimentan la expresión (`req.body` → `req`). */
  names: string[];
  /** Ids de nodos Call cuyo valor de retorno alimenta la expresión. */
  callIds: string[];
}

export const EMPTY_FLOW: FlowRef = { names: [], callIds: [] };

export interface IRNodeBase {
  id: string;        // identificador estable: `${file}#${kind}@${line}:${col}`
  kind: IRNodeKind;
  name: string;      // nombre legible (nombre de var/función/callee; "" si no aplica)
  code: string;      // texto fuente del nodo
  loc: Loc;
  /**
   * Cadena de ámbitos léxicos que contienen al nodo, del más externo al más
   * interno. Una def solo alcanza a un uso si su `scopePath` es prefijo del
   * `scopePath` del uso; así dos `const x` en bloques hermanos (dos `case`,
   * dos ramas de un `if`) dejan de ser la misma variable.
   */
  scopePath: string[];
}

export interface IRFunction extends IRNodeBase {
  kind: "Function";
  paramIds: string[];
  returnTexts: string[]; // textos de las expresiones retornadas (display)
  returnFlows: FlowRef[]; // raíces de flujo de cada return
  /** Ámbito de cada return (mismo índice), para resolver sus nombres. */
  returnScopePaths?: string[][];
  /**
   * Contenedor del que la función es miembro: el nombre de la clase
   * (`class UserService { find() {} }`), de la variable que guarda el objeto
   * literal (`const svc = { find() {} }`) o del objeto al que se asigna
   * (`module.exports.find = ...`). Ausente en funciones sueltas.
   */
  memberOf?: string;
}

export interface IRParameter extends IRNodeBase {
  kind: "Parameter";
  index: number;
  ownerFnId: string;
}

export interface IRVariable extends IRNodeBase {
  kind: "Variable";
  initText: string | null;
  initFlow: FlowRef;
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
  argTexts: string[];      // display
  argFlows: FlowRef[];     // raíces de flujo por argumento (mismo índice)
  receiverFlow: FlowRef;   // raíces del receptor (`finance.save()` → `finance`)
  ownerFnId: string | null;
  /**
   * Clase u objeto literal que encierra a la llamada: a qué apunta `this` en
   * `this.find()`. Mismo formato que `IRFunction.memberOf`.
   */
  thisOwner?: string;
  /**
   * Cómo se resolvió la llamada contra el código analizado, si se resolvió:
   * `exact` (nombre o contenedor conocidos) o `guess` (método de nombre único).
   * Lo completa quien arma el grafo, no el builder.
   */
  resolution?: "exact" | "guess";
}

export type IRNode =
  | IRFunction
  | IRParameter
  | IRVariable
  | IRLiteral
  | IRCall;

/**
 * Asignación a una variable ya declarada (`q = req.body`). No genera nodo
 * propio: alimenta la def existente de `target`.
 */
export interface IRAssignment {
  target: string;
  flow: FlowRef;
  ownerFnId: string | null;
  scopePath: string[];
}

export interface IRModule {
  file: string;
  nodes: IRNode[];
  assignments: IRAssignment[];
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
