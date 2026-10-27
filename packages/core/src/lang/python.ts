import type { Node as TsNode } from "web-tree-sitter";
import { pythonValidated } from "./validators.js";
import type { BindingInfo, CallInfo, FunctionInfo, LanguageSpec, ParamInfo } from "./spec.js";

/**
 * Python: Flask, Django y FastAPI.
 *
 * - En Flask, `request` es un objeto global importado: sus lecturas
 *   (`request.args`, `request.form`, `request.get_json()`) son orígenes aunque
 *   la función no reciba parámetros.
 * - En una vista de Flask, lo que retorna la función es la respuesta HTML: sus
 *   `return` son destinos `@route.return` (FastAPI responde JSON, por eso solo
 *   cuenta si el archivo importa Flask).
 * - `self.x` es un campo de la instancia (`this.x`), y `__init__` el
 *   constructor: `Servicio(dato)` liga el argumento con su parámetro.
 */

const ROUTE_METHODS = new Set(["route", "get", "post", "put", "delete", "patch"]);
/** `@marshal_with(schema)` y similares: la vista responde el objeto serializado como JSON. */
const JSON_RESPONSE_DECORATOR = /^(?:[\w.]+\.)?(?:marshal_with|marshal|response|output|json_response|returns)\b/;

/** Lecturas del pedido en Flask, Django y Starlette/FastAPI. */
const REQUEST_INPUT = /^request\.(?:args|form|values|json|data|cookies|headers|files|GET|POST|COOKIES|FILES|META|body|query_params|path_params|query_string|full_path|url|path|stream)$/;
const REQUEST_INPUT_CALL = /^request\.(?:get_json|get_data)$/;
/** El pedido en un manejador de `http.server`: `self.path`, `self.headers`, el cuerpo en `self.rfile`. */
const HANDLER_INPUT = /^self\.(?:path|headers|rfile|requestline)$/;
const HANDLER_BASES = /\b(?:BaseHTTPRequestHandler|SimpleHTTPRequestHandler|CGIHTTPRequestHandler|StreamRequestHandler)\b/;

/** ¿El nodo está dentro de una clase que hereda de un manejador de `http.server`/`socketserver`? */
function inRequestHandler(node: TsNode): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "class_definition") return HANDLER_BASES.test(p.childForFieldName("superclasses")?.text ?? "");
  }
  return false;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, "").replace(/^self\./, "this.");
}

function className(node: TsNode | null): string | null {
  return node?.type === "class_definition" ? node.childForFieldName("name")?.text ?? "" : null;
}

/** Clase de la que es método la función (saltando el decorador). */
function enclosingClass(fn: TsNode): string | null {
  let parent = fn.parent;
  if (parent?.type === "decorated_definition") parent = parent.parent;
  if (parent?.type !== "block") return null;
  return className(parent.parent);
}

function decoratorsOf(fn: TsNode): TsNode[] {
  const parent = fn.parent;
  if (parent?.type !== "decorated_definition") return [];
  return parent.namedChildren.filter((c): c is TsNode => c?.type === "decorator");
}

function paramsOf(list: TsNode | null): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of list?.namedChildren ?? []) {
    if (!p) continue;
    let name: TsNode | null = null;
    if (p.type === "identifier") name = p;
    else if (p.type === "default_parameter" || p.type === "typed_default_parameter") name = p.childForFieldName("name");
    else if (p.type === "typed_parameter" || p.type === "list_splat_pattern" || p.type === "dictionary_splat_pattern") {
      name = p.namedChildren.find((c) => c?.type === "identifier") ?? null;
    }
    if (name) out.push({ name: name.text, at: name });
  }
  return out;
}

/** Nombres que define un destino de asignación (`a`, `a, b`, `self.x`, `d["k"]`). */
function targetsOf(node: TsNode | null): { name: string; at: TsNode }[] {
  if (!node) return [];
  switch (node.type) {
    case "identifier":
      return [{ name: node.text, at: node }];
    case "pattern_list":
    case "tuple_pattern":
    case "list_pattern":
    case "tuple":
    case "list":
    case "expression_list":
      return node.namedChildren.flatMap((c) => targetsOf(c));
    case "list_splat_pattern":
      return targetsOf(node.namedChildren[0] ?? null);
    case "attribute": {
      const object = node.childForFieldName("object");
      if (object?.type === "identifier" && object.text === "self") {
        return [{ name: `this.${node.childForFieldName("attribute")?.text ?? ""}`, at: node }];
      }
      return targetsOf(object);
    }
    case "subscript":
      return targetsOf(node.childForFieldName("value"));
    default:
      return [];
  }
}

