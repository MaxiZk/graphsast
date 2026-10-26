import type { Node as TsNode } from "web-tree-sitter";
import { isAnchoredDelimited, isAnchoredPattern, normalizeKey, type GuardContext } from "./guards.js";
import type { CallInfo } from "./spec.js";

/**
 * Llamadas que validan un dato en cada lenguaje (ver `guards.ts`). Solo las
 * que dejan pasar valores sin los caracteres que hacen falta para inyectar:
 * una regex que acepta la cadena entera, los chequeos de tipo numérico o
 * alfanumérico y la pertenencia a una lista o un mapa del código.
 */

const methodOf = (callee: string) => callee.slice(callee.lastIndexOf(".") + 1);
const ownerOf = (callee: string) => callee.slice(0, Math.max(callee.lastIndexOf("."), 0));

/** Texto de un literal, directo o a través de una constante del archivo. */
function literalOf(node: TsNode | undefined, ctx: GuardContext, identifier: string): string | null {
  if (!node) return null;
  const direct = ctx.stringOf(node);
  if (direct !== null) return direct;
  return node.type === identifier ? ctx.stringOf(ctx.constOf(node.text)) : null;
}

/** ¿La lista es del código y no el mismo dato? (`PERMITIDOS.contains(x)`). */
function isOtherThan(list: TsNode | undefined, value: TsNode | undefined): boolean {
  return list !== undefined && value !== undefined && normalizeKey(list.text) !== normalizeKey(value.text);
}

// --- Python ---------------------------------------------------------------

const PY_CHAR_CHECKS = new Set(["isdigit", "isnumeric", "isdecimal", "isalnum", "isalpha", "isidentifier"]);
const PY_NUMBER_TYPES = /^\(?\s*(?:int|float|bool)(?:\s*,\s*(?:int|float|bool))*\s*,?\s*\)?$/;

/** ¿El patrón, usado con `re.<método>`, acepta solo cadenas enteras? */
function pythonAnchored(method: string, pattern: string): boolean {
  if (method === "fullmatch") return true;
  if (method === "match") return isAnchoredPattern(/^(?:\^|\\A)/.test(pattern) ? pattern : `^${pattern}`);
  if (method === "search") return isAnchoredPattern(pattern);
  return false;
}

/** `re.compile(r"...")`, directo o guardado en una constante: su patrón. */
function pythonCompiled(node: TsNode | undefined, ctx: GuardContext): string | null {
  const value = node?.type === "identifier" ? ctx.constOf(node.text) : node ?? null;
  if (value?.type !== "call") return null;
  if (normalizeKey(value.childForFieldName("function")?.text ?? "") !== "re.compile") return null;
  const first = value.childForFieldName("arguments")?.namedChildren[0];
  return first ? literalOf(first, ctx, "identifier") : null;
}

export function pythonValidated(
  call: CallInfo,
  ctx: GuardContext,
  qualify: (callee: string) => string | undefined,
): TsNode | null {
  const method = methodOf(call.callee);
  const [a0, a1] = call.args;
  if (PY_CHAR_CHECKS.has(method) && call.receiver && call.args.length === 0) return call.receiver;
  const qualified = qualify(call.callee) ?? call.callee;
  if (/^re\.(?:fullmatch|match|search)$/.test(qualified)) {
    const pattern = literalOf(a0, ctx, "identifier");
    return pattern !== null && pythonAnchored(method, pattern) ? a1 ?? null : null;
  }
  if (["fullmatch", "match", "search"].includes(method) && call.receiver) {
    const pattern = pythonCompiled(call.receiver, ctx);
    return pattern !== null && pythonAnchored(method, pattern) ? a0 ?? null : null;
  }
  if (call.callee === "isinstance" && a0 && a1 && PY_NUMBER_TYPES.test(a1.text)) return a0;
  return null;
}

// --- Java -----------------------------------------------------------------

const JAVA_STRING_UTILS = new Set(["isNumeric", "isAlphanumeric", "isAlpha"]);
const JAVA_NUMBER_UTILS = new Set(["isDigits", "isParsable", "isCreatable", "isNumber"]);
/** Colecciones del código: una constante, un campo o `Set.of(...)`/`List.of(...)`. */
const JAVA_COLLECTION = /^(?:[A-Za-z_$][\w$]*|this\.[\w$]+|(?:java\.util\.)?(?:Set|List|Map)\.of\(.*\)|(?:java\.util\.)?Arrays\.asList\(.*\))$/s;

