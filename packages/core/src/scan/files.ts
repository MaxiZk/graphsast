import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import ignore from "ignore";
import { isProjectConfigName } from "../project/tsconfig.js";
import {
  ALWAYS_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_BYTES,
  GRAPHSAST_IGNORE_FILE,
  hasMinifiedTwin,
  isMinifiedName,
  type ScanOptions,
} from "./types.js";

type Rules = ReturnType<typeof ignore>;

/** Reglas con sintaxis .gitignore ancladas al directorio que las declara. */
interface IgnoreScope {
  base: string;
  rules: Rules;
}

interface WalkContext {
  extensions: string[];
  ignore: string[];
  maxBytes: number;
  gitignore: boolean;
  exclude: IgnoreScope | null;
  /** Si está, junta acá los tsconfig/jsconfig que encuentra al recorrer. */
  configs?: string[];
}

/** Ruta de entrada inválida: no existe, no se puede leer o no es archivo/carpeta. */
export class ScanInputError extends Error {}

/** Falla con un mensaje claro si `target` no puede escanearse. */
export function assertReadableTarget(target: string): void {
  let stat;
  try {
    stat = statSync(target);
  } catch {
    throw new ScanInputError(`La ruta no existe: ${target}`);
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new ScanInputError(`No es un archivo ni una carpeta: ${target}`);
  }
  try {
    accessSync(target, constants.R_OK);
  } catch {
    throw new ScanInputError(`Sin permiso de lectura: ${target}`);
  }
}

