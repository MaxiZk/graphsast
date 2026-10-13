import * as path from "../util/posix-path.js";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { functionIdOf, type FunctionLike } from "../ir/builder.js";
import type { AliasResolver } from "./tsconfig.js";

/** Un nombre importado o re-exportado: de qué módulo y con qué nombre. */
export interface ModuleBinding {
  specifier: string;
  /** Nombre exportado por el otro módulo, `default`, o `*` (namespace). */
  imported: string;
  /**
   * Viene de `require`: `const f = require("./x")` puede ser la función misma
   * (`module.exports = f`), así que llamar al binding resuelve el default.
   */
  cjs?: boolean;
}

/**
 * Lo que un archivo importa y exporta, en la medida en que importa para
 * resolver llamadas entre archivos: módulos ES (`import`/`export`) y CommonJS
 * (`require`, `module.exports`, `exports.f`).
 */
export interface ModuleLinks {
  /** Nombre local → binding importado. */
  imports: Map<string, ModuleBinding>;
  /**
   * Funciones del nivel superior: nombre local → id del nodo Function.
   * Incluye `function f`, `const f = () => {}` y las funciones que se asignan
   * directamente a un export de CommonJS (con un nombre local sintético).
   */
  functions: Map<string, string>;
  /** Nombre exportado → nombre local. */
  localExports: Map<string, string>;
  /** Nombre exportado → re-export de otro módulo (`export { f } from "./x"`). */
  reExports: Map<string, ModuleBinding>;
  /** `export * from "./x"`. */
  starExports: string[];
}

/** Nombre local sintético para `export default function () {}`. */
const ANONYMOUS_DEFAULT = "*default*";

export function extractLinks(sourceFile: SourceFile, file: string): ModuleLinks {
  const links: ModuleLinks = {
    imports: new Map(),
    functions: new Map(),
    localExports: new Map(),
    reExports: new Map(),
    starExports: [],
  };

  for (const decl of sourceFile.getImportDeclarations()) {
    if (decl.isTypeOnly()) continue;
    const specifier = decl.getModuleSpecifierValue();
    const def = decl.getDefaultImport();
    if (def) links.imports.set(def.getText(), { specifier, imported: "default" });
    const ns = decl.getNamespaceImport();
    if (ns) links.imports.set(ns.getText(), { specifier, imported: "*" });
    for (const spec of decl.getNamedImports()) {
      if (spec.isTypeOnly()) continue;
      const local = spec.getAliasNode()?.getText() ?? spec.getName();
      links.imports.set(local, { specifier, imported: spec.getName() });
    }
  }

  // Solo sintaxis: isExported()/isDefaultExport() de ts-morph consultan el
  // type checker cuando no hay keyword, y construirlo cuesta ~1 s por archivo.
  // Los exports indirectos (`export { f }`, `export default f`) se leen abajo.
  for (const fn of sourceFile.getFunctions()) {
    if (!fn.hasBody()) continue; // firmas de sobrecarga
    const isDefault = fn.hasExportKeyword() && fn.hasDefaultKeyword();
    const local = fn.getName() ?? (isDefault ? ANONYMOUS_DEFAULT : undefined);
    if (!local) continue;
    links.functions.set(local, functionIdOf(fn, file));
    if (isDefault) links.localExports.set("default", local);
    else if (fn.hasExportKeyword()) links.localExports.set(local, local);
  }

  for (const decl of sourceFile.getExportDeclarations()) {
    if (decl.isTypeOnly()) continue;
    const specifier = decl.getModuleSpecifierValue();
    // Sin exportClause es `export * from "./x"` (con `* as ns` sí hay).
    if (specifier && decl.compilerNode.exportClause === undefined) {
      links.starExports.push(specifier);
      continue;
    }
    for (const spec of decl.getNamedExports()) {
      if (spec.isTypeOnly()) continue;
      const exported = spec.getAliasNode()?.getText() ?? spec.getName();
      if (specifier) links.reExports.set(exported, { specifier, imported: spec.getName() });
      else links.localExports.set(exported, spec.getName());
    }
  }

  for (const assignment of sourceFile.getExportAssignments()) {
    if (assignment.isExportEquals()) continue;
    const expr = unwrap(assignment.getExpression());
    if (Node.isIdentifier(expr)) links.localExports.set("default", expr.getText());
    else if (isFunctionValue(expr)) {
      links.functions.set(ANONYMOUS_DEFAULT, functionIdOf(expr, file));
      links.localExports.set("default", ANONYMOUS_DEFAULT);
    }
  }

  // `const f = () => {}` / `export const f = function () {}` en el nivel superior.
  for (const statement of sourceFile.getVariableStatements()) {
    const exported = statement.hasExportKeyword();
    for (const decl of statement.getDeclarations()) {
      const nameNode = decl.getNameNode();
      const init = decl.getInitializer();
      if (!Node.isIdentifier(nameNode) || !init) continue;
      const value = unwrap(init);
      if (!isFunctionValue(value)) continue;
      const local = nameNode.getText();
      links.functions.set(local, functionIdOf(value, file));
      if (exported) links.localExports.set(local, local);
    }
  }

  extractCommonJs(sourceFile, file, links);
  return links;
}

