import { ts } from "ts-morph";
import * as path from "../util/posix-path.js";

/**
 * Alias de imports declarados en `tsconfig.json` / `jsconfig.json`
 * (`compilerOptions.baseUrl` y `compilerOptions.paths`), para resolver
 * `import { find } from "@/repositories/users"` como si fuera relativo.
 *
 * Todo trabaja con rutas absolutas con `/` en un único espacio: el del disco
 * en el CLI, el de los archivos subidos en la web. Quien escanea traduce.
 */

/** Un archivo de configuración: ruta absoluta con `/` y su texto. */
export interface ProjectConfig {
  path: string;
  content: string;
}

/** Candidatos (rutas absolutas sin extensión) para un specifier no relativo. */
export type AliasResolver = (fromAbs: string, specifier: string) => string[];

export { isProjectConfigName } from "./config-name.js";

interface RawConfig {
  dir: string;
  extends?: string;
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

/** Opciones efectivas, ya con `extends` aplicado y rutas absolutas. */
interface EffectiveAliases {
  dir: string;
  /** `baseUrl` absoluto, si lo hay. */
  baseUrl?: string;
  /** Base contra la que se resuelven los destinos de `paths`. */
  pathsBase: string;
  paths: { prefix: string; suffix: string; wildcard: boolean; targets: string[] }[];
}

/** JSON con comentarios y comas finales, como lo lee TypeScript. */
function parseConfig(config: ProjectConfig): RawConfig | null {
  const { config: json, error } = ts.parseConfigFileTextToJson(config.path, config.content);
  if (error || typeof json !== "object" || json === null) return null;
  const options = (json as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
  const ext = (json as { extends?: unknown }).extends;
  return {
    dir: path.dirname(config.path),
    extends: typeof ext === "string" ? ext : undefined,
    baseUrl: typeof options.baseUrl === "string" ? options.baseUrl : undefined,
    paths: isPathsMap(options.paths) ? options.paths : undefined,
  };
}

function isPathsMap(value: unknown): value is Record<string, string[]> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((v) => Array.isArray(v) && v.every((t) => typeof t === "string"));
}

/**
 * Aplica `extends` (solo rutas relativas a otro config del conjunto; un
 * paquete como `@tsconfig/node20` no aporta alias del proyecto). `baseUrl` se
 * resuelve contra el config que lo declara; `paths`, contra `baseUrl` si lo
 * hay o, si no, contra el config que declara `paths`.
 */
function effectiveAliases(
  start: string,
  raw: ReadonlyMap<string, RawConfig>,
): EffectiveAliases | null {
  let baseUrl: string | undefined;
  let paths: Record<string, string[]> | undefined;
  let pathsDir: string | undefined;
  const seen = new Set<string>();
  let current: string | undefined = start;
  while (current && !seen.has(current)) {
    seen.add(current);
    const cfg = raw.get(current);
    if (!cfg) break;
    if (baseUrl === undefined && cfg.baseUrl !== undefined) baseUrl = path.resolve(cfg.dir, cfg.baseUrl);
    if (paths === undefined && cfg.paths !== undefined) {
      paths = cfg.paths;
      pathsDir = cfg.dir;
    }
    if (!cfg.extends || !cfg.extends.startsWith(".")) break;
    const target = path.resolve(cfg.dir, cfg.extends);
    current = raw.has(target) ? target : raw.has(`${target}.json`) ? `${target}.json` : undefined;
  }
  if (baseUrl === undefined && paths === undefined) return null;

  const pathsBase = baseUrl ?? pathsDir ?? raw.get(start)!.dir;
  const patterns = Object.entries(paths ?? {}).map(([pattern, targets]) => {
    const star = pattern.indexOf("*");
    return star === -1
      ? { prefix: pattern, suffix: "", wildcard: false, targets }
      : { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1), wildcard: true, targets };
  });
  // El patrón con el prefijo más largo gana, como en TypeScript.
  patterns.sort((a, b) => b.prefix.length - a.prefix.length);
  return { dir: raw.get(start)!.dir, baseUrl, pathsBase, paths: patterns };
}

/** Prioridad dentro de una misma carpeta: tsconfig.json, jsconfig.json, el resto. */
function preference(file: string): number {
  const name = file.slice(file.lastIndexOf("/") + 1);
  if (name === "tsconfig.json") return 0;
  if (name === "jsconfig.json") return 1;
  return 2;
}

/**
 * Resolvedor de alias para un conjunto de configs. A cada archivo le aplica el
 * config más cercano hacia arriba que declare `baseUrl` o `paths`.
 */
export function aliasResolverFor(configs: readonly ProjectConfig[]): AliasResolver {
  const raw = new Map<string, RawConfig>();
  for (const c of configs) {
    const parsed = parseConfig(c);
    if (parsed) raw.set(path.resolve("/", c.path), parsed);
  }

  // Por carpeta, el config preferido que efectivamente declara alias.
  const byDir = new Map<string, EffectiveAliases>();
  const ordered = [...raw.keys()].sort((a, b) => preference(a) - preference(b));
  for (const file of ordered) {
    const dir = path.dirname(file);
    if (byDir.has(dir)) continue;
    const aliases = effectiveAliases(file, raw);
    if (aliases) byDir.set(dir, aliases);
  }
  if (byDir.size === 0) return () => [];

  const nearest = (fromAbs: string): EffectiveAliases | undefined => {
    let dir = path.dirname(fromAbs);
    for (;;) {
      const hit = byDir.get(dir);
      if (hit) return hit;
      if (dir === "/") return undefined;
      dir = path.dirname(dir);
    }
  };

  return (fromAbs, specifier) => {
    if (specifier.startsWith(".") || specifier.startsWith("/")) return [];
    const aliases = nearest(path.resolve("/", fromAbs));
    if (!aliases) return [];

    for (const p of aliases.paths) {
      let captured: string | null = null;
      if (!p.wildcard) {
        if (specifier === p.prefix) captured = "";
      } else if (
        specifier.length >= p.prefix.length + p.suffix.length
        && specifier.startsWith(p.prefix)
        && specifier.endsWith(p.suffix)
      ) {
        captured = specifier.slice(p.prefix.length, specifier.length - p.suffix.length);
      }
      if (captured === null) continue;
      return p.targets.map((t) => path.resolve(aliases.pathsBase, t.replace(/\*/g, captured!)));
    }

    // Con baseUrl, `services/user` también se busca desde baseUrl.
    return aliases.baseUrl ? [path.resolve(aliases.baseUrl, specifier)] : [];
  };
}