function isIgnored(absPath: string, root: string, ignore: string[]): boolean {
  const rel = path.relative(root, absPath);
  if (!rel) return false;
  const segments = rel.split(path.sep);
  return segments.some((seg) => ignore.includes(seg));
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Reglas de exclusión de una carpeta: su `.gitignore` (si `gitignore`) y su
 * `.graphsastignore`, que se lee siempre porque es configuración de GraphSAST
 * y no del control de versiones. Van en ese orden, así un `!patrón` del
 * `.graphsastignore` puede volver a incluir lo que git ignora. Cada archivo es
 * un scope aparte: ver `discoverFiles`.
 */
function readIgnoreScopes(dir: string, gitignore: boolean): IgnoreScope[] {
  return [
    gitignore ? readText(path.join(dir, ".gitignore")) : null,
    readText(path.join(dir, GRAPHSAST_IGNORE_FILE)),
  ]
    .filter((t): t is string => t !== null)
    .map((text) => ({ base: dir, rules: ignore().add(text) }));
}

/** Veredicto de un scope: true excluye, false re-incluye (`!patrón`), null no opina. */
function scopeVerdict(scope: IgnoreScope, abs: string, isDir: boolean): boolean | null {
  const rel = path.relative(scope.base, abs);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  const posix = rel.split(path.sep).join("/");
  const result = scope.rules.test(isDir ? `${posix}/` : posix);
  if (result.ignored) return true;
  if (result.unignored) return false;
  return null;
}

/** Como git: los .gitignore (y .graphsastignore) más profundos pisan a los de arriba. */
function excludedByGitignore(abs: string, isDir: boolean, scopes: IgnoreScope[]): boolean {
  let excluded = false;
  for (const scope of scopes) {
    const verdict = scopeVerdict(scope, abs, isDir);
    if (verdict !== null) excluded = verdict;
  }
  return excluded;
}

/**
 * Reglas de los ancestros de `dir`, desde la raíz del repositorio hacia
 * abajo. Fuera de un repositorio git no se sube: solo cuentan los de adentro.
 */
function ancestorScopes(dir: string, gitignore: boolean): IgnoreScope[] {
  const chain: string[] = [];
  let current = dir;
  for (;;) {
    if (existsSync(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) return [];
    current = parent;
    chain.push(current);
  }
  return chain
    .reverse()
    .flatMap((d) => readIgnoreScopes(d, gitignore));
}

function walk(
  dir: string,
  root: string,
  scopes: IgnoreScope[],
  ctx: WalkContext,
  out: string[],
): void {
  const own = readIgnoreScopes(dir, ctx.gitignore);
  const active = own.length > 0 ? [...scopes, ...own] : scopes;

  const entries = readdirSync(dir, { withFileTypes: true });
  const names = new Set(entries.map((e) => e.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (isIgnored(full, root, ctx.ignore)) continue;
    if (entry.isSymbolicLink()) continue;
    const isDir = entry.isDirectory();
    if (!isDir && !entry.isFile()) continue;
    if (excludedByGitignore(full, isDir, active)) continue;
    if (ctx.exclude && scopeVerdict(ctx.exclude, full, isDir) === true) continue;

    if (isDir) {
      walk(full, root, active, ctx, out);
      continue;
    }
    if (isMinifiedName(entry.name) || hasMinifiedTwin(entry.name, names)) continue;
    if (!ctx.extensions.includes(path.extname(entry.name))) {
      if (ctx.configs && isProjectConfigName(entry.name)) ctx.configs.push(full);
      continue;
    }
    let size: number;
    try {
      size = statSync(full).size;
    } catch {
      continue;
    }
    if (size > ctx.maxBytes) continue;
    out.push(full);
  }
}

/**
 * Descubre archivos analizables bajo `target` (archivo o directorio).
 * Devuelve rutas absolutas, ordenadas para que el escaneo sea determinista.
 *
 * Un archivo o una carpeta pasados explícitamente se analizan aunque un
 * .gitignore o un .graphsastignore de más arriba los excluya: las exclusiones
 * aplican a lo que se encuentra al recorrer.
 */
export function discoverFiles(
  target: string,
  options: ScanOptions = {},
  configsOut?: string[],
): string[] {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  if (!existsSync(target)) return [];

  const stat = statSync(target);

  if (stat.isFile()) {
    if (!extensions.includes(path.extname(target))) return [];
    if (stat.size > maxBytes) return [];
    return [path.resolve(target)];
  }

  if (!stat.isDirectory()) return [];

  const root = path.resolve(target);
  const ctx: WalkContext = {
    extensions,
    ignore: [...new Set([...ALWAYS_IGNORE, ...(options.ignore ?? DEFAULT_IGNORE)])],
    maxBytes,
    gitignore: options.gitignore ?? true,
    exclude: options.exclude?.length
      ? { base: root, rules: ignore().add(options.exclude) }
      : null,
    configs: configsOut,
  };

  const out: string[] = [];
  // Lo que se pide explícitamente se analiza: un archivo de reglas de más
  // arriba que excluye la propia carpeta pedida no cuenta para este escaneo
  // (escanear `docs/casos` analiza los casos aunque la raíz los excluya).
  const ancestors = ancestorScopes(root, ctx.gitignore)
    .filter((scope) => scopeVerdict(scope, root, true) !== true);
  walk(root, root, ancestors, ctx, out);
  return out.sort();
}

/** Raíz común de un conjunto de rutas, para mostrar caminos relativos. */
export function commonRoot(targets: string[]): string {
  if (targets.length === 0) return process.cwd();
  const dirs = targets.map((t) => {
    const abs = path.resolve(t);
    return existsSync(abs) && statSync(abs).isDirectory() ? abs : path.dirname(abs);
  });
  let root = dirs[0]!;
  for (const dir of dirs.slice(1)) {
    while (dir !== root && !dir.startsWith(root + path.sep)) {
      const parent = path.dirname(root);
      if (parent === root) return root;
      root = parent;
    }
  }
  return root;
}

/**
 * tsconfig/jsconfig de las carpetas que contienen a `target`, hasta la raíz
 * del repositorio (la que tiene `.git`) o del disco. Escanear `./src` con el
 * `tsconfig.json` en la raíz es lo habitual, y sin él `@/x` no se resuelve.
 */
export function ancestorConfigs(target: string): string[] {
  const out: string[] = [];
  let dir = path.resolve(target);
  if (existsSync(dir) && statSync(dir).isFile()) dir = path.dirname(dir);
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
    try {
      for (const name of readdirSync(dir)) {
        if (isProjectConfigName(name)) out.push(path.join(dir, name));
      }
    } catch {
      break;
    }
    if (existsSync(path.join(dir, ".git"))) break;
  }
  return out;
}
