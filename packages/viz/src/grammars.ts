/// <reference types="vite/client" />
import { isForeignLanguage, languageOf, loadLanguages, type ForeignLanguage } from "@graphsast/core/browser";
import runtimeWasm from "web-tree-sitter/web-tree-sitter.wasm?url";
import pythonWasm from "@graphsast/core/grammars/python.wasm?url";
import javaWasm from "@graphsast/core/grammars/java.wasm?url";
import phpWasm from "@graphsast/core/grammars/php.wasm?url";
import goWasm from "@graphsast/core/grammars/go.wasm?url";

/**
 * Gramáticas de tree-sitter para Python, Java, PHP y Go, servidas como
 * archivos del bundle. Se bajan solo las de los lenguajes que aparecen en lo
 * que se analiza: un proyecto JavaScript no carga ninguna.
 */
const GRAMMARS: Record<ForeignLanguage, string> = {
  python: pythonWasm,
  java: javaWasm,
  php: phpWasm,
  go: goWasm,
};

export async function ensureLanguagesFor(paths: Iterable<string>): Promise<void> {
  const languages = new Set<ForeignLanguage>();
  for (const path of paths) {
    const language = languageOf(path);
    if (isForeignLanguage(language)) languages.add(language);
  }
  if (languages.size === 0) return;
  await loadLanguages(languages, async (language) => GRAMMARS[language], {
    locateFile: () => runtimeWasm,
  });
}
