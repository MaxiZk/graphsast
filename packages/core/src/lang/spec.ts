import type { Node as TsNode } from "web-tree-sitter";
import type { ForeignLanguage } from "./language.js";

/**
 * Lo que cada lenguaje le dice al builder genérico (`builder.ts`) sobre su
 * árbol de tree-sitter. El builder recorre el árbol una vez y arma la misma
 * representación intermedia que el de JavaScript; de ahí en adelante (grafo,
 * recorrido, catálogo, web) no hay nada específico del lenguaje.
 */

export interface ParamInfo {
  name: string;
  /** Nodo del nombre: da la ubicación del parámetro. */
  at: TsNode;
  /** Anotaciones o decoradores (`@RequestParam` → `RequestParam`). */
  decorators?: string[];
}

export interface FunctionInfo {
  name: string;
  /** Clase u objeto del que es miembro. */
  memberOf?: string;
  /** Parámetros posicionales, alineados con los argumentos de una llamada. */
  params: ParamInfo[];
  /**
   * La función atiende una ruta web y lo que retorna es la respuesta HTML
   * (vista de Flask, método de un `@RestController`): sus `return` son
   * destinos `@route.return`.
   */
  routeHandler?: boolean;
}

export interface CallInfo {
  /** Callee normalizado: `cursor.execute`, `this.repo.find`, `pdo.query`. */
  callee: string;
  args: TsNode[];
  /** Objeto sobre el que se invoca (`cursor` en `cursor.execute(q)`). */
  receiver?: TsNode;
  isNew?: boolean;
  /** Nodo cuya posición identifica la llamada: el paréntesis de los argumentos. */
  idAt: TsNode;
}

export interface BindingInfo {
  /** Nombre definido (`x`, o `this.campo` para un campo de la instancia). */
  name: string;
  /** Nodo del nombre: da la ubicación de la definición. */
  at: TsNode;
  /** Expresión que le da valor; sin ella, la variable se declara vacía. */
  value?: TsNode | null;
}

export interface SyntheticCall {
  callee: string;
  args: TsNode[];
}

export interface LanguageSpec {
  language: ForeignLanguage;
  /** Prepara lo que dependa del archivo entero (imports, marco web). */
  prepare?(root: TsNode): void;
  /** Funciones, métodos y lambdas. */
  functionOf(node: TsNode): FunctionInfo | null;
  /** Nombre de la clase si el nodo es una (para `memberOf` y `this`). */
  classNameOf(node: TsNode): string | null;
  /** Definiciones que introduce el nodo: asignaciones, declaraciones, `for`. */
  bindingsOf(node: TsNode): BindingInfo[];
  callOf(node: TsNode): CallInfo | null;
  /** Nombre de la variable si el nodo es una referencia a una. */
  identifierOf(node: TsNode): string | null;
  /** Campo de la instancia (`self.repo`, `$this->db`) como `this.repo`. */
  thisFieldOf?(node: TsNode): string | null;
  /** Acceso a miembro o índice: el objeto al que se colapsa (insensible a campos). */
  memberObjectOf(node: TsNode): TsNode | null;
  /** Lectura de una entrada conocida (`request.args`, `$_GET`): es origen. */
  inputOf?(node: TsNode): string | null;
  /** Construcciones que se modelan como llamadas: `echo`, `include`, `(int)`. */
  syntheticOf?(node: TsNode): SyntheticCall | null;
  /** Expresión retornada si el nodo es un `return`. */
  returnValueOf(node: TsNode): TsNode | null | undefined;
  /** Campos de un nodo que no son expresiones (nombre de un argumento con nombre). */
  nonExpressionFields?: ReadonlySet<string>;
  /** Tipos de nodo que no llevan datos (literales sin interpolación, tipos). */
  opaqueTypes?: ReadonlySet<string>;
  /** El lenguaje escribe `new X(...)` (Java, PHP): se muestra así en el grafo. */
  newKeyword?: boolean;
  /** Paquete de origen de un callee (`sp.run` con `import subprocess as sp`). */
  qualify?(callee: string): string | undefined;
}