/** Quita paréntesis y aserciones de tipo: `(x as F)` → `x`. */
function unwrap(node: Node): Node {
  let cur = node;
  while (Node.isParenthesizedExpression(cur) || Node.isAsExpression(cur) || Node.isSatisfiesExpression(cur)) {
    cur = cur.getExpression();
  }
  return cur;
}

function isFunctionValue(node: Node): node is FunctionLike {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

/** `require("x")` → `"x"`; cualquier otra expresión → null. */
function requiredSpecifier(node: Node | undefined): string | null {
  if (!node) return null;
  const expr = unwrap(node);
  if (!Node.isCallExpression(expr)) return null;
  if (expr.getExpression().getText() !== "require") return null;
  const [arg] = expr.getArguments();
  return arg && Node.isStringLiteral(arg) ? arg.getLiteralValue() : null;
}

/** `await import("x")` o `import("x")` → `"x"`; cualquier otra expresión → null. */
function dynamicImportSpecifier(node: Node | undefined): string | null {
  if (!node) return null;
  let expr = unwrap(node);
  if (Node.isAwaitExpression(expr)) expr = unwrap(expr.getExpression());
  if (!Node.isCallExpression(expr)) return null;
  if (expr.getExpression().getKind() !== SyntaxKind.ImportKeyword) return null;
  const [arg] = expr.getArguments();
  return arg && Node.isStringLiteral(arg) ? arg.getLiteralValue() : null;
}

/**
 * Imports y exports de CommonJS, más `import()` dinámico asignado a una
 * variable (`const m = await import("./x")`):
 *
 * - `const repo = require("./repo")` → namespace (`repo.find()` o `repo()`).
 * - `const { find, save: store } = require("./repo")` → nombres.
 * - `const find = require("./repo").find` → un nombre.
 * - `module.exports = f`, `= { f, g: h, k() {} }`, `exports.f = ...` y
 *   `module.exports.f = ...` → exports.
 */
function extractCommonJs(sourceFile: SourceFile, file: string, links: ModuleLinks): void {
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    const nameNode = decl.getNameNode();
    let specifier = requiredSpecifier(init);
    let member: string | null = null;
    if (!specifier && init) {
      const value = unwrap(init);
      if (Node.isPropertyAccessExpression(value)) {
        specifier = requiredSpecifier(value.getExpression());
        member = value.getName();
      }
    }
    if (!specifier) {
      // `const m = await import("./x")`: un namespace ES, no un require.
      const dynamic = dynamicImportSpecifier(init);
      if (!dynamic) continue;
      if (Node.isIdentifier(nameNode)) {
        links.imports.set(nameNode.getText(), { specifier: dynamic, imported: "*" });
      } else if (Node.isObjectBindingPattern(nameNode)) {
        for (const el of nameNode.getElements()) {
          const local = el.getNameNode();
          if (!Node.isIdentifier(local)) continue;
          const imported = el.getPropertyNameNode()?.getText() ?? local.getText();
          links.imports.set(local.getText(), { specifier: dynamic, imported });
        }
      }
      continue;
    }

    if (Node.isIdentifier(nameNode)) {
      links.imports.set(nameNode.getText(), member
        ? { specifier, imported: member }
        : { specifier, imported: "*", cjs: true });
      continue;
    }
    if (Node.isObjectBindingPattern(nameNode) && !member) {
      for (const el of nameNode.getElements()) {
        const local = el.getNameNode();
        if (!Node.isIdentifier(local)) continue;
        const imported = el.getPropertyNameNode()?.getText() ?? local.getText();
        links.imports.set(local.getText(), { specifier, imported });
      }
    }
  }

  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const expr = statement.getExpression();
    if (!Node.isBinaryExpression(expr)) continue;
    if (expr.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const target = expr.getLeft().getText().replace(/\s+/g, "");
    const value = unwrap(expr.getRight());

    if (target === "module.exports") {
      if (Node.isIdentifier(value)) {
        links.localExports.set("default", value.getText());
      } else if (isFunctionValue(value)) {
        links.functions.set(ANONYMOUS_DEFAULT, functionIdOf(value, file));
        links.localExports.set("default", ANONYMOUS_DEFAULT);
      } else if (Node.isObjectLiteralExpression(value)) {
        for (const prop of value.getProperties()) {
          if (Node.isShorthandPropertyAssignment(prop)) {
            links.localExports.set(prop.getName(), prop.getName());
          } else if (Node.isPropertyAssignment(prop)) {
            exportCommonJs(links, file, prop.getName(), unwrap(prop.getInitializerOrThrow()));
          } else if (Node.isMethodDeclaration(prop)) {
            exportCommonJs(links, file, prop.getName(), prop);
          }
        }
      }
      continue;
    }

    const named = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(target);
    if (named) exportCommonJs(links, file, named[1]!, value);
  }
}

