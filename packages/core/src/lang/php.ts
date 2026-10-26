import type { Node as TsNode } from "web-tree-sitter";
import { phpValidated } from "./validators.js";
import type { BindingInfo, CallInfo, FunctionInfo, LanguageSpec, ParamInfo, SyntheticCall } from "./spec.js";

/**
 * PHP: superglobales, PDO/mysqli y plantillas mezcladas con HTML.
 *
 * - `$_GET`, `$_POST`, `$_REQUEST`, `$_COOKIE`, `$_FILES` y las claves del
 *   pedido en `$_SERVER` son entradas aunque no haya parámetros.
 * - `echo`, `print`, `<?= ?>`, `include`/`require` y las comillas invertidas
 *   son construcciones del lenguaje, no llamadas: se modelan como llamadas
 *   `echo`, `print`, `include` y `shell_exec`, que el catálogo trata como
 *   destinos.
 * - `(int)` y `(float)` convierten a número: son la llamada `(int)`, que
 *   sanea como `intval`; `(string)` es la llamada `(string)`, que impide
 *   pasar un array con operadores de MongoDB.
 * - `$obj->m()` es `obj.m`, `Clase::m()` es `Clase.m` y `$this->x` un campo.
 */

const SUPERGLOBALS = new Set(["$_GET", "$_POST", "$_REQUEST", "$_COOKIE", "$_FILES"]);
const SERVER_INPUTS = /^['"](?:HTTP_\w+|REQUEST_URI|QUERY_STRING|PHP_SELF|PATH_INFO|PATH_TRANSLATED|REQUEST_METHOD)['"]$/;
const INPUT_CALLS = new Set(["filter_input", "filter_input_array", "getallheaders", "apache_request_headers"]);
const CLASS_TYPES = new Set(["class_declaration", "trait_declaration", "interface_declaration", "enum_declaration"]);
const NUMERIC_CAST = /^\(?\s*(?:int|integer|float|double|bool|boolean)\s*\)?$/i;
const STRING_CAST = /^\(?\s*string\s*\)?$/i;
const INCLUDES = new Set(["include_expression", "include_once_expression", "require_expression", "require_once_expression"]);

function variableName(node: TsNode): string {
  return node.text.replace(/^\$/, "");
}

function normalize(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/\?->|->|::/g, ".")
    .replace(/\$/g, "")
    .replace(/^\\/, "");
}

function enclosingClass(node: TsNode): string | null {
  for (let p = node.parent; p; p = p.parent) {
    if (CLASS_TYPES.has(p.type)) return p.childForFieldName("name")?.text ?? null;
  }
  return null;
}

function paramsOf(list: TsNode | null): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of list?.namedChildren ?? []) {
    if (!p) continue;
    const name = p.childForFieldName("name");
    if (name?.type === "variable_name") out.push({ name: variableName(name), at: name });
  }
  return out;
}

/** Expresión de un argumento (con nombre o no) de una llamada. */
function argumentsOf(args: TsNode | null): TsNode[] {
  const out: TsNode[] = [];
  for (const arg of args?.namedChildren ?? []) {
    if (!arg || arg.type === "comment") continue;
    if (arg.type === "argument") {
      const value = arg.namedChildren.at(-1);
      if (value) out.push(value);
    } else {
      out.push(arg);
    }
  }
  return out;
}

function targetsOf(node: TsNode | null): { name: string; at: TsNode }[] {
  if (!node) return [];
  switch (node.type) {
    case "variable_name":
      return [{ name: variableName(node), at: node }];
    case "member_access_expression": {
      const object = node.childForFieldName("object");
      if (object?.type === "variable_name" && object.text === "$this") {
        return [{ name: `this.${node.childForFieldName("name")?.text ?? ""}`, at: node }];
      }
      return targetsOf(object);
    }
    case "subscript_expression":
      return targetsOf(node.namedChildren[0] ?? null);
    case "list_literal":
    case "array_creation_expression":
      return node.namedChildren.flatMap((c) => {
        if (c?.type === "array_element_initializer") return targetsOf(c.namedChildren.at(-1) ?? null);
        return targetsOf(c);
      });
    default:
      return [];
  }
}

/** Partes de un `echo a, b` (la coma arma una `sequence_expression`). */
function sequenceParts(node: TsNode | null): TsNode[] {
  if (!node) return [];
  if (node.type === "sequence_expression") return node.namedChildren.flatMap((c) => sequenceParts(c));
  return [node];
}

/** `<?= expr ?>`: la expresión que sigue a la etiqueta corta de salida. */
function isShortEcho(node: TsNode): boolean {
  const prev = node.previousNamedSibling;
  if (!prev) return false;
  const tag = prev.type === "text_interpolation" ? prev.lastNamedChild : prev;
  return tag?.type === "php_tag" && tag.text.startsWith("<?=");
}

