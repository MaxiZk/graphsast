/**
 * Lenguajes que analiza GraphSAST. JavaScript/TypeScript se parsean con
 * ts-morph; los demás, con tree-sitter (ver `runtime.ts`), y todos llegan a la
 * misma representación intermedia.
 */
export type ForeignLanguage = "python" | "java" | "php" | "go";
export type Language = "javascript" | ForeignLanguage;

export const FOREIGN_LANGUAGES: readonly ForeignLanguage[] = ["python", "java", "php", "go"];

const BY_EXTENSION: Readonly<Record<string, Language>> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "javascript",
  ".tsx": "javascript",
  ".py": "python",
  ".java": "java",
  ".php": "php",
  ".go": "go",
};

/** Extensiones de cada lenguaje, en el orden de `BY_EXTENSION`. */
export const LANGUAGE_EXTENSIONS: readonly string[] = Object.keys(BY_EXTENSION);

/** Nombre para mostrar. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  javascript: "JavaScript/TypeScript",
  python: "Python",
  java: "Java",
  php: "PHP",
  go: "Go",
};

function extensionOf(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
}

/** Lenguaje de un archivo por su extensión; JavaScript si no se reconoce. */
export function languageOf(path: string): Language {
  return BY_EXTENSION[extensionOf(path)] ?? "javascript";
}

export function isForeignLanguage(language: Language): language is ForeignLanguage {
  return language !== "javascript";
}
