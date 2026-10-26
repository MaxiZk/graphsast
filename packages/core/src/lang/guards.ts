import type { Node as TsNode } from "web-tree-sitter";
import { isAnchoredRegex } from "../ir/guards.js";
import type { CallInfo, LanguageSpec } from "./spec.js";

/**
 * Validaciones que protegen un dato antes de usarlo, para Python, Java, PHP y
 * Go. Mismo criterio que `ir/guards.ts` para JavaScript:
 *
 *     if not usuario.isalnum():          if (!is_numeric($id)) {
 *         abort(400)                         die("id inválido");
 *     db.execute("... " + usuario)       }
 *                                        mysqli_query($c, "... $id");
 *
 * Una condición que valida el dato protege la rama en la que se cumple, y si
 * la otra rama corta siempre (`return`, `throw`, `die`, `abort()`), también lo
 * que sigue al `if`. Lo que valida: los validadores de cada lenguaje
 * (`LanguageSpec.validatedBy`: regex anclada, `isdigit`, `is_numeric`,
 * `in_array`), la comparación con un literal (`x == "asc"`), la pertenencia a
 * una lista (`x in PERMITIDOS`) y las combinaciones con `&&`, `||` y `!`.
 */

export interface ForeignGuard {
  /** Zona protegida (índices del texto). */
  from: number;
  to: number;
  /** El nodo que valida: una llamada del código o una condición (`x in L`). */
  validator: TsNode;
}

export interface ForeignGuards {
  /** Por texto normalizado de la expresión validada. */
  byKey: Map<string, ForeignGuard[]>;
  /** Nodos que validan y no son llamadas: se modelan como llamadas sintéticas. */
  synthetic: Map<number, TsNode>;
  /** Llamadas del código que validan (ids de nodo). */
  calls: Set<number>;
}

/** Contexto que reciben los validadores de cada lenguaje. */
export interface GuardContext {
  /** Valor de una variable que se asigna una sola vez en el archivo. */
  constOf(name: string): TsNode | null;
  /** Texto de un literal de cadena sin interpolación; `null` si no lo es. */
  stringOf(node: TsNode | null | undefined): string | null;
}

export const normalizeKey = (text: string): string => text.replace(/\s+/g, "");

const STATEMENT_LISTS = new Set([
  "block", "program", "module", "source_file", "statement_list", "compound_statement",
  "constructor_body", "switch_block_statement_group",
]);
const EXIT_TYPES = new Set([
  "return_statement", "throw_statement", "raise_statement", "break_statement", "continue_statement", "exit_statement",
]);
/** Llamadas que no vuelven: `abort(400)` de Flask, `die()`, `panic()`, `os.Exit(1)`. */
const EXIT_CALLS = /^(?:abort|flask\.abort|sys\.exit|exit|die|panic|os\.Exit|log\.(?:Fatal|Fatalf|Fatalln|Panic|Panicf|Panicln)|System\.exit)$/;

const STRING_TYPES = new Set([
  "string", "string_literal", "encapsed_string", "interpreted_string_literal", "raw_string_literal",
]);
const STRING_PARTS = new Set([
  "string_content", "string_fragment", "escape_sequence", "string_start", "string_end",
  "interpreted_string_literal_content", "raw_string_literal_content",
]);
const SCALAR_TYPES = new Set([
  "integer", "int_literal", "decimal_integer_literal", "float", "float_literal", "character_literal",
]);
const CONTAINER_TYPES = new Set(["list", "tuple", "set", "array_creation_expression"]);

