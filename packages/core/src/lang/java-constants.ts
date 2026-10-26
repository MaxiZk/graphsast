import type { Node as TsNode } from "web-tree-sitter";

/**
 * Ramas de Java que no se ejecutan nunca, por evaluar constantes:
 *
 *     int num = 86;
 *     if ((7 * 42) - num > 200) bar = "fijo"; else bar = param;  // el else no corre
 *
 *     char c = "ABC".charAt(2);
 *     switch (c) { case 'A': bar = param; break; case 'C': bar = "fijo"; break; }
 *
 * Solo cuentan los literales y las variables locales que se asignan una única
 * vez con un valor constante; cualquier otra cosa deja las dos ramas vivas.
 */

type Const = number | string | boolean;

const FUNCTION_TYPES = new Set(["method_declaration", "constructor_declaration", "lambda_expression"]);
const EXITS = new Set(["break_statement", "return_statement", "throw_statement", "continue_statement", "yield_statement"]);
const MAX_DEPTH = 32;

function enclosingFunction(node: TsNode): TsNode | null {
  for (let p = node.parent; p; p = p.parent) {
    if (FUNCTION_TYPES.has(p.type)) return p;
  }
  return null;
}

const keyOf = (fn: TsNode | null, name: string) => `${fn?.startIndex ?? -1}\t${name}`;

export class JavaConstants {
  /** Valor de cada variable local con una sola asignación; `null` si tiene más. */
  private readonly values = new Map<string, TsNode | null>();

  constructor(root: TsNode) {
    const stack: TsNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === "local_variable_declaration") {
        for (const d of node.childrenForFieldName("declarator")) {
          const name = d?.childForFieldName("name");
          if (d && name) this.define(keyOf(enclosingFunction(node), name.text), d.childForFieldName("value"));
        }
      } else if (node.type === "assignment_expression" || node.type === "update_expression") {
        const target = node.type === "assignment_expression" ? node.childForFieldName("left") : node.namedChildren[0];
        if (target?.type === "identifier") this.values.set(keyOf(enclosingFunction(node), target.text), null);
      }
      for (const child of node.namedChildren) if (child) stack.push(child);
    }
  }

  private define(key: string, value: TsNode | null): void {
    this.values.set(key, this.values.has(key) || !value ? null : value);
  }

  valueOf(node: TsNode | null, depth = 0): Const | undefined {
    if (!node || depth > MAX_DEPTH) return undefined;
    const next = depth + 1;
    switch (node.type) {
      case "decimal_integer_literal": {
        const n = Number(node.text.replace(/_/g, "").replace(/[lL]$/, ""));
        return Number.isSafeInteger(n) ? n : undefined;
      }
      case "true":
        return true;
      case "false":
        return false;
      case "string_literal":
        return node.namedChildren.every((c) => c?.type === "string_fragment")
          ? node.namedChildren.map((c) => c!.text).join("")
          : undefined;
      case "character_literal":
        return node.text.length === 3 ? node.text[1] : undefined;
      case "parenthesized_expression":
        return this.valueOf(node.namedChildren[0] ?? null, next);
      case "identifier": {
        const value = this.values.get(keyOf(enclosingFunction(node), node.text));
        return value ? this.valueOf(value, next) : undefined;
      }
      case "unary_expression": {
        const operand = this.valueOf(node.childForFieldName("operand"), next);
        const op = node.childForFieldName("operator")?.type;
        if (op === "!" && typeof operand === "boolean") return !operand;
        if (op === "-" && typeof operand === "number") return -operand;
        return undefined;
      }
      case "binary_expression":
        return binary(
          node.childForFieldName("operator")?.type,
          this.valueOf(node.childForFieldName("left"), next),
          this.valueOf(node.childForFieldName("right"), next),
        );
      case "ternary_expression": {
        const condition = this.valueOf(node.childForFieldName("condition"), next);
        if (typeof condition !== "boolean") return undefined;
        return this.valueOf(node.childForFieldName(condition ? "consequence" : "alternative"), next);
      }
      case "method_invocation": {
        // "ABC".charAt(2)
        if (node.childForFieldName("name")?.text !== "charAt") return undefined;
        const text = this.valueOf(node.childForFieldName("object"), next);
        const args = node.childForFieldName("arguments")?.namedChildren ?? [];
        const index = args.length === 1 ? this.valueOf(args[0] ?? null, next) : undefined;
        if (typeof text !== "string" || typeof index !== "number") return undefined;
        return index >= 0 && index < text.length ? text[index] : undefined;
      }
      default:
        return undefined;
    }
  }

  /** Hijos de `node` que no se ejecutan nunca. */
  deadChildren(node: TsNode): TsNode[] {
    if (node.type === "if_statement" || node.type === "ternary_expression") {
      const condition = this.valueOf(node.childForFieldName("condition"));
      if (typeof condition !== "boolean") return [];
      const dead = node.childForFieldName(condition ? "alternative" : "consequence");
      return dead ? [dead] : [];
    }
    if (node.type === "switch_block") return this.deadCases(node);
    return [];
  }

  /**
   * `case` que el `switch` no alcanza: corre el grupo de la etiqueta que
   * coincide (o `default`) y los siguientes hasta un `break`.
   */
  private deadCases(block: TsNode): TsNode[] {
    const owner = block.parent;
    if (!owner || (owner.type !== "switch_expression" && owner.type !== "switch_statement")) return [];
    const value = this.valueOf(owner.childForFieldName("condition"));
    if (value === undefined) return [];
    const groups = block.namedChildren.filter(
      (c): c is TsNode => c?.type === "switch_block_statement_group" || c?.type === "switch_rule",
    );
    const labels = groups.map((g) => g.namedChildren.filter((c): c is TsNode => c?.type === "switch_label"));
    const values = labels.map((ls) => ls.flatMap((l) => l.namedChildren.map((c) => this.valueOf(c))));
    // Una etiqueta que no se puede evaluar podría ser la que coincide.
    if (values.some((vs) => vs.some((v) => v === undefined))) return [];
    let start = values.findIndex((vs) => vs.includes(value));
    if (start < 0) start = labels.findIndex((ls) => ls.some((l) => l.namedChildCount === 0));
    if (start < 0) return groups;
    let end = start;
    while (end < groups.length - 1 && groups[end]!.type !== "switch_rule" && !endsWithExit(groups[end]!)) end++;
    return groups.filter((_, i) => i < start || i > end);
  }
}

function endsWithExit(group: TsNode): boolean {
  const last = group.namedChildren.at(-1);
  if (!last) return false;
  if (EXITS.has(last.type)) return true;
  return last.type === "block" && EXITS.has(last.namedChildren.at(-1)?.type ?? "");
}

function binary(op: string | undefined, left: Const | undefined, right: Const | undefined): Const | undefined {
  if (op === undefined || left === undefined || right === undefined) return undefined;
  if (op === "==") return left === right;
  if (op === "!=") return left !== right;
  if (typeof left === "boolean" && typeof right === "boolean") {
    if (op === "&&") return left && right;
    if (op === "||") return left || right;
    return undefined;
  }
  if (op === "+" && (typeof left === "string" || typeof right === "string")) return `${left}${right}`;
  if (typeof left !== "number" || typeof right !== "number") return undefined;
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right === 0 ? undefined : Math.trunc(left / right);
    case "%":
      return right === 0 ? undefined : left % right;
    case ">":
      return left > right;
    case "<":
      return left < right;
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    default:
      return undefined;
  }
}