/** Registra `exports.<name> = value` (un identificador o una función). */
function exportCommonJs(links: ModuleLinks, file: string, name: string, value: Node): void {
  if (Node.isIdentifier(value)) {
    links.localExports.set(name, value.getText());
  } else if (isFunctionValue(value) || Node.isMethodDeclaration(value)) {
    const local = `*exports.${name}*`;
    links.functions.set(local, functionIdOf(value, file));
    links.localExports.set(name, local);
  }
}


/** Extensiones que se prueban al resolver `./x`, en orden. */
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
/** Convención de TS con ESM: `import "./x.js"` apunta a `x.ts`. */
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/** Rutas a probar para una base sin extensión: `.js`→`.ts`, extensiones, index. */
function candidatesFor(base: string): string[] {
  const candidates = [base];
  const ext = path.extname(base);
  for (const alt of JS_TO_TS[ext] ?? []) candidates.push(base.slice(0, -ext.length) + alt);
  for (const e of RESOLVE_EXTENSIONS) candidates.push(base + e);
  for (const e of RESOLVE_EXTENSIONS) candidates.push(path.join(base, `index${e}`));
  return candidates;
}

/**
 * Resuelve un specifier contra los archivos del escaneo: relativo (`./x`) o
 * alias de `tsconfig`/`jsconfig` (`@/x`, o desde `baseUrl`). Un paquete
 * (`express`) no se resuelve: lo que no está en `known` queda afuera.
 */
export function resolveSpecifier(
  fromAbs: string,
  specifier: string,
  known: ReadonlySet<string>,
  aliases?: AliasResolver,
): string | null {
  const bases = specifier.startsWith("./") || specifier.startsWith("../")
    ? [path.resolve(path.dirname(fromAbs), specifier)]
    : aliases?.(fromAbs, specifier) ?? [];
  for (const base of bases) {
    const hit = candidatesFor(base).find((c) => known.has(c));
    if (hit) return hit;
  }
  return null;
}

export interface LinkedModule {
  abs: string;
  links: ModuleLinks;
}