export function stringOf(node: TsNode | null | undefined): string | null {
  if (!node || !STRING_TYPES.has(node.type)) return null;
  const parts = node.namedChildren.filter((c): c is TsNode => c !== null);
  if (parts.some((c) => !STRING_PARTS.has(c.type))) return null;
  const content = parts.filter((c) => c.type !== "string_start" && c.type !== "string_end");
  if (content.length > 0) return content.map((c) => c.text).join("");
  // Sin hijos: el texto entre las comillas (`""`, `"abc"` en algunas gramáticas).
  return node.text.replace(/^[a-zA-Z]*(["'`])/, "").replace(/["'`]$/, "");
}

function isLiteral(node: TsNode | null): boolean {
  if (!node) return false;
  return stringOf(node) !== null || SCALAR_TYPES.has(node.type);
}

function booleanOf(node: TsNode | null): boolean | null {
  if (!node) return null;
  const text = node.text.toLowerCase();
  if ((node.type === "true" || node.type === "false" || node.type === "boolean") && (text === "true" || text === "false")) {
    return text === "true";
  }
  return null;
}

/**
 * ¿El patrón (sin delimitadores) acepta solo cadenas enteras de su forma?
 * `\A` y `\Z`/`\z` cuentan como `^` y `$`.
 */
export function isAnchoredPattern(pattern: string): boolean {
  const normalized = pattern.replace(/^\\A/, "^").replace(/\\[zZ]$/, "$");
  return isAnchoredRegex(`/${normalized}/`);
}

/** Patrón de PHP con delimitadores (`/^\d+$/`, `#^[a-z]+$#i`). */
export function isAnchoredDelimited(literal: string): boolean {
  const delimiter = literal[0];
  if (!delimiter || /[\w\s\\]/.test(delimiter)) return false;
  const closing = { "(": ")", "[": "]", "{": "}", "<": ">" }[delimiter] ?? delimiter;
  const end = literal.lastIndexOf(closing);
  if (end <= 0) return false;
  return isAnchoredRegex(`/${literal.slice(1, end)}/${literal.slice(end + 1)}`);
}

/** El `if` de las cuatro gramáticas: condición, rama si se cumple, rama si no. */
function ifShape(node: TsNode): { condition: TsNode; then: TsNode; otherwise: TsNode | null } | null {
  if (node.type !== "if_statement") return null;
  const condition = node.childForFieldName("condition");
  const then = node.childForFieldName("consequence") ?? node.childForFieldName("body");
  if (!condition || !then) return null;
  return { condition, then, otherwise: node.childrenForFieldName("alternative")[0] ?? null };
}

function operatorOf(node: TsNode): string | undefined {
  return node.childForFieldName("operator")?.type ?? node.childForFieldName("operators")?.type;
}

function unwrap(node: TsNode): TsNode {
  let current = node;
  while (current.type === "parenthesized_expression" && current.namedChildCount === 1) current = current.namedChild(0)!;
  return current;
}

interface Validated {
  key: string;
  validator: TsNode;
}

export function collectForeignGuards(
  root: TsNode,
  spec: LanguageSpec,
  callOf: (node: TsNode) => CallInfo | null,
): ForeignGuards {
  // Una pasada para los valores de las variables y los `if` del archivo.
  const values = new Map<string, (TsNode | null)[]>();
  const ifs: TsNode[] = [];
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (ifShape(node)) ifs.push(node);
    for (const b of spec.bindingsOf(node)) {
      const list = values.get(b.name);
      if (list) list.push(b.value ?? null);
      else values.set(b.name, [b.value ?? null]);
    }
    for (const child of node.namedChildren) if (child) stack.push(child);
  }
  const ctx: GuardContext = {
    // Una constante de la clase (`private static final Pattern P = ...`) se
    // guarda como campo `this.P`.
    constOf: (name) => {
      const list = values.get(name) ?? values.get(`this.${name}`);
      return list?.length === 1 ? list[0] ?? null : null;
    },
    stringOf,
  };

  const out: ForeignGuards = { byKey: new Map(), synthetic: new Map(), calls: new Set() };
  const keyOf = (node: TsNode) => normalizeKey(node.text);

  /** Una condición simple: el dato que valida y si se cumple cuando es inválido. */
  const atomOf = (node: TsNode): { validated: TsNode; negated: boolean } | null => {
    const call = callOf(node);
    if (call) {
      const validated = spec.validatedBy?.(node, call, ctx);
      return validated ? { validated, negated: false } : null;
    }
    const op = operatorOf(node);
    if (op === undefined) return null;
    const isComparison = node.type === "binary_expression" || node.type === "comparison_operator";
    if (!isComparison) return null;
    const named = node.namedChildren.filter((c): c is TsNode => c !== null);
    const left = node.childForFieldName("left") ?? named[0] ?? null;
    const right = node.childForFieldName("right") ?? named[1] ?? null;
    if (!left || !right || (node.type === "comparison_operator" && named.length !== 2)) return null;
    // `x == "asc"`, `$x !== 'desc'`
    if (["==", "===", "!=", "!=="].includes(op)) {
      const negated = op.startsWith("!");
      if (isLiteral(right) && !isLiteral(left)) return { validated: left, negated };
      if (isLiteral(left) && !isLiteral(right)) return { validated: right, negated };
      return null;
    }
    // `x in PERMITIDOS`, `x not in ("asc", "desc")`
    if (op === "in" || op === "not in") {
      const list = unwrap(right);
      const literalList = CONTAINER_TYPES.has(list.type) && list.namedChildren.every((c) => isLiteral(c));
      const namedList = (list.type === "identifier" || list.type === "attribute") && keyOf(list) !== keyOf(left);
      return literalList || namedList ? { validated: left, negated: op === "not in" } : null;
    }
    return null;
  };

  /** Lo que queda validado cuando `node` vale `truth`. */
  const holdsWhen = (raw: TsNode, truth: boolean): Validated[] => {
    const node = unwrap(raw);
    const op = operatorOf(node);
    if (node.type === "not_operator" || (op === "!" && /unary/.test(node.type))) {
      const operand = node.childForFieldName("argument") ?? node.childForFieldName("operand");
      return operand ? holdsWhen(operand, !truth) : [];
    }
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    if (left && right && (op === "&&" || op === "and" || op === "||" || op === "or")) {
      const and = op === "&&" || op === "and";
      // `a && b` verdadero: valen los dos. `a || b` falso: no vale ninguno.
      if (and === truth) return [...holdsWhen(left, truth), ...holdsWhen(right, truth)];
      // `a || b` verdadero: vale uno de los dos; si los dos validan el mismo
      // dato, el dato está validado, y la condición entera es la que valida.
      const a = holdsWhen(left, truth);
      const b = holdsWhen(right, truth);
      return a.filter((x) => b.some((y) => y.key === x.key)).map((x) => ({ key: x.key, validator: node }));
    }
    // `filter_var($x, FILTER_VALIDATE_INT) === false`
    if (left && right && ["==", "===", "!=", "!=="].includes(op ?? "")) {
      const bool = booleanOf(right) ?? booleanOf(left);
      const other = booleanOf(right) !== null ? left : right;
      if (bool !== null && booleanOf(other) === null) {
        const equal = !(op ?? "").startsWith("!");
        return holdsWhen(other, equal === bool ? truth : !truth);
      }
    }
    const atom = atomOf(node);
    if (!atom || atom.negated === truth) return [];
    return [{ key: keyOf(atom.validated), validator: node }];
  };

  const exits = (stmt: TsNode | null): boolean => {
    if (!stmt) return false;
    if (EXIT_TYPES.has(stmt.type)) return true;
    if (STATEMENT_LISTS.has(stmt.type) || stmt.type === "else_clause") {
      const last = stmt.namedChildren.filter((c): c is TsNode => c !== null && !/comment/.test(c.type)).at(-1);
      return exits(last ?? null);
    }
    const inner = stmt.type === "expression_statement" && stmt.namedChildCount === 1 ? stmt.namedChild(0)! : stmt;
    const call = callOf(inner);
    return call !== null && EXIT_CALLS.test(call.callee.replace(/^this\./, ""));
  };

  /**
   * ¿La rama le asigna a `key` un literal? `if col not in PERMITIDAS: col =
   * "nombre"` deja a `col` válido después del `if` por cualquiera de las dos.
   */
  const resets = (branch: TsNode, key: string): boolean => {
    const statements = STATEMENT_LISTS.has(branch.type)
      ? branch.namedChildren.filter((c): c is TsNode => c !== null)
      : [branch];
    return statements.some((stmt) => {
      const inner = stmt.type === "expression_statement" && stmt.namedChildCount === 1 ? stmt.namedChild(0)! : stmt;
      return spec.bindingsOf(inner).some((b) => normalizeKey(b.at.text) === key && b.value !== undefined && isLiteral(b.value ?? null));
    });
  };

  const add = (found: Validated[], from: number, to: number) => {
    for (const { key, validator } of found) {
      if (callOf(validator)) out.calls.add(validator.id);
      else out.synthetic.set(validator.id, validator);
      const list = out.byKey.get(key);
      const guard = { from, to, validator };
      if (list) list.push(guard);
      else out.byKey.set(key, [guard]);
    }
  };

  for (const node of ifs) {
    const shape = ifShape(node)!;
    const whenTrue = holdsWhen(shape.condition, true);
    const whenFalse = holdsWhen(shape.condition, false);
    add(whenTrue, shape.then.startIndex, shape.then.endIndex);
    if (shape.otherwise) add(whenFalse, shape.then.endIndex, node.endIndex);
    // Si una rama corta siempre, lo que sigue al `if` corre solo por la otra.
    const container = node.parent;
    if (!container || !STATEMENT_LISTS.has(container.type)) continue;
    if (exits(shape.then)) add(whenFalse, node.endIndex, container.endIndex);
    else if (shape.otherwise && exits(shape.otherwise)) add(whenTrue, node.endIndex, container.endIndex);
    else if (!shape.otherwise) {
      const block = shape.then.type === "block" && shape.then.namedChildCount === 1 && shape.then.namedChild(0)!.type === "statement_list"
        ? shape.then.namedChild(0)!
        : shape.then;
      add(whenFalse.filter((v) => resets(block, v.key)), node.endIndex, container.endIndex);
    }
  }
  return out;
}

/** La validación que protege este uso, si hay una. */
export function guardAt(node: TsNode, guards: ForeignGuards): ForeignGuard | undefined {
  const list = guards.byKey.get(normalizeKey(node.text));
  return list?.find((g) => node.startIndex >= g.from && node.endIndex <= g.to);
}
