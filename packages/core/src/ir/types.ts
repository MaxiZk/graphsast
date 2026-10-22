import type { Language } from "../lang/language.js";

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
  /** Nombres de sus decoradores (`@Body() dto` → `["Body"]`), si tiene. */
  decorators?: string[];
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
  /**
   * El callee escrito con el nombre del paquete del que se importó:
   * `cp.exec` con `const cp = require("child_process")` → `child_process.exec`.
   * Permite reconocer un sink aunque el import tenga otro nombre local.
   */
  qualifiedCallee?: string;
  /** `new X(...)`: el callee es la clase, y se resuelve a su constructor. */
  isNew?: true;
  /**
   * Inicializador de la variable receptora, si se declara en la misma
   * función: `new Finance(req.body)` en `finance.save()`. Distingue el
   * documento armado con el body entero del que recibe campos sueltos.
   */
  receiverInit?: string;
  /**
   * Inicializador del primer argumento cuando es una variable de la misma
   * función: `{}` en `const result = {}; res.send(result)`.
   */
  firstArgInit?: string;
  /**
   * La llamada valida el dato antes de usarlo (`/^[a-z]+$/.test(x)` en un
   * `if` que corta si falla). Los usos protegidos por la validación pasan por
   * este nodo, que vale como sanitizer para todas las familias.
   */
  validates?: true;
  /**
   * Si la validación protege solo a una familia (CWE): `ruta.startsWith(BASE)`
   * acota una ruta de archivo, pero no impide inyectar HTML.
   */
  validatesCwe?: number;
  /**
   * Entrada del navegador: `location.hash`, `document.cookie`,
   * `input.value`, `$("#q").val()`. Es origen igual que un parámetro.
   */
  input?: true;
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
  /**
   * En un `FLOWS_TO` hacia un nodo Call: por qué argumento entra el dato
   * (desde 0), o -1 si entra por el receptor (`x` en `x.save()`).
   */
  arg?: number;
}

export interface IRGraph {
  file: string;
  nodes: IRNode[];
  edges: IREdge[];
  /**
   * Lenguaje del código (sin valor, JavaScript/TypeScript): decide qué parte
   * del catálogo se aplica (ver `CweCatalogEntry.languages`).
   */
  language?: Language;
}
