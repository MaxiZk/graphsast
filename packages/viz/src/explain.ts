import type { CweCatalogEntry, IRGraph, IRNode, IRNodeKind, TaintFinding } from "@graphsast/core/browser";

/**
 * Explicación de un hallazgo para quien no conoce la herramienta: de dónde
 * viene el dato y por qué no es confiable, a dónde llega y por qué es
 * peligroso, por qué nada lo frenó y cómo se corrige. Los textos de riesgo,
 * ataque y corrección salen del catálogo, así que una familia nueva se explica
 * sola.
 */

export interface ExplainStep {
  kind: IRNodeKind;
  label: string;
  code: string;
  file: string;
  line: number;
  /** El paso está en otro archivo que el anterior. */
  newFile: boolean;
}

export interface FindingExplanation {
  /** «SQL Injection (CWE-89)». */
  title: string;
  /** Una línea: qué llega a dónde y en cuántos pasos. */
  summary: string;
  source: { label: string; where: string; why: string };
  sink: { label: string; where: string; code: string; why: string; attack?: string };
  /** Por qué el camino no se cortó. */
  missing: string;
  fix?: string;
  steps: ExplainStep[];
}

/** Lo que la explicación usa de una familia del catálogo. */
export type ExplainEntry = Pick<CweCatalogEntry, "cwe" | "name" | "description" | "attack" | "fix" | "sanitizers">
  & Partial<Pick<CweCatalogEntry, "languages">>;

/** La familia con la corrección y los saneamientos del lenguaje del archivo. */
function entryForLanguage(graph: IRGraph, entry: ExplainEntry | undefined): ExplainEntry | undefined {
  const language = graph.language;
  if (!entry || !language || language === "javascript") return entry;
  const own = entry.languages?.[language];
  return own ? { ...entry, fix: own.fix ?? entry.fix, sanitizers: own.sanitizers } : entry;
}

/** Parámetros que en Express, Koa o Fetch son el request HTTP. */
const REQUEST_NAMES = new Set(["req", "request", "ctx"]);

export function stepLabel(node: IRNode): string {
  if (node.kind === "Call") return node.callee;
  return node.name || node.kind;
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

export function whereOf(node: IRNode): string {
  return `${baseName(node.loc.file)}:${node.loc.line}`;
}

/** Por qué GraphSAST trata a este nodo como entrada no confiable. */
function sourceWhy(graph: IRGraph, node: IRNode): string {
  if (node.kind === "Call" && node.input) {
    return "Es una entrada del usuario: lo que llega en el pedido (parámetros, formulario, "
      + "cookies) o en la URL de la página lo decide quien la arma.";
  }
  if (node.kind !== "Parameter") {
    return "Es el punto donde el dato entra al código analizado.";
  }
  const decorator = node.decorators?.[0];
  if (decorator) {
    return `Lo marca @${decorator}(): en NestJS es una parte del request HTTP, que arma quien hace la petición.`;
  }
  if (REQUEST_NAMES.has(node.name)) {
    return "Es el request HTTP: su contenido (URL, cuerpo, headers) lo decide quien hace la petición.";
  }
  const owner = graph.nodes.find((n) => n.id === node.ownerFnId);
  const fn = owner?.name ? `${owner.name}()` : `la función de la línea ${owner?.loc.line ?? node.loc.line}`;
  return (
    `Es un parámetro de ${fn}, y ninguna función del código analizado la llama: `
    + "GraphSAST supone que puede recibir cualquier dato de afuera."
  );
}

/** Nombres de sanitizer demasiado genéricos para servir de ejemplo. */
const GENERIC_SANITIZERS = new Set(["sanitize", "validate", "escape"]);

/** Algunos sanitizers concretos de la familia, para nombrar qué faltó. */
function sanitizerExamples(entry: ExplainEntry | undefined): string {
  const names = (entry?.sanitizers ?? []).filter((s) => !GENERIC_SANITIZERS.has(s)).slice(0, 3);
  return names.length > 0 ? ` (por ejemplo ${names.join(", ")})` : "";
}

export function explainFinding(
  graph: IRGraph,
  finding: TaintFinding,
  familyEntry?: ExplainEntry,
): FindingExplanation | null {
  const entry = entryForLanguage(graph, familyEntry);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = finding.path.map((id) => byId.get(id)).filter((n): n is IRNode => n !== undefined);
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return null;

  const steps = nodes.map((n, i) => ({
    kind: n.kind,
    label: stepLabel(n),
    code: n.code,
    file: n.loc.file,
    line: n.loc.line,
    newFile: i > 0 && n.loc.file !== nodes[i - 1]!.loc.file,
  }));
  const edges = nodes.length - 1;
  const files = new Set(nodes.map((n) => n.loc.file)).size;
  const family = finding.cweName ?? entry?.name;

  return {
    title: family
      ? `${family}${finding.cwe ? ` (CWE-${finding.cwe})` : ""}`
      : "Flujo sin sanitizar",
    summary:
      `${stepLabel(first)} llega a ${stepLabel(last)} en `
      + `${edges} ${edges === 1 ? "paso" : "pasos"}`
      + (files > 1 ? `, pasando por ${files} archivos.` : "."),
    source: { label: stepLabel(first), where: whereOf(first), why: sourceWhy(graph, first) },
    sink: {
      label: stepLabel(last),
      where: whereOf(last),
      code: last.code,
      why: entry?.description ?? "Es una operación peligrosa: lo que reciba se interpreta como parte de una instrucción.",
      ...(entry?.attack ? { attack: entry.attack } : {}),
    },
    missing:
      `En ${edges === 1 ? "el paso" : `los ${edges} pasos`} del camino no hay ningún filtro`
      + `${family ? ` contra ${family}` : ""}${sanitizerExamples(entry)}: el dato llega tal como entró.`,
    ...(entry?.fix ? { fix: entry.fix } : {}),
    steps,
  };
}

/**
 * Agrupa hallazgos que terminan en el mismo destino. Varios caminos a la
 * misma línea son una sola cosa que corregir: listarlos por separado hace
 * parecer que hay más vulnerabilidades de las que hay. Dentro de cada grupo,
 * primero el camino más corto, que es el más fácil de seguir.
 */
export function groupBySink<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  lengthOf: (item: T) => number,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map((g) => [...g].sort((a, b) => lengthOf(a) - lengthOf(b)));
}
