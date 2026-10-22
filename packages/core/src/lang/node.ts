import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FOREIGN_LANGUAGES, type ForeignLanguage } from "./language.js";
import { loadLanguages } from "./runtime.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** `grammars/` del paquete: dist/lang → ../../grammars (también desde src/lang). */
export function grammarPath(language: ForeignLanguage): string {
  return path.resolve(MODULE_DIR, "../../grammars", `${language}.wasm`);
}

/**
 * Carga las gramáticas desde el disco. La usan la línea de comandos, la API
 * local y las pruebas; la web carga las suyas desde el bundle.
 */
export function loadNodeLanguages(languages: Iterable<ForeignLanguage> = FOREIGN_LANGUAGES): Promise<void> {
  return loadLanguages(languages, async (language) => new Uint8Array(await readFile(grammarPath(language))));
}