/** Escapes que agregan barras antes de las comillas pero no las comillas. */
const QUOTE_ESCAPES = /^(?:mysqli_real_escape_string|mysql_real_escape_string|pg_escape_string|addslashes|sqlite_escape_string|.+\.(?:real_escape_string|escapeString))$/;
const SQL_TEXT = /\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|VALUES|ORDER\s+BY|LIMIT)\b/i;

/** Último carácter de texto literal antes de `node` en la cadena o concatenación que lo contiene. */
function charBefore(node: TsNode): string | null {
  const parent = node.parent;
  if (!parent) return null;
  if (parent.type === "encapsed_string") {
    const before = parent.text.slice(0, node.startIndex - parent.startIndex).replace(/\{$/, "");
    return before.length > 1 ? before.at(-1)! : null;
  }
  if (parent.type === "binary_expression" && parent.childForFieldName("operator")?.type === "."
    && parent.childForFieldName("right")?.id === node.id) {
    let left = parent.childForFieldName("left");
    while (left?.type === "binary_expression") left = left.childForFieldName("right");
    if (left?.type === "encapsed_string" || left?.type === "string") return left.text.slice(0, -1).at(-1) ?? null;
  }
  return null;
}

/** Texto de la cadena (o la concatenación entera) en la que está `node`. */
function enclosingText(node: TsNode): string {
  let top = node.parent;
  while (top?.parent?.type === "binary_expression" && top.parent.childForFieldName("operator")?.type === ".") top = top.parent;
  return top?.text ?? "";
}

/**
 * Llamadas a escapes de comillas cuyo resultado se usa en una consulta sin
 * comillas alrededor: `$id = mysqli_real_escape_string($c, $id)` y después
 * `"... WHERE id = $id"`. El escape no cambia nada ahí (`1 OR 1=1` no tiene
 * comillas).
 */
function unquotedEscapes(root: TsNode): Set<number> {
  const escapesByName = new Map<string, TsNode[]>();
  const uses: TsNode[] = [];
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "assignment_expression") {
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      const fn = right?.type === "function_call_expression" ? right.childForFieldName("function")?.text
        : right?.type === "member_call_expression" ? `x.${right.childForFieldName("name")?.text ?? ""}` : undefined;
      if (left?.type === "variable_name" && right && fn && QUOTE_ESCAPES.test(fn.replace(/^\\/, ""))) {
        const list = escapesByName.get(left.text) ?? [];
        list.push(right);
        escapesByName.set(left.text, list);
      }
    }
    if (node.type === "variable_name") uses.push(node);
    for (const child of node.namedChildren) if (child) stack.push(child);
  }
  const out = new Set<number>();
  if (escapesByName.size === 0) return out;
  for (const use of uses) {
    const escapes = escapesByName.get(use.text);
    if (!escapes) continue;
    const before = charBefore(use);
    if (before === null || before === "'" || before === '"' || before === "`") continue;
    if (!SQL_TEXT.test(enclosingText(use))) continue;
    for (const e of escapes) out.add(e.id);
  }
  return out;
}

