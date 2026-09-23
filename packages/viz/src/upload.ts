import {
  ALWAYS_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_BYTES,
} from "@graphsast/core/browser";
import { plural } from "./labels.js";
import type { UploadedFile } from "./protocol.js";

/** Por qué quedaron afuera los archivos que no se analizan. */
export interface UploadSelection {
  accepted: UploadedFile[];
  /** Dentro de una carpeta excluida (node_modules, dist, .git…). */
  ignored: number;
  /** Extensión que no es JavaScript/TypeScript. */
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

/**
 * Mismos criterios que el descubrimiento de archivos del CLI: extensiones
 * JS/TS, carpetas excluidas por defecto y tamaño máximo. Los `.gitignore` del
 * proyecto no se leen.
 */
export function selectUploads(files: UploadedFile[]): UploadSelection {
  const selection: UploadSelection = { accepted: [], ignored: 0, otherLanguage: 0, tooLarge: 0 };
  const seen = new Set<string>();
  for (const upload of files) {
    const path = normalizeUploadPath(upload.path);
    const dirs = path.split("/").slice(0, -1);
    if (dirs.some((d) => IGNORED_DIRS.has(d))) selection.ignored++;
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
    `${plural(selection.accepted.length, "archivo JavaScript/TypeScript", "archivos JavaScript/TypeScript")} para analizar`,
  ];
  if (selection.ignored) {
    parts.push(`${selection.ignored} en node_modules u otras carpetas excluidas`);
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
