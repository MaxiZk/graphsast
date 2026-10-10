import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ts } from "ts-morph";
import { ancestorConfigs, discoverFiles, commonRoot } from "./files.js";
import { scanFiles, type ScanInput } from "./scan-files.js";
import { aliasResolverFor, type AliasResolver, type ProjectConfig } from "../project/tsconfig.js";
import type { ScanOptions, ScanResult } from "./types.js";

export { scanSource, toScanFindings } from "./scan-files.js";

/** Ruta del disco con `/` (en Windows, `C:\\x` → `C:/x`). */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Lee los tsconfig dados y los que estos extienden por ruta relativa, aunque
 * estén fuera de lo escaneado (`extends: "../../tsconfig.base.json"`).
 */
function loadConfigs(files: string[]): ProjectConfig[] {
  const loaded = new Map<string, ProjectConfig>();
  const queue = [...files];
  while (queue.length > 0) {
    const file = path.resolve(queue.shift()!);
    if (loaded.has(file)) continue;
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    loaded.set(file, { path: toPosix(file), content });
    const { config } = ts.parseConfigFileTextToJson(file, content);
    const ext = (config as { extends?: unknown } | undefined)?.extends;
    if (typeof ext === "string" && ext.startsWith(".")) {
      const target = path.resolve(path.dirname(file), ext);
      queue.push(existsSync(target) ? target : `${target}.json`);
    }
  }
  return [...loaded.values()];
}

/**
 * Alias en el espacio del escaneo (`/` + ruta relativa a `root`), calculados
 * sobre las rutas reales: un tsconfig puede estar arriba de `root`.
 */
function scanAliases(configFiles: string[], root: string): AliasResolver | undefined {
  if (configFiles.length === 0) return undefined;
  const disk = aliasResolverFor(loadConfigs(configFiles));
  // Igual que adentro del resolvedor: siempre con `/` inicial (`C:/x` → `/C:/x`).
  const rootPosix = path.posix.resolve("/", toPosix(path.resolve(root)));
  return (fromVirtual, specifier) =>
    disk(`${rootPosix}${fromVirtual}`, specifier).flatMap((candidate) => {
      const rel = path.posix.relative(rootPosix, candidate);
      return rel.startsWith("..") ? [] : [`/${rel}`];
    });
}

/**
 * Escanea archivos y/o directorios del disco: descubre los archivos, los lee
 * y delega el análisis en `scanFiles` (ver ahí las fases y el alcance del
 * cruce entre archivos). Cada archivo se identifica por su ruta relativa a la
 * raíz común, con `/` en cualquier sistema operativo.
 */
export function scanPaths(
  targets: string[],
  options: ScanOptions = {},
): ScanResult {
  const root = commonRoot(targets);
  const seen = new Set<string>();
  const inputs: ScanInput[] = [];
  const configs: string[] = [];
  for (const target of targets) {
    configs.push(...ancestorConfigs(target));
    for (const abs of discoverFiles(target, options, configs)) {
      if (seen.has(abs)) continue;
      seen.add(abs);
      const rel = (path.relative(root, abs) || path.basename(abs)).split(path.sep).join("/");
      try {
        inputs.push({ path: rel, content: readFileSync(abs, "utf8") });
      } catch (err) {
        inputs.push({ path: rel, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  const aliases = options.aliases ?? scanAliases([...new Set(configs)], root);
  return scanFiles(inputs, aliases ? { ...options, aliases } : options, root);
}