export function phpSpec(): LanguageSpec {
  let unquoted = new Set<number>();
  return {
    language: "php",
    newKeyword: true,

    prepare(root) {
      unquoted = unquotedEscapes(root);
    },

    functionOf(node): FunctionInfo | null {
      switch (node.type) {
        case "function_definition":
          return { name: node.childForFieldName("name")?.text ?? "", params: paramsOf(node.childForFieldName("parameters")) };
        case "method_declaration": {
          const owner = enclosingClass(node);
          const name = node.childForFieldName("name")?.text ?? "";
          return {
            name: name === "__construct" ? "constructor" : name,
            ...(owner ? { memberOf: owner } : {}),
            params: paramsOf(node.childForFieldName("parameters")),
          };
        }
        case "anonymous_function":
        case "anonymous_function_creation_expression":
        case "arrow_function":
          return { name: "", params: paramsOf(node.childForFieldName("parameters")) };
        default:
          return null;
      }
    },

    classNameOf(node) {
      return CLASS_TYPES.has(node.type) ? node.childForFieldName("name")?.text ?? "" : null;
    },

    bindingsOf(node): BindingInfo[] {
      switch (node.type) {
        case "assignment_expression":
        case "augmented_assignment_expression":
        case "reference_assignment_expression": {
          const value = node.childForFieldName("right");
          return targetsOf(node.childForFieldName("left")).map((t) => ({ ...t, value }));
        }
        case "foreach_statement": {
          const [iterable, binding] = node.namedChildren;
          if (!iterable || !binding) return [];
          const targets = binding.type === "pair" ? targetsOf(binding.namedChildren.at(-1) ?? null) : targetsOf(binding);
          return targets.map((t) => ({ ...t, value: iterable }));
        }
        default:
          return [];
      }
    },

    callOf(node): CallInfo | null {
      const args = node.childForFieldName("arguments")
        ?? node.namedChildren.find((c) => c?.type === "arguments")
        ?? null;
      if (!args) return null;
      switch (node.type) {
        case "function_call_expression":
          return {
            callee: normalize(node.childForFieldName("function")?.text ?? ""),
            args: argumentsOf(args),
            idAt: args,
            ...(unquoted.has(node.id) ? { unquotedUse: true } : {}),
          };
        case "member_call_expression":
        case "nullsafe_member_call_expression": {
          const object = node.childForFieldName("object");
          return {
            callee: `${normalize(object?.text ?? "")}.${node.childForFieldName("name")?.text ?? ""}`,
            args: argumentsOf(args),
            ...(object ? { receiver: object } : {}),
            idAt: args,
            ...(unquoted.has(node.id) ? { unquotedUse: true } : {}),
          };
        }
        case "scoped_call_expression": {
          const scope = normalize(node.childForFieldName("scope")?.text ?? "");
          return {
            callee: `${scope === "self" || scope === "static" ? "this" : scope}.${node.childForFieldName("name")?.text ?? ""}`,
            args: argumentsOf(args),
            idAt: args,
          };
        }
        case "object_creation_expression": {
          const type = node.namedChildren.find((c) => c?.type === "name" || c?.type === "qualified_name");
          return { callee: normalize(type?.text ?? ""), args: argumentsOf(args), isNew: true, idAt: args };
        }
        default:
          return null;
      }
    },

    identifierOf(node) {
      return node.type === "variable_name" ? variableName(node) : null;
    },

    thisFieldOf(node) {
      if (node.type !== "member_access_expression") return null;
      const object = node.childForFieldName("object");
      if (object?.type !== "variable_name" || object.text !== "$this") return null;
      return `this.${node.childForFieldName("name")?.text ?? ""}`;
    },

    memberObjectOf(node) {
      if (node.type === "member_access_expression" || node.type === "nullsafe_member_access_expression") {
        return node.childForFieldName("object");
      }
      if (node.type === "subscript_expression") return node.namedChildren[0] ?? null;
      return null;
    },

    inputOf(node) {
      if (node.type === "variable_name") return SUPERGLOBALS.has(node.text) ? node.text : null;
      if (node.type === "subscript_expression") {
        const [base, key] = node.namedChildren;
        if (base?.text === "$_SERVER" && key && SERVER_INPUTS.test(key.text)) return `$_SERVER[${key.text}]`;
        return null;
      }
      if (node.type === "function_call_expression") {
        const fn = normalize(node.childForFieldName("function")?.text ?? "");
        if (INPUT_CALLS.has(fn)) return fn;
        if (fn === "file_get_contents" && /php:\/\/input/.test(node.text)) return "php://input";
      }
      return null;
    },

    syntheticOf(node): SyntheticCall | null {
      if (node.type === "echo_statement") return { callee: "echo", args: sequenceParts(node.namedChildren[0] ?? null) };
      if (node.type === "print_intrinsic") return { callee: "print", args: node.namedChildren.filter((c): c is TsNode => c !== null) };
      if (INCLUDES.has(node.type)) return { callee: "include", args: node.namedChildren.filter((c): c is TsNode => c !== null) };
      if (node.type === "shell_command_expression") {
        return { callee: "shell_exec", args: node.namedChildren.filter((c): c is TsNode => c !== null) };
      }
      if (node.type === "cast_expression") {
        const type = node.childForFieldName("type")?.text ?? "";
        const value = node.childForFieldName("value");
        if (NUMERIC_CAST.test(type)) return { callee: "(int)", args: value ? [value] : [] };
        if (STRING_CAST.test(type)) return { callee: "(string)", args: value ? [value] : [] };
      }
      if (node.type === "expression_statement" && isShortEcho(node)) {
        return { callee: "echo", args: sequenceParts(node.namedChildren[0] ?? null) };
      }
      return null;
    },

    validatedBy(_node, call, ctx) {
      return phpValidated(call, ctx);
    },

    returnValueOf(node) {
      if (node.type === "return_statement") return node.namedChildren[0] ?? null;
      // `fn($x) => expr`: el cuerpo es lo que retorna.
      if (node.parent?.type === "arrow_function" && node.parent.childForFieldName("body")?.id === node.id) return node;
      return undefined;
    },

    nonExpressionFields: new Set(["name", "type", "scope"]),
    opaqueTypes: new Set(["comment", "text", "text_interpolation", "php_tag"]),
  };
}
