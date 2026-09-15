import type { IRGraph, IRNode, TaintFinding } from "@graphsast/core";

export function nodeLabel(node: IRNode): string {
  if (node.kind === "Call") return node.callee;
  if (node.name) return `${node.kind}: ${node.name}`;
  return node.kind;
}

export function nodeById(graph: IRGraph, id: string): IRNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export function formatFindingPath(graph: IRGraph, finding: TaintFinding): string {
  return finding.path
    .map((id) => {
      const node = nodeById(graph, id);
      return node ? nodeLabel(node) : id;
    })
    .join(" → ");
}

export function findingTitle(graph: IRGraph, finding: TaintFinding, index: number): string {
  const source = nodeById(graph, finding.sourceId);
  const sink = nodeById(graph, finding.sinkId);
  const from = source ? nodeLabel(source) : finding.sourceId;
  const to = sink ? nodeLabel(sink) : finding.sinkId;
  const cwe = finding.cwe ? ` [CWE-${finding.cwe}]` : "";
  return `Hallazgo ${index + 1}${cwe}: ${from} → ${to}`;
}

/** Frase por nodo para la lectura en prosa del hallazgo. */
function nodePhrase(node: IRNode): string {
  switch (node.kind) {
    case "Parameter":
      return `el parámetro ${node.name}`;
    case "Variable":
      return `la variable ${node.name}`;
    case "Function":
      return `la función ${node.name || "anónima"}`;
    case "Call":
      return node.callee;
    default:
      return node.name || node.kind;
  }
}

/** Tramo intermedio: el verbo cambia según qué atraviesa el dato. */
function stepPhrase(node: IRNode): string {
  switch (node.kind) {
    case "Variable":
      return `se copia a ${nodePhrase(node)}`;
    case "Function":
      return `cruza ${nodePhrase(node)}`;
    case "Call":
      return `pasa por ${nodePhrase(node)}`;
    // `nodePhrase` devuelve «el parámetro x»: con «pasa a» delante hay que
    // contraer, o sale «pasa a el parámetro x».
    case "Parameter":
      return `pasa al parámetro ${node.name}`;
    default:
      return `pasa a ${nodePhrase(node)}`;
  }
}

/**
 * Lectura del hallazgo en lenguaje natural, para quien nunca vio la
 * herramienta: «El dato entra por el parámetro input, se copia a la variable q
 * y llega a db.query sin pasar por ninguna función de saneamiento».
 *
 * Todo hallazgo es por construcción un camino sin sanitizar —el analizador
 * saca los sanitizers del grafo antes de buscarlo—, así que el cierre de la
 * frase vale para cualquiera de ellos.
 */
export function describeFinding(graph: IRGraph, finding: TaintFinding): string {
  const nodes = finding.path
    .map((id) => nodeById(graph, id))
    .filter((n): n is IRNode => n !== undefined);
  if (nodes.length === 0) return "";

  const closing = "sin pasar por ninguna función de saneamiento.";
  const first = nodes[0]!;
  if (nodes.length === 1) {
    return `El dato llega directo a ${nodePhrase(first)} ${closing}`;
  }

  const last = nodes[nodes.length - 1]!;
  const parts = [
    `El dato entra por ${nodePhrase(first)}`,
    ...nodes.slice(1, -1).map(stepPhrase),
    `llega a ${nodePhrase(last)}`,
  ];
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]} ${closing}`;
}

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * Lectura cuando no hay hallazgo. Distingue «no hay nada que evaluar» de
 * «hay qué evaluar y da limpio»: un panel que dijera lo mismo en los dos
 * casos afirmaría seguridad donde solo hubo falta de cobertura.
 */
export function describeNoFinding(sources: number, sinks: number): string {
  if (sources === 0 || sinks === 0) {
    return (
      "No hay camino que describir: el código tiene "
      + `${plural(sources, "entrada", "entradas")} y `
      + `${plural(sinks, "operación sensible", "operaciones sensibles")}.`
    );
  }
  return (
    `Ningún dato llega de ${plural(sources, "entrada", "entradas")} a `
    + `${plural(sinks, "operación sensible", "operaciones sensibles")} `
    + "sin pasar por una función de saneamiento."
  );
}
