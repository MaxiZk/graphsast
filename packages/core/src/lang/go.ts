import type { Node as TsNode } from "web-tree-sitter";
import type { BindingInfo, CallInfo, FunctionInfo, LanguageSpec, ParamInfo } from "./spec.js";

/**
 * Go: net/http, database/sql, os/exec.
 *
 * - El pedido llega como parámetro (`r *http.Request`, `c *gin.Context`).
 * - `json.NewDecoder(r.Body).Decode(&req)` escribe en `req`: un argumento
 *   `&x` es una asignación a `x` con el valor de la llamada.
 * - `a, err := f()` define cada nombre con el valor de la llamada; con tantos
 *   valores como nombres, cada uno con el suyo.
 * - Un import con alias (`sq "database/sql"`) se reconoce por el nombre del
 *   paquete.
 */

function normalize(text: string): string {
  return text.replace(/\s+/g, "");
}

/** Tipo del receptor de un método, sin puntero: `(s *Server)` → `Server`. */
function receiverType(method: TsNode): string | undefined {
  const param = method.childForFieldName("receiver")?.namedChildren.find((c) => c?.type === "parameter_declaration");
  const type = param?.childForFieldName("type")?.text;
  return type?.replace(/^\*/, "").replace(/\[.*$/, "") || undefined;
}

function paramsOf(list: TsNode | null): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of list?.namedChildren ?? []) {
    if (!p || (p.type !== "parameter_declaration" && p.type !== "variadic_parameter_declaration")) continue;
    for (const name of p.childrenForFieldName("name")) {
      if (name) out.push({ name: name.text, at: name });
    }
  }
  return out;
}

function identifiersOf(list: TsNode | null): TsNode[] {
  if (!list) return [];
  if (list.type === "identifier") return [list];
  if (list.type === "expression_list") return list.namedChildren.flatMap((c) => identifiersOf(c));
  if (list.type === "selector_expression" || list.type === "index_expression") {
    return identifiersOf(list.childForFieldName("operand"));
  }
  return [];
}

function expressionsOf(list: TsNode | null): TsNode[] {
  if (!list) return [];
  return list.type === "expression_list" ? list.namedChildren.filter((c): c is TsNode => c !== null) : [list];
}

/** `a, b := x, y` empareja; `a, err := f()` le da el valor de `f()` a todos. */
function pairUp(left: TsNode | null, right: TsNode | null): BindingInfo[] {
  const names = expressionsOf(left).flatMap((l) => identifiersOf(l));
  const values = expressionsOf(right);
  return names
    .filter((n) => n.text !== "_")
    .map((name, i) => ({
      name: name.text,
      at: name,
      value: values.length === names.length ? values[i] ?? null : values.length === 1 ? values[0]! : right,
    }));
}

export function goSpec(): LanguageSpec {
  const aliases = new Map<string, string>();

  return {
    language: "go",

    prepare(root) {
      for (const spec of root.descendantsOfType("import_spec")) {
        const alias = spec?.childForFieldName("name")?.text;
        const path = spec?.childForFieldName("path")?.text.replace(/^["`]|["`]$/g, "");
        if (!alias || !path || alias === "_" || alias === ".") continue;
        const segments = path.split("/");
        const last = /^v\d+$/.test(segments.at(-1) ?? "") ? segments.at(-2) : segments.at(-1);
        if (last) aliases.set(alias, last);
      }
    },

    functionOf(node): FunctionInfo | null {
      switch (node.type) {
        case "function_declaration":
          return { name: node.childForFieldName("name")?.text ?? "", params: paramsOf(node.childForFieldName("parameters")) };
        case "method_declaration": {
          const owner = receiverType(node);
          return {
            name: node.childForFieldName("name")?.text ?? "",
            ...(owner ? { memberOf: owner } : {}),
            params: paramsOf(node.childForFieldName("parameters")),
          };
        }
        case "func_literal":
          return { name: "", params: paramsOf(node.childForFieldName("parameters")) };
        default:
          return null;
      }
    },

    classNameOf() {
      return null;
    },

    bindingsOf(node): BindingInfo[] {
      switch (node.type) {
        case "short_var_declaration":
        case "assignment_statement":
          return pairUp(node.childForFieldName("left"), node.childForFieldName("right"));
        case "var_spec":
        case "const_spec": {
          const names = node.childrenForFieldName("name").filter((n): n is TsNode => n !== null && n.text !== "_");
          const value = node.childForFieldName("value");
          const values = expressionsOf(value);
          return names.map((name, i) => ({
            name: name.text,
            at: name,
            value: values.length === names.length ? values[i] ?? null : value,
          }));
        }
        case "range_clause":
          return pairUp(node.childForFieldName("left"), node.childForFieldName("right"))
            .map((b) => ({ ...b, value: node.childForFieldName("right") }));
        case "call_expression": {
          // `Decode(&req)`: la llamada escribe en `req`.
          const args = node.childForFieldName("arguments")?.namedChildren ?? [];
          return args.flatMap((arg) => {
            if (arg?.type !== "unary_expression" || !arg.text.startsWith("&")) return [];
            const target = arg.childForFieldName("operand");
            return identifiersOf(target).map((name) => ({ name: name.text, at: arg, value: node }));
          });
        }
        default:
          return [];
      }
    },

    callOf(node): CallInfo | null {
      if (node.type !== "call_expression") return null;
      const fn = node.childForFieldName("function");
      const args = node.childForFieldName("arguments");
      if (!fn || !args) return null;
      return {
        callee: normalize(fn.text),
        args: args.namedChildren.filter((a): a is TsNode => a !== null && a.type !== "comment"),
        ...(fn.type === "selector_expression" ? { receiver: fn.childForFieldName("operand") ?? undefined } : {}),
        idAt: args,
      };
    },

    identifierOf(node) {
      return node.type === "identifier" && node.text !== "_" ? node.text : null;
    },

    memberObjectOf(node) {
      switch (node.type) {
        case "selector_expression":
        case "index_expression":
        case "slice_expression":
        case "type_assertion_expression":
          return node.childForFieldName("operand");
        default:
          return null;
      }
    },

    returnValueOf(node) {
      if (node.type !== "return_statement") return undefined;
      return node.namedChildren[0] ?? null;
    },

    nonExpressionFields: new Set(["name", "type", "field", "key", "result", "receiver", "package"]),
    opaqueTypes: new Set(["comment", "raw_string_literal"]),

    qualify(callee) {
      const dot = callee.indexOf(".");
      if (dot === -1) return undefined;
      const pkg = aliases.get(callee.slice(0, dot));
      return pkg ? pkg + callee.slice(dot) : undefined;
    },
  };
}
