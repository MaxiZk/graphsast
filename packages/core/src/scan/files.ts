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
import {
  ALWAYS_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_BYTES,
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

function readGitignore(dir: string): IgnoreScope | null {
  let text: string;
  try {
    text = readFileSync(path.join(dir, ".gitignore"), "utf8");
  } catch {
    return null;
  }
  return { base: dir, rules: ignore().add(text) };
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

/** Como git: los .gitignore más profundos pisan a los de arriba. */
function excludedByGitignore(abs: string, isDir: boolean, scopes: IgnoreScope[]): boolean {
  let excluded = false;
  for (const scope of scopes) {
    const verdict = scopeVerdict(scope, abs, isDir);
    if (verdict !== null) excluded = verdict;
  }
  return excluded;
}

/**
 * .gitignore de los ancestros de `dir`, desde la raíz del repositorio hacia
 * abajo. Fuera de un repositorio git no se sube: solo cuentan los de adentro.
 */
function ancestorScopes(dir: string): IgnoreScope[] {
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
    .map(readGitignore)
    .filter((s): s is IgnoreScope => s !== null);
}

function walk(
  dir: string,
  root: string,
  scopes: IgnoreScope[],
  ctx: WalkContext,
  out: string[],
): void {
  const own = ctx.gitignore ? readGitignore(dir) : null;
  const active = own ? [...scopes, own] : scopes;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
    if (!ctx.extensions.includes(path.extname(entry.name))) continue;
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
 * Un archivo pasado explícitamente se analiza aunque un .gitignore lo excluya:
 * las exclusiones aplican al recorrer carpetas.
 */
export function discoverFiles(
  target: string,
  options: ScanOptions = {},
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
  };

  const out: string[] = [];
  walk(root, root, ctx.gitignore ? ancestorScopes(root) : [], ctx, out);
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
