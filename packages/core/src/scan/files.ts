import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_BYTES,
  type ScanOptions,
} from "./types.js";

function isIgnored(absPath: string, root: string, ignore: string[]): boolean {
  const rel = path.relative(root, absPath);
  if (!rel) return false;
  const segments = rel.split(path.sep);
  return segments.some((seg) => ignore.includes(seg));
}

/**
 * Descubre archivos analizables bajo `target` (archivo o directorio).
 * Devuelve rutas absolutas, ordenadas para que el escaneo sea determinista.
 */
export function discoverFiles(
  target: string,
  options: ScanOptions = {},
  root = target,
): string[] {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  if (!existsSync(target)) return [];

  const stat = statSync(target);

  if (stat.isFile()) {
    if (!extensions.includes(path.extname(target))) return [];
    if (stat.size > maxBytes) return [];
    return [path.resolve(target)];
  }

  if (!stat.isDirectory()) return [];

  const out: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (isIgnored(full, root, ignore)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      out.push(...discoverFiles(full, options, root));
    } else if (entry.isFile()) {
      if (!extensions.includes(path.extname(entry.name))) continue;
      let size: number;
      try {
        size = statSync(full).size;
      } catch {
        continue;
      }
      if (size > maxBytes) continue;
      out.push(path.resolve(full));
    }
  }
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
