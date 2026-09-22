import path from "node:path";
import { Node, type SourceFile } from "ts-morph";
import { functionIdOf } from "../ir/builder.js";

/** Un nombre importado o re-exportado: de qué módulo y con qué nombre. */
export interface ModuleBinding {
  specifier: string;
  /** Nombre exportado por el otro módulo, `default`, o `*` (namespace). */
  imported: string;
}

/**
 * Lo que un archivo importa y exporta, en la medida en que importa para
 * resolver llamadas entre archivos. Solo módulos ES (import/export).
 */
export interface ModuleLinks {
  /** Nombre local → binding importado. */
  imports: Map<string, ModuleBinding>;
  /** `function` del nivel superior: nombre local → id del nodo Function. */
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
    const expr = assignment.getExpression();
    if (Node.isIdentifier(expr)) links.localExports.set("default", expr.getText());
  }

  return links;
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

/**
 * Resuelve un specifier relativo contra los archivos del escaneo. Los
 * specifiers de paquete (`express`) y los alias de tsconfig no se resuelven:
 * lo que no está en `known` queda afuera del análisis.
 */
export function resolveSpecifier(
  fromAbs: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const base = path.resolve(path.dirname(fromAbs), specifier);
  const candidates = [base];
  const ext = path.extname(base);
  for (const alt of JS_TO_TS[ext] ?? []) candidates.push(base.slice(0, -ext.length) + alt);
  for (const e of RESOLVE_EXTENSIONS) candidates.push(base + e);
  for (const e of RESOLVE_EXTENSIONS) candidates.push(path.join(base, `index${e}`));
  return candidates.find((c) => known.has(c)) ?? null;
}

export interface LinkedModule {
  abs: string;
  links: ModuleLinks;
}

/** Módulos del escaneo por ruta absoluta, más el conjunto de rutas conocidas. */
export interface ProjectIndex {
  modules: ReadonlyMap<string, LinkedModule>;
  known: ReadonlySet<string>;
}

export function projectIndexOf(modules: LinkedModule[]): ProjectIndex {
  const byAbs = new Map(modules.map((m) => [m.abs, m]));
  return { modules: byAbs, known: new Set(byAbs.keys()) };
}

/**
 * Sigue exports, alias, re-exports y `export *` hasta la declaración de la
 * función. Devuelve el id del nodo Function o null si no es una `function`
 * del proyecto (arrow, clase, paquete externo, ciclo).
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
      const target = resolveSpecifier(abs, imported.specifier, known);
      return target ? resolveExportedFunction(index, target, imported.imported, seen) : null;
    }
    return null;
  }

  const re = links.reExports.get(name);
  if (re) {
    const target = resolveSpecifier(abs, re.specifier, known);
    return target ? resolveExportedFunction(index, target, re.imported, seen) : null;
  }

  if (name === "default") return null; // `export *` no re-exporta el default
  for (const specifier of links.starExports) {
    const target = resolveSpecifier(abs, specifier, known);
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
    if (binding.imported === "*") return null;
    exported = binding.imported;
  } else {
    const member = normalized.slice(dot + 1);
    if (binding.imported !== "*" || member.includes(".")) return null;
    exported = member;
  }

  const target = resolveSpecifier(abs, binding.specifier, index.known);
  return target ? resolveExportedFunction(index, target, exported) : null;
}
