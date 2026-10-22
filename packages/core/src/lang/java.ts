import type { Node as TsNode } from "web-tree-sitter";
import type { BindingInfo, CallInfo, FunctionInfo, LanguageSpec, ParamInfo } from "./spec.js";

/**
 * Java: servlets y Spring.
 *
 * - Los parámetros con `@RequestParam`, `@PathVariable`, `@RequestBody`... son
 *   entradas del catálogo, y `request` de un servlet también.
 * - En un `@RestController` (o un método con `@ResponseBody`), lo que retorna
 *   un método con `@GetMapping`/`@PostMapping`... es la respuesta: sus
 *   `return` son destinos `@route.return`.
 * - Un método se llama sin receptor dentro de su clase: `m(x)` es `this.m(x)`.
 * - `this.x` es un campo de la clase; el constructor se llama `constructor`
 *   como en JS, así `new Servicio(dato)` liga el argumento con su parámetro.
 */

const MAPPINGS = new Set(["GetMapping", "PostMapping", "PutMapping", "DeleteMapping", "PatchMapping", "RequestMapping"]);
const CLASS_TYPES = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"]);

function annotationsOf(node: TsNode | null): string[] {
  const modifiers = node?.namedChildren.find((c) => c?.type === "modifiers");
  if (!modifiers) return [];
  return modifiers.namedChildren
    .filter((c): c is TsNode => c?.type === "annotation" || c?.type === "marker_annotation")
    .map((a) => (a.childForFieldName("name")?.text ?? "").replace(/^.*\./, ""));
}

function enclosingClass(node: TsNode): TsNode | null {
  for (let p = node.parent; p; p = p.parent) {
    if (CLASS_TYPES.has(p.type)) return p;
  }
  return null;
}

function paramsOf(list: TsNode | null): ParamInfo[] {
  if (!list) return [];
  if (list.type === "identifier") return [{ name: list.text, at: list }];
  const out: ParamInfo[] = [];
  for (const p of list.namedChildren) {
    if (!p) continue;
    if (p.type === "identifier") {
      out.push({ name: p.text, at: p });
      continue;
    }
    if (p.type !== "formal_parameter" && p.type !== "spread_parameter") continue;
    const name = p.childForFieldName("name")
      ?? p.namedChildren.find((c) => c?.type === "variable_declarator")?.childForFieldName("name")
      ?? null;
    if (!name) continue;
    const decorators = annotationsOf(p);
    out.push({ name: name.text, at: name, ...(decorators.length ? { decorators } : {}) });
  }
  return out;
}

/** Texto del callee sin espacios ni argumentos de tipo: `List<String>` → `List`. */
function normalize(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text.replace(/\s+/g, "")) {
    if (ch === "<") depth++;
    else if (ch === ">" && depth > 0) depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

/** Nombres que define un destino de asignación. */
function targetsOf(node: TsNode | null): { name: string; at: TsNode }[] {
  if (!node) return [];
  if (node.type === "identifier") return [{ name: node.text, at: node }];
  if (node.type === "field_access") {
    const object = node.childForFieldName("object");
    if (object?.type === "this") return [{ name: `this.${node.childForFieldName("field")?.text ?? ""}`, at: node }];
    return targetsOf(object);
  }
  if (node.type === "array_access") return targetsOf(node.childForFieldName("array"));
  return [];
}

export function javaSpec(): LanguageSpec {
  return {
    language: "java",
    newKeyword: true,

    functionOf(node): FunctionInfo | null {
      if (node.type === "lambda_expression") {
        return { name: "", params: paramsOf(node.childForFieldName("parameters")) };
      }
      if (node.type !== "method_declaration" && node.type !== "constructor_declaration") return null;
      const cls = enclosingClass(node);
      const owner = cls?.childForFieldName("name")?.text;
      const annotations = annotationsOf(node);
      // Solo un método que devuelve texto responde HTML: un objeto o una
      // lista se serializa como JSON.
      const returnsText = /^(?:String|CharSequence)$/.test(node.childForFieldName("type")?.text ?? "");
      const routeHandler = returnsText && annotations.some((a) => MAPPINGS.has(a))
        && (annotations.includes("ResponseBody") || annotationsOf(cls).includes("RestController"));
      return {
        name: node.type === "constructor_declaration" ? "constructor" : node.childForFieldName("name")?.text ?? "",
        ...(owner ? { memberOf: owner } : {}),
        params: paramsOf(node.childForFieldName("parameters")),
        ...(routeHandler ? { routeHandler } : {}),
      };
    },

    classNameOf(node) {
      return CLASS_TYPES.has(node.type) ? node.childForFieldName("name")?.text ?? "" : null;
    },

    bindingsOf(node): BindingInfo[] {
      switch (node.type) {
        case "local_variable_declaration":
        case "field_declaration": {
          const field = node.type === "field_declaration";
          return node.childrenForFieldName("declarator").flatMap((d) => {
            const name = d?.childForFieldName("name");
            if (!d || !name) return [];
            return [{ name: field ? `this.${name.text}` : name.text, at: name, value: d.childForFieldName("value") }];
          });
        }
        case "assignment_expression":
          return targetsOf(node.childForFieldName("left")).map((t) => ({ ...t, value: node.childForFieldName("right") }));
        case "enhanced_for_statement": {
          const name = node.childForFieldName("name");
          return name ? [{ name: name.text, at: name, value: node.childForFieldName("value") }] : [];
        }
        default:
          return [];
      }
    },

    callOf(node): CallInfo | null {
      if (node.type === "method_invocation") {
        const name = node.childForFieldName("name")?.text ?? "";
        const object = node.childForFieldName("object");
        const args = node.childForFieldName("arguments");
        if (!args) return null;
        return {
          callee: object ? `${normalize(object.text)}.${name}` : `this.${name}`,
          args: args.namedChildren.filter((a): a is TsNode => a !== null && a.type !== "comment"),
          ...(object ? { receiver: object } : {}),
          idAt: args,
        };
      }
      if (node.type === "object_creation_expression") {
        const args = node.childForFieldName("arguments");
        if (!args) return null;
        return {
          callee: normalize(node.childForFieldName("type")?.text ?? ""),
          args: args.namedChildren.filter((a): a is TsNode => a !== null && a.type !== "comment"),
          isNew: true,
          idAt: args,
        };
      }
      return null;
    },

    identifierOf(node) {
      return node.type === "identifier" ? node.text : null;
    },

    thisFieldOf(node) {
      if (node.type !== "field_access" || node.childForFieldName("object")?.type !== "this") return null;
      return `this.${node.childForFieldName("field")?.text ?? ""}`;
    },

    memberObjectOf(node) {
      if (node.type === "field_access") return node.childForFieldName("object");
      if (node.type === "array_access") return node.childForFieldName("array");
      return null;
    },

    returnValueOf(node) {
      if (node.type !== "return_statement") return undefined;
      return node.namedChildren[0] ?? null;
    },

    nonExpressionFields: new Set(["name", "type", "dimensions", "type_arguments"]),
    opaqueTypes: new Set(["line_comment", "block_comment", "class_literal"]),
  };
}