export function pythonSpec(): LanguageSpec {
  let isFlask = false;
  const aliases = new Map<string, string>();

  const spec: LanguageSpec = {
    language: "python",

    prepare(root) {
      for (const stmt of root.namedChildren) {
        if (!stmt) continue;
        if (stmt.type === "import_statement") {
          for (const name of stmt.childrenForFieldName("name")) {
            if (!name) continue;
            if (name.type === "aliased_import") {
              const module = name.childForFieldName("name")?.text;
              const alias = name.childForFieldName("alias")?.text;
              if (module && alias) aliases.set(alias, module);
            }
            if ((name.type === "dotted_name" ? name.text : name.childForFieldName("name")?.text) === "flask") isFlask = true;
          }
        } else if (stmt.type === "import_from_statement") {
          const module = stmt.childForFieldName("module_name")?.text;
          if (!module) continue;
          if (module === "flask" || module.startsWith("flask.")) isFlask = true;
          for (const name of stmt.childrenForFieldName("name")) {
            if (!name) continue;
            const imported = name.type === "aliased_import" ? name.childForFieldName("name")?.text : name.text;
            const local = name.type === "aliased_import" ? name.childForFieldName("alias")?.text : name.text;
            if (imported && local) aliases.set(local, `${module}.${imported}`);
          }
        }
      }
    },

    functionOf(node): FunctionInfo | null {
      if (node.type === "lambda") {
        return { name: "", params: paramsOf(node.childForFieldName("parameters")) };
      }
      if (node.type !== "function_definition") return null;
      const owner = enclosingClass(node);
      const decorators = decoratorsOf(node);
      const decoratorNames = decorators.map((d) => d.namedChildren[0]?.text ?? "");
      let params = paramsOf(node.childForFieldName("parameters"));
      // `self`/`cls` no ocupan una posición de argumento en `obj.m(x)`.
      if (owner !== null && !decoratorNames.includes("staticmethod")) params = params.slice(1);
      const name = node.childForFieldName("name")?.text ?? "";
      const routeHandler = isFlask && !decoratorNames.some((d) => JSON_RESPONSE_DECORATOR.test(d)) && decorators.some((d) => {
        const expr = d.namedChildren[0];
        if (expr?.type !== "call") return false;
        const fn = expr.childForFieldName("function");
        return fn?.type === "attribute" && ROUTE_METHODS.has(fn.childForFieldName("attribute")?.text ?? "");
      });
      return {
        name: owner !== null && name === "__init__" ? "constructor" : name,
        ...(owner ? { memberOf: owner } : {}),
        params,
        ...(routeHandler ? { routeHandler } : {}),
      };
    },

    classNameOf: className,

    bindingsOf(node): BindingInfo[] {
      switch (node.type) {
        case "assignment":
        case "augmented_assignment": {
          const value = node.childForFieldName("right");
          return targetsOf(node.childForFieldName("left")).map((t) => ({ ...t, value }));
        }
        case "named_expression":
          return targetsOf(node.childForFieldName("name")).map((t) => ({ ...t, value: node.childForFieldName("value") }));
        case "for_statement":
        case "for_in_clause": {
          const value = node.childForFieldName("right");
          return targetsOf(node.childForFieldName("left")).map((t) => ({ ...t, value }));
        }
        case "as_pattern": {
          const value = node.namedChildren[0] ?? null;
          const alias = node.childForFieldName("alias");
          return targetsOf(alias?.namedChildren[0] ?? null).map((t) => ({ ...t, value }));
        }
        default:
          return [];
      }
    },

    callOf(node): CallInfo | null {
      if (node.type !== "call") return null;
      const fn = node.childForFieldName("function");
      const argsNode = node.childForFieldName("arguments");
      if (!fn || !argsNode) return null;
      const positional: TsNode[] = [];
      const keyword: TsNode[] = [];
      if (argsNode.type === "argument_list") {
        for (const arg of argsNode.namedChildren) {
          if (!arg || arg.type === "comment") continue;
          if (arg.type === "keyword_argument") {
            const value = arg.childForFieldName("value");
            if (value) keyword.push(value);
          } else {
            positional.push(arg);
          }
        }
      } else {
        positional.push(argsNode);
      }
      const callee = normalize(fn.text);
      const last = callee.slice(callee.lastIndexOf(".") + 1);
      return {
        callee,
        args: [...positional, ...keyword],
        ...(fn.type === "attribute" ? { receiver: fn.childForFieldName("object") ?? undefined } : {}),
        // `Clase(x)`: se resuelve al `__init__` de la clase, como `new` en JS.
        ...(/^[A-Z]/.test(last) ? { isNew: true } : {}),
        idAt: argsNode,
      };
    },

    identifierOf(node) {
      return node.type === "identifier" ? node.text : null;
    },

    thisFieldOf(node) {
      if (node.type !== "attribute") return null;
      const object = node.childForFieldName("object");
      if (object?.type !== "identifier" || object.text !== "self") return null;
      return `this.${node.childForFieldName("attribute")?.text ?? ""}`;
    },

    memberObjectOf(node) {
      if (node.type === "attribute") return node.childForFieldName("object");
      if (node.type === "subscript") return node.childForFieldName("value");
      return null;
    },

    inputOf(node) {
      if (node.type === "attribute") {
        const text = node.text.replace(/\s+/g, "");
        if (REQUEST_INPUT.test(text)) return text;
        return HANDLER_INPUT.test(text) && inRequestHandler(node) ? text : null;
      }
      if (node.type === "call") {
        const fn = node.childForFieldName("function")?.text.replace(/\s+/g, "") ?? "";
        return REQUEST_INPUT_CALL.test(fn) ? fn : null;
      }
      return null;
    },

    validatedBy(_node, call, ctx) {
      return pythonValidated(call, ctx, (callee) => spec.qualify?.(callee));
    },

    returnValueOf(node) {
      if (node.type !== "return_statement") return undefined;
      return node.namedChildren[0] ?? null;
    },

    nonExpressionFields: new Set(["name", "type", "alias"]),
    opaqueTypes: new Set(["type", "comment"]),

    qualify(callee) {
      const dot = callee.indexOf(".");
      const root = dot === -1 ? callee : callee.slice(0, dot);
      const module = aliases.get(root);
      return module ? module + (dot === -1 ? "" : callee.slice(dot)) : undefined;
    },
  };
  return spec;
}
