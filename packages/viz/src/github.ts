import {
  ALWAYS_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_BYTES,
  GRAPHSAST_IGNORE_FILE,
  isProjectConfigName,
} from "@graphsast/core/browser";
import type { UploadedFile } from "./protocol.js";

/**
 * Importar un repositorio público de GitHub por su URL.
 *
 * El navegador pide el árbol de archivos a la API de GitHub (dos pedidos:
 * el repositorio y el árbol) y baja cada archivo de raw.githubusercontent.com,
 * que no cuenta para el límite de la API. Solo se bajan los archivos que el
 * análisis usaría: código de los lenguajes soportados, configuraciones de alias y los .gitignore. El código
 * no pasa por ningún servidor de GraphSAST, igual que al subir una carpeta.
 */

export interface GithubTarget {
  owner: string;
  repo: string;
  /** Rama, tag o commit; sin valor, la rama por defecto del repositorio. */
  ref?: string;
  /** Subcarpeta a analizar (`/tree/main/src`), sin barras en los extremos. */
  dir?: string;
}

export interface GithubImport {
  target: Required<Pick<GithubTarget, "owner" | "repo" | "ref">> & { dir: string };
  files: UploadedFile[];
  /** Archivos JS/TS que quedaron afuera por el tope de la importación. */
  omitted: number;
  /** La API devolvió el árbol incompleto (repositorios muy grandes). */
  truncated: boolean;
}

/** Tope de archivos por importación: más que eso conviene clonar y usar el CLI. */
export const MAX_GITHUB_FILES = 1500;
const CONCURRENCY = 8;
const IGNORED_DIRS = new Set([...ALWAYS_IGNORE, ...DEFAULT_IGNORE]);
const NAME = /^[A-Za-z0-9_.-]+$/;

export class GithubImportError extends Error {}

/**
 * `https://github.com/dueño/repo`, `github.com/dueño/repo/tree/rama/src`,
 * `dueño/repo` o la URL de clonado (`.git`). Devuelve `null` si no es una
 * dirección de un repositorio.
 */
export function parseGithubUrl(input: string): GithubTarget | null {
  let text = input.trim().replace(/^git\+/, "");
  text = text.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (/^github\.com\//i.test(text)) text = text.slice("github.com/".length);
  else if (/^[^/]+\.[^/]+\//.test(text)) return null; // otro dominio
  text = text.split(/[?#]/)[0]!.replace(/\/+$/, "");
  const [owner, rawRepo, kind, ref, ...rest] = text.split("/");
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return null;
  if (kind === undefined) return { owner, repo };
  if ((kind !== "tree" && kind !== "blob") || !ref) return null;
  const dir = (kind === "blob" ? rest.slice(0, -1) : rest).join("/");
  return { owner, repo, ref: decodeURIComponent(ref), ...(dir ? { dir: decodeURIComponent(dir) } : {}) };
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i);
}

/** ¿Hace falta bajar este archivo para analizar? Mismos criterios que `selectUploads`. */
export function wantedPath(path: string, size: number): boolean {
  const parts = path.split("/");
  const name = parts.at(-1)!;
  if (parts.slice(0, -1).some((d) => IGNORED_DIRS.has(d))) return false;
  if (name === ".gitignore" || name === GRAPHSAST_IGNORE_FILE || isProjectConfigName(name)) return true;
  return DEFAULT_EXTENSIONS.includes(extensionOf(path)) && size <= DEFAULT_MAX_FILE_BYTES;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function apiJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { headers: { Accept: "application/vnd.github+json" } });
  if (res.ok) return res.json();
  if (res.status === 404) {
    throw new GithubImportError("No se encontró el repositorio o la rama. Solo se pueden importar repositorios públicos.");
  }
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const when = Number.isFinite(reset) && reset > 0
      ? ` Se libera a las ${new Date(reset * 1000).toLocaleTimeString()}.`
      : "";
    throw new GithubImportError(`GitHub limita a 60 consultas por hora sin iniciar sesión y se alcanzó el límite.${when} Mientras tanto, se puede clonar el repositorio y subir la carpeta.`);
  }
  throw new GithubImportError(`GitHub respondió ${res.status} al pedir ${url}.`);
}

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

/** Baja los archivos del repositorio que el análisis usaría. */
export async function importGithubRepo(
  target: GithubTarget,
  options: {
    fetch?: typeof fetch;
    onProgress?: (done: number, total: number, path: string) => void;
  } = {},
): Promise<GithubImport> {
  const fetchFn = options.fetch ?? fetch.bind(globalThis);
  const api = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const ref = target.ref ?? ((await apiJson(fetchFn, api)) as { default_branch: string }).default_branch;
  const tree = (await apiJson(fetchFn, `${api}/git/trees/${encodeURIComponent(ref)}?recursive=1`)) as {
    tree: TreeEntry[];
    truncated?: boolean;
  };

  const dir = target.dir?.replace(/^\/+|\/+$/g, "") ?? "";
  const prefix = dir ? `${dir}/` : "";
  const candidates = tree.tree
    .filter((e) => e.type === "blob" && e.path.startsWith(prefix))
    .map((e) => ({ path: e.path, relative: e.path.slice(prefix.length), size: e.size ?? 0 }))
    .filter((e) => wantedPath(e.relative, e.size))
    .sort((a, b) => a.relative.localeCompare(b.relative));
  if (candidates.length === 0) {
    throw new GithubImportError(dir
      ? `No hay archivos de código para analizar en ${dir}.`
      : "El repositorio no tiene archivos de JavaScript, TypeScript, Python, Java, PHP ni Go para analizar.");
  }
  const chosen = candidates.slice(0, MAX_GITHUB_FILES);

  const raw = `https://raw.githubusercontent.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${encodePath(ref)}`;
  const files: UploadedFile[] = new Array(chosen.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < chosen.length) {
      const i = next++;
      const entry = chosen[i]!;
      const res = await fetchFn(`${raw}/${encodePath(entry.path)}`);
      if (!res.ok) throw new GithubImportError(`No se pudo bajar ${entry.path} (${res.status}).`);
      const name = entry.relative.slice(entry.relative.lastIndexOf("/") + 1);
      files[i] = { path: entry.relative, file: new File([await res.text()], name) };
      options.onProgress?.(++done, chosen.length, entry.relative);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chosen.length) }, worker));

  return {
    target: { owner: target.owner, repo: target.repo, ref, dir },
    files,
    omitted: candidates.length - chosen.length,
    truncated: tree.truncated === true,
  };
}
