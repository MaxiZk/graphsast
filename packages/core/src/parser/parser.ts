import { Project, ts, type SourceFile } from "ts-morph";

/** Dialecto con el que se logró parsear el texto. */
export type Dialect = "ts" | "tsx";

export interface ParseResult {
  sourceFile: SourceFile;
  /** Dialecto efectivo: `tsx` si hizo falta para admitir JSX. */
  dialect: Dialect;
  /**
   * Errores de sintaxis del dialecto elegido. > 0 significa que el parser no
   * entendió el texto: casi siempre, que no es JavaScript ni TypeScript.
   * Solo sintaxis — un identificador no declarado es semántico y no cuenta,
   * así que un fragmento suelto con imports colgados sigue dando 0.
   */
  syntaxErrors: number;
  /** Primeros mensajes de error, para poder explicar el rechazo. */
  messages: string[];
}

const MAX_MESSAGES = 3;

function projectFor(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.React },
  });
}

/**
 * Diagnósticos de sintaxis del archivo.
 *
 * `parseDiagnostics` lo deja el parser durante el parseo, así que leerlo es
 * gratis. La alternativa pública, `Program#getSyntacticDiagnostics`, obliga a
 * construir un Program: medido sobre un archivo de 260 líneas, 357 ms contra
 * 12 ms. Como es un campo interno de TypeScript, si algún día desaparece se
 * cae al camino público en vez de reportar «sin errores» por omisión.
 */
function syntaxDiagnosticsOf(
  project: Project,
  sourceFile: SourceFile,
): readonly ts.Diagnostic[] {
  const internal = (
    sourceFile.compilerNode as unknown as {
      parseDiagnostics?: ts.DiagnosticWithLocation[];
    }
  ).parseDiagnostics;
  if (Array.isArray(internal)) return internal;
  return project.getProgram().compilerObject.getSyntacticDiagnostics(
    sourceFile.compilerNode,
  );
}

function describe(diagnostic: ts.Diagnostic, sourceFile: SourceFile): string {
  const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  if (diagnostic.start === undefined) return text;
  const { line } = sourceFile.compilerNode.getLineAndCharacterOfPosition(
    diagnostic.start,
  );
  return `línea ${line + 1}: ${text}`;
}

function parseAs(code: string, file: string) {
  const project = projectFor();
  const sourceFile = project.createSourceFile(file, code, { overwrite: true });
  const diagnostics = syntaxDiagnosticsOf(project, sourceFile);
  return {
    sourceFile,
    syntaxErrors: diagnostics.length,
    messages: diagnostics.slice(0, MAX_MESSAGES).map((d) => describe(d, sourceFile)),
  };
}

function isJsxFile(file: string): boolean {
  return file.endsWith(".tsx") || file.endsWith(".jsx");
}

function withExtension(file: string, ext: string): string {
  return `${file.replace(/\.[^.]*$/, "")}${ext}`;
}

/**
 * Parsea el texto y reporta si el parser lo entendió.
 *
 * Reintenta como `.tsx` cuando el dialecto plano falla: un componente React
 * pegado tal cual produce errores de sintaxis en `.ts` y ninguno en `.tsx`, y
 * sin este reintento se lo confundiría con un lenguaje no soportado.
 */
export function parseSource(code: string, file = "input.ts"): ParseResult {
  if (isJsxFile(file)) return { ...parseAs(code, file), dialect: "tsx" };

  const plain = parseAs(code, file);
  if (plain.syntaxErrors === 0) return { ...plain, dialect: "ts" };

  const jsx = parseAs(code, withExtension(file, ".tsx"));
  return jsx.syntaxErrors < plain.syntaxErrors
    ? { ...jsx, dialect: "tsx" }
    : { ...plain, dialect: "ts" };
}

/**
 * Convierte texto fuente en un SourceFile de ts-morph en un FS en memoria.
 * Única responsabilidad: parsing. No conoce la IR.
 */
export function loadSource(code: string, file = "input.ts"): SourceFile {
  return projectFor().createSourceFile(file, code, { overwrite: true });
}