/** Módulos del escaneo por ruta absoluta, más el conjunto de rutas conocidas. */
export interface ProjectIndex {
  modules: ReadonlyMap<string, LinkedModule>;
  known: ReadonlySet<string>;
  /** Alias de tsconfig/jsconfig, en el mismo espacio de rutas que `modules`. */
  aliases?: AliasResolver;
}

export function projectIndexOf(modules: LinkedModule[], aliases?: AliasResolver): ProjectIndex {
  const byAbs = new Map(modules.map((m) => [m.abs, m]));
  return { modules: byAbs, known: new Set(byAbs.keys()), aliases };
}

/**
 * Sigue exports, alias, re-exports y `export *` hasta la declaración de la
 * función. Devuelve el id del nodo Function o null si no es una función del
 * proyecto (clase, paquete externo, ciclo).
 */
export function resolveExportedFunction(
  index: ProjectIndex,
  abs: string,
  name: string,
  seen: Set<string> = new Set(),
): string | null {
  const key = `${abs}\0${name}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const mod = index.modules.get(abs);
  if (!mod) return null;
  const { links } = mod;
  const { known } = index;

  const local = links.localExports.get(name);
  if (local !== undefined) {
    const fnId = links.functions.get(local);
    if (fnId) return fnId;
    // `import { f } from "./y"; export { f }`
    const imported = links.imports.get(local);
    if (imported && imported.imported !== "*") {
      const target = resolveSpecifier(abs, imported.specifier, known, index.aliases);
      return target ? resolveExportedFunction(index, target, imported.imported, seen) : null;
    }
    return null;
  }

  const re = links.reExports.get(name);
  if (re) {
    const target = resolveSpecifier(abs, re.specifier, known, index.aliases);
    return target ? resolveExportedFunction(index, target, re.imported, seen) : null;
  }

  if (name === "default") return null; // `export *` no re-exporta el default
  for (const specifier of links.starExports) {
    const target = resolveSpecifier(abs, specifier, known, index.aliases);
    const hit = target ? resolveExportedFunction(index, target, name, seen) : null;
    if (hit) return hit;
  }
  return null;
}

/**
 * Función a la que apunta un callee del módulo `abs`, si es un nombre
 * importado (`findUser(...)`) o un miembro de un namespace importado
 * (`svc.findUser(...)`).
 */
export function resolveImportedCallee(
  index: ProjectIndex,
  abs: string,
  callee: string,
): string | null {
  const mod = index.modules.get(abs);
  if (!mod) return null;
  const normalized = callee.replace(/\s+/g, "");
  const dot = normalized.indexOf(".");
  const head = dot === -1 ? normalized : normalized.slice(0, dot);
  const binding = mod.links.imports.get(head);
  if (!binding) return null;

  let exported: string;
  if (dot === -1) {
    // Llamar a un namespace ES no es válido; a un `require` es su default.
    if (binding.imported === "*" && !binding.cjs) return null;
    exported = binding.imported === "*" ? "default" : binding.imported;
  } else {
    const member = normalized.slice(dot + 1);
    if (binding.imported !== "*" || member.includes(".")) return null;
    exported = member;
  }

  const target = resolveSpecifier(abs, binding.specifier, index.known, index.aliases);
  return target ? resolveExportedFunction(index, target, exported) : null;
}

/**
 * ¿El receptor de `algo.m(...)` es un import de un módulo fuera del escaneo
 * (`node:path`, `express`)? Entonces `m` es de ese paquete y no se adivina un
 * método del proyecto: `path.resolve()` no es `FunctionIndex.resolve`.
 */
export function isExternalReceiver(index: ProjectIndex, abs: string, callee: string): boolean {
  const normalized = callee.replace(/\s+/g, "");
  const dot = normalized.indexOf(".");
  if (dot === -1) return false;
  const binding = index.modules.get(abs)?.links.imports.get(normalized.slice(0, dot));
  return binding !== undefined
    && resolveSpecifier(abs, binding.specifier, index.known, index.aliases) === null;
}
