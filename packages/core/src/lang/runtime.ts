import { Language as TsLanguage, Parser, type Tree } from "web-tree-sitter";
import type { ForeignLanguage } from "./language.js";

/**
 * Parsers de tree-sitter para los lenguajes que no son JS/TS.
 *
 * Cargar una gramática es asíncrono (compila WebAssembly); parsear, no. Por
 * eso quien escanea llama una vez a `loadLanguages` y después el análisis
 * sigue sincrónico como siempre. La línea de comandos lee las gramáticas del
 * disco (`node.ts`) y la web, del bundle.
 */

/** Bytes o URL de la gramática de un lenguaje. */
export type GrammarSource = (language: ForeignLanguage) => Promise<Uint8Array | string>;

export interface RuntimeOptions {
  /** Ubicación de `web-tree-sitter.wasm` (en el navegador, la URL del bundle). */
  locateFile?: (file: string, prefix: string) => string;
}

let initialized: Promise<void> | null = null;
const loaded = new Map<ForeignLanguage, TsLanguage>();
const loading = new Map<ForeignLanguage, Promise<void>>();
const parsers = new Map<ForeignLanguage, Parser>();

function init(options: RuntimeOptions): Promise<void> {
  initialized ??= Parser.init(options.locateFile ? { locateFile: options.locateFile } : undefined);
  return initialized;
}

/** Carga las gramáticas pedidas que todavía no estén cargadas. */
export async function loadLanguages(
  languages: Iterable<ForeignLanguage>,
  source: GrammarSource,
  options: RuntimeOptions = {},
): Promise<void> {
  await init(options);
  await Promise.all([...new Set(languages)].map((language) => {
    if (loaded.has(language)) return Promise.resolve();
    let pending = loading.get(language);
    if (!pending) {
      pending = source(language)
        .then((input) => TsLanguage.load(input))
        .then((grammar) => {
          loaded.set(language, grammar);
        })
        .finally(() => loading.delete(language));
      loading.set(language, pending);
    }
    return pending;
  }));
}

export function isLanguageLoaded(language: ForeignLanguage): boolean {
  return loaded.has(language);
}

/** Parsea con la gramática ya cargada; si no lo está, es un error del llamador. */
export function parseForeign(code: string, language: ForeignLanguage): Tree {
  const grammar = loaded.get(language);
  if (!grammar) {
    throw new Error(`La gramática de ${language} no está cargada (falta llamar a loadLanguages).`);
  }
  let parser = parsers.get(language);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(grammar);
    parsers.set(language, parser);
  }
  const tree = parser.parse(code);
  if (!tree) throw new Error(`No se pudo parsear el archivo de ${language}.`);
  return tree;
}
