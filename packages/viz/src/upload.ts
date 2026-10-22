import ignore from "ignore";
import {
  ALWAYS_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_BYTES,
  GRAPHSAST_IGNORE_FILE,
  isProjectConfigName,
} from "@graphsast/core/browser";
import { plural } from "./labels.js";
import type { UploadedFile } from "./protocol.js";

/** Por qué quedaron afuera los archivos que no se analizan. */
export interface UploadSelection {
  accepted: UploadedFile[];
  /**
   * tsconfig/jsconfig: no se analizan, pero aportan los alias de imports
   * (`@/x`) para seguir llamadas entre archivos.
   */
  configs: UploadedFile[];
  /** Dentro de una carpeta excluida (node_modules, dist, .git…). */
  ignored: number;
  /** Excluidos por un `.gitignore` del proyecto. */
  gitignored: number;
  /** Excluidos por un `.graphsastignore` del proyecto. */
  graphsastIgnored: number;
  /** Extensión de un lenguaje que no se analiza. */
  otherLanguage: number;
  tooLarge: number;
}

const IGNORED_DIRS = new Set([...ALWAYS_IGNORE, ...DEFAULT_IGNORE]);

/** `./a\\b.ts` y `/a/b.ts` → `a/b.ts`: la ruta con la que se identifica el archivo. */
export function normalizeUploadPath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^(\.\/|\/)+/, "");
}

function extensionOf(p: string): string {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i);
}

/** ¿Excluye algún `.gitignore` (o `.graphsastignore`) esta ruta? (ver `gitignoreFilter`) */
export type GitignoreFilter = (path: string) => boolean;

/**
 * Lee los `.gitignore` subidos (o los archivos `name`, con la misma sintaxis,
 * como `.graphsastignore`) y devuelve un filtro con sus reglas. Cada uno vale
 * para su carpeta y las de adentro, igual que en git y en el CLI.
 */
export async function gitignoreFilter(
  files: UploadedFile[],
  name = ".gitignore",
): Promise<GitignoreFilter> {
  const scopes: { dir: string; rules: ReturnType<typeof ignore> }[] = [];
  for (const upload of files) {
    const path = normalizeUploadPath(upload.path);
    if (path !== name && !path.endsWith(`/${name}`)) continue;
    const dir = path.slice(0, path.length - name.length);
    try {
      scopes.push({ dir, rules: ignore().add(await upload.file.text()) });
    } catch {
      // Un .gitignore ilegible no excluye nada.
    }
  }
  if (scopes.length === 0) return () => false;
  return (path) =>
    scopes.some(({ dir, rules }) => path.startsWith(dir) && rules.ignores(path.slice(dir.length)));
}

/**
 * Mismos criterios que el descubrimiento de archivos del CLI: extensiones
 * JS/TS, carpetas excluidas por defecto, `.gitignore` y `.graphsastignore`
 * del proyecto (si se pasan los filtros) y tamaño máximo.
 */
export function selectUploads(
  files: UploadedFile[],
  gitignored: GitignoreFilter = () => false,
  graphsastIgnored: GitignoreFilter = () => false,
): UploadSelection {
  const selection: UploadSelection = {
    accepted: [],
    configs: [],
    ignored: 0,
    gitignored: 0,
    graphsastIgnored: 0,
    otherLanguage: 0,
    tooLarge: 0,
  };
  const seen = new Set<string>();
  for (const upload of files) {
    const path = normalizeUploadPath(upload.path);
    const dirs = path.split("/").slice(0, -1);
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (dirs.some((d) => IGNORED_DIRS.has(d))) selection.ignored++;
    else if (gitignored(path)) selection.gitignored++;
    else if (graphsastIgnored(path)) selection.graphsastIgnored++;
    else if (isProjectConfigName(name)) selection.configs.push({ path, file: upload.file });
    else if (!DEFAULT_EXTENSIONS.includes(extensionOf(path))) selection.otherLanguage++;
    else if (upload.file.size > DEFAULT_MAX_FILE_BYTES) selection.tooLarge++;
    else if (!seen.has(path)) {
      seen.add(path);
      selection.accepted.push({ path, file: upload.file });
    }
  }
  selection.accepted.sort((a, b) => a.path.localeCompare(b.path));
  return selection;
}

/** Resumen de lo elegido: cuántos se analizan y por qué quedaron afuera los demás. */
export function describeSelection(selection: UploadSelection): string {
  const parts = [
    `${plural(selection.accepted.length, "archivo de código", "archivos de código")} para analizar`,
  ];
  if (selection.ignored) {
    parts.push(`${selection.ignored} en node_modules u otras carpetas excluidas`);
  }
  if (selection.gitignored) {
    parts.push(`${selection.gitignored} excluidos por .gitignore`);
  }
  if (selection.graphsastIgnored) {
    parts.push(`${selection.graphsastIgnored} excluidos por ${GRAPHSAST_IGNORE_FILE}`);
  }
  if (selection.otherLanguage) {
    parts.push(`${selection.otherLanguage} de otros tipos`);
  }
  if (selection.tooLarge) {
    parts.push(`${plural(selection.tooLarge, "demasiado grande", "demasiado grandes")} (más de 1 MB)`);
  }
  return parts.join(" · ");
}

/** Archivos de un `<input type="file">`, con carpeta (`webkitdirectory`) o sin ella. */
export function filesFromInput(list: FileList): UploadedFile[] {
  return Array.from(list, (file) => ({ path: file.webkitRelativePath || file.name, file }));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, out: UploadedFile[]): Promise<void> {
  if (entry.isFile) {
    out.push({ path: entry.fullPath, file: await fileOf(entry as FileSystemFileEntry) });
    return;
  }
  if (!entry.isDirectory) return;
  // No se baja a carpetas excluidas: node_modules puede tener cientos de miles de archivos.
  if (IGNORED_DIRS.has(entry.name)) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries devuelve por tandas: hay que llamarlo hasta que venga vacío.
  for (;;) {
    const batch = await readEntries(reader);
    if (batch.length === 0) break;
    for (const child of batch) await walkEntry(child, out);
  }
}

/** Archivos y carpetas soltados sobre la página. */
export async function filesFromDrop(data: DataTransfer): Promise<UploadedFile[]> {
  const entries = Array.from(data.items)
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return filesFromInput(data.files);
  const out: UploadedFile[] = [];
  for (const entry of entries) await walkEntry(entry, out);
  return out;
}
