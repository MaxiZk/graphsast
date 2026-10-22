import type { Node as TsNode } from "web-tree-sitter";
import { resolveCalls } from "../cfg/callgraph.js";
import { buildDataFlow } from "../dfg/dataflow.js";
import { buildInterproc } from "../dfg/interproc.js";
import type { IRGraph } from "../ir/types.js";
import { markSanitizedEdges } from "../taint/sanitized.js";
import { defaultTaintRules } from "../taint/rules.js";
import { buildForeignModule } from "./builder.js";
import { LANGUAGE_NAMES, type ForeignLanguage } from "./language.js";
import { pythonSpec } from "./python.js";
import { parseForeign } from "./runtime.js";
import type { LanguageSpec } from "./spec.js";

/** Una spec nueva por archivo: guarda lo que `prepare` lee del archivo (imports). */
export function specFor(language: ForeignLanguage): LanguageSpec {
  switch (language) {
    case "python":
      return pythonSpec();
    default:
      throw new Error(`${LANGUAGE_NAMES[language]} todavía no está soportado.`);
  }
}

/** Primer nodo con error de sintaxis, en orden del código. */
function firstSyntaxError(root: TsNode): TsNode | null {
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!node.hasError) continue;
    if (node.isError || node.isMissing) return node;
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }
  return null;
}

export type ForeignGraphResult = { graph: IRGraph } | { error: string };

/**
 * Código de Python, Java, PHP o Go → IRGraph, con las mismas aristas que el
 * de JavaScript. Un archivo con errores de sintaxis no se analiza: devolver
 * «sin hallazgos» lo confundiría con un archivo limpio.
 */
export function foreignGraph(code: string, file: string, language: ForeignLanguage): ForeignGraphResult {
  const tree = parseForeign(code, language);
  try {
    const error = firstSyntaxError(tree.rootNode);
    if (error) {
      const what = error.isMissing ? `falta ${error.type}` : "código que no se reconoce";
      return {
        error: `No se pudo analizar: error de sintaxis de ${LANGUAGE_NAMES[language]} en la línea ${error.startPosition.row + 1} (${what})`,
      };
    }
    const mod = buildForeignModule(tree.rootNode, file, specFor(language));
    const calls = resolveCalls(mod);
    const edges = markSanitizedEdges(mod.nodes, [
      ...calls.edges,
      ...buildDataFlow(mod, calls.exactCallIds),
      ...buildInterproc(mod, calls.edges),
    ], defaultTaintRules(language));
    return { graph: { file, nodes: mod.nodes, edges, language } };
  } finally {
    tree.delete();
  }
}
