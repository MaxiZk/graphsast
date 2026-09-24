import { calleeMatchesPattern } from "../../catalog/rules.js";
import type { CweCatalogEntry } from "../../catalog/types.js";

/**
 * Línea de base por expresiones regulares para las hipótesis H1 y H2.
 *
 * Marca como vulnerable toda llamada (o escritura de propiedad) a un destino
 * del catálogo, salvo que todos sus argumentos sean literales. No sigue el
 * recorrido del dato ni reconoce saneamientos: es la detección por
 * coincidencia de patrones que las hipótesis toman como referencia,
 * equivalente a un patrón `db.query($X)` sin modo taint.
 *
 * Usa el mismo catálogo y la misma coincidencia de nombres que el motor
 * (`calleeMatchesPattern`), de modo que la comparación aísla una sola
 * variable: el análisis del flujo sobre el grafo.
 */

export interface BaselineFinding {
  cwe: number;
  sink: string;
  line: number;
  code: string;
}

const IDENT = /[A-Za-z_$][\w$]*/;
const CALL_RE = /([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;
const PROP_WRITE_RE = /\.\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/g;
const JSX_ATTR_RE = /\b([A-Za-z_$][\w$]*)\s*=\s*\{/g;
const LITERAL_WORDS = new Set(["true", "false", "null", "undefined"]);

/**
 * Reemplaza los comentarios por espacios sin tocar los literales de texto,
 * para que un sink comentado no cuente y los índices sigan coincidiendo con
 * el código original.
 */
export function maskComments(code: string): string {
  const out = code.split("");
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && next === "*") {
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < code.length) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      i = skipString(code, i);
      continue;
    }
    i++;
  }
  return out.join("");
}

function skipString(code: string, start: number): number {
  const quote = code[start];
  let i = start + 1;
  while (i < code.length && code[i] !== quote) {
    if (code[i] === "\\") i++;
    i++;
  }
  return i + 1;
}

/** Texto entre el delimitador de apertura en `open` y su cierre balanceado. */
function balanced(code: string, open: number, openCh: string, closeCh: string): string {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const c = code[i]!;
    if (c === "'" || c === '"' || c === "`") { i = skipString(code, i); continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
    i++;
  }
  return code.slice(open + 1);
}

/**
 * ¿La expresión es solo literal? Se quitan los textos sin interpolación y los
 * números; si queda un identificador, depende de un valor no constante.
 */
export function isLiteralOnly(expr: string): boolean {
  const stripped = expr
    .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ");
  const words = stripped.match(new RegExp(IDENT.source, "g")) ?? [];
  return words.every((w) => LITERAL_WORDS.has(w));
}

function lineOf(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (code[i] === "\n") line++;
  return line;
}

function lineText(code: string, line: number): string {
  return (code.split("\n")[line - 1] ?? "").trim();
}

function matchSink(
  entries: CweCatalogEntry[],
  callee: string,
): { cwe: number; sink: string } | null {
  for (const entry of entries) {
    for (const sink of entry.sinks) {
      if (calleeMatchesPattern(callee, sink)) return { cwe: entry.cwe, sink };
    }
  }
  return null;
}

/** Analiza un archivo con la línea de base y devuelve un hallazgo por coincidencia. */
export function baselineScan(code: string, entries: CweCatalogEntry[]): BaselineFinding[] {
  const src = maskComments(code);
  const findings: BaselineFinding[] = [];
  const push = (index: number, hit: { cwe: number; sink: string }) => {
    const line = lineOf(src, index);
    findings.push({ ...hit, line, code: lineText(code, line) });
  };

  // Llamadas: db.query(x), exec(cmd), Model.create(body)...
  for (const m of src.matchAll(CALL_RE)) {
    const before = src.slice(Math.max(0, m.index! - 9), m.index!);
    if (/function\s*$/.test(before)) continue; // declaración, no llamada
    const callee = m[1]!.replace(/\s+/g, "").replace(/\?\./g, ".");
    const hit = matchSink(entries, callee);
    if (!hit) continue;
    const open = m.index! + m[0].length - 1;
    const args = balanced(src, open, "(", ")");
    // Sin argumentos el dato puede venir en el receptor (`doc.save()`), como
    // lo marcaría un patrón `$X.save()`: se cuenta. Solo se descartan las
    // llamadas cuyos argumentos son todos literales.
    if (args.trim() !== "" && isLiteralOnly(args)) continue;
    push(m.index!, hit);
  }

  // Escrituras de propiedad: el.innerHTML = x
  for (const m of src.matchAll(PROP_WRITE_RE)) {
    const hit = matchSink(entries, `x.${m[1]}`);
    if (!hit) continue;
    const rest = src.slice(m.index! + m[0].length);
    const rhs = rest.split(/;|\n/)[0] ?? "";
    if (rhs.trim() === "" || isLiteralOnly(rhs)) continue;
    push(m.index!, hit);
  }

  // Atributos JSX: dangerouslySetInnerHTML={{__html: x}}
  for (const m of src.matchAll(JSX_ATTR_RE)) {
    const hit = matchSink(entries, m[1]!);
    if (!hit) continue;
    const open = m.index! + m[0].length - 1;
    const value = balanced(src, open, "{", "}");
    const html = /__html\s*:\s*([^,}]+)/.exec(value);
    const payload = html ? html[1]! : value;
    if (payload.trim() === "" || isLiteralOnly(payload)) continue;
    push(m.index!, hit);
  }

  return findings.sort((a, b) => a.line - b.line);
}