export function javaValidated(call: CallInfo, ctx: GuardContext): TsNode | null {
  const method = methodOf(call.callee);
  const owner = ownerOf(call.callee);
  const [a0, a1] = call.args;
  const receiver = call.receiver;
  // `x.matches("[a-z]+")`: String.matches compara la cadena entera.
  if (method === "matches" && call.args.length === 1 && receiver && !/(?:^|\.)Pattern$/.test(owner)) {
    return literalOf(a0, ctx, "identifier") !== null ? receiver : null;
  }
  if (method === "matches" && /(?:^|\.)Pattern$/.test(owner) && a1) return a1;
  // `PATRON.matcher(x).matches()`
  if (method === "matches" && call.args.length === 0 && receiver?.type === "method_invocation"
    && receiver.childForFieldName("name")?.text === "matcher") {
    return receiver.childForFieldName("arguments")?.namedChildren[0] ?? null;
  }
  if ((method === "contains" || method === "containsKey") && receiver && isOtherThan(receiver, a0)
    && JAVA_COLLECTION.test(normalizeKey(receiver.text))) {
    return a0 ?? null;
  }
  if (/(?:^|\.)StringUtils$/.test(owner) && JAVA_STRING_UTILS.has(method)) return a0 ?? null;
  if (/(?:^|\.)NumberUtils$/.test(owner) && JAVA_NUMBER_UTILS.has(method)) return a0 ?? null;
  // `"asc".equals(orden)`, `orden.equalsIgnoreCase("desc")`
  if ((method === "equals" || method === "equalsIgnoreCase") && receiver && a0) {
    if (ctx.stringOf(receiver) !== null && ctx.stringOf(a0) === null) return a0;
    if (ctx.stringOf(a0) !== null && ctx.stringOf(receiver) === null) return receiver;
  }
  return null;
}

// --- PHP ------------------------------------------------------------------

const PHP_TYPE_CHECKS = new Set([
  "is_numeric", "ctype_digit", "ctype_alnum", "ctype_alpha", "ctype_xdigit", "is_int", "is_integer", "is_float", "is_bool",
]);
const PHP_SAFE_FILTERS = /\bFILTER_VALIDATE_(?:INT|FLOAT|IP|BOOL|BOOLEAN|MAC)\b/;

export function phpValidated(call: CallInfo, ctx: GuardContext): TsNode | null {
  const fn = call.callee.replace(/^\\/, "").toLowerCase();
  const [a0, a1] = call.args;
  if (PHP_TYPE_CHECKS.has(fn)) return a0 ?? null;
  if (fn === "filter_var" && a1 && PHP_SAFE_FILTERS.test(a1.text)) return a0 ?? null;
  if ((fn === "in_array" || fn === "array_key_exists") && isOtherThan(a1, a0)) return a0 ?? null;
  if (fn === "preg_match" && a1) {
    const pattern = literalOf(a0, ctx, "variable_name");
    return pattern !== null && isAnchoredDelimited(pattern) ? a1 : null;
  }
  return null;
}

// --- Go -------------------------------------------------------------------

/** `regexp.MustCompile("^...$")`, directo o en una variable: su patrón. */
function goCompiled(node: TsNode | undefined, ctx: GuardContext): string | null {
  const value = node?.type === "identifier" ? ctx.constOf(node.text) : node ?? null;
  if (value?.type !== "call_expression") return null;
  if (!/^regexp\.(?:MustCompile|Compile)$/.test(normalizeKey(value.childForFieldName("function")?.text ?? ""))) return null;
  const first = value.childForFieldName("arguments")?.namedChildren[0];
  return first ? literalOf(first, ctx, "identifier") : null;
}

export function goValidated(
  call: CallInfo,
  ctx: GuardContext,
  qualify: (callee: string) => string | undefined,
): TsNode | null {
  const qualified = qualify(call.callee) ?? call.callee;
  const [a0, a1] = call.args;
  if (qualified === "regexp.MatchString") {
    const pattern = literalOf(a0, ctx, "identifier");
    return pattern !== null && isAnchoredPattern(pattern) ? a1 ?? null : null;
  }
  if (methodOf(call.callee) === "MatchString" && call.receiver) {
    const pattern = goCompiled(call.receiver, ctx);
    return pattern !== null && isAnchoredPattern(pattern) ? a0 ?? null : null;
  }
  if (qualified === "slices.Contains" && isOtherThan(a0, a1)) return a1 ?? null;
  return null;
}
