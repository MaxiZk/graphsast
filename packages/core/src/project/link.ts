import type { IRCall, IREdge, IRFunction, IRGraph } from "../ir/types.js";
import { buildDefIndex, flowInputIds } from "../dfg/dataflow.js";
import { nodeOwnerFnId } from "../dfg/scope.js";
import { resolveImportedCallee, type ProjectIndex } from "./links.js";

export interface ProjectFile {
  abs: string;
  graph: IRGraph;
}

export interface CrossModuleLinks {
  /** `CALLS` y `BINDS_TO` entre archivos, iguales a los de `buildInterproc`. */
  edges: IREdge[];
  /** Llamadas resueltas a una función de otro archivo. */
  calls: number;
  /** Pares de archivos (ruta absoluta) unidos por al menos una llamada. */
  pairs: [string, string][];
}

/**
 * Aristas inter-procedurales entre archivos: cada llamada a una función
 * importada liga la llamada con la función (`CALLS`) y cada argumento con el
 * parámetro de la misma posición (`BINDS_TO`). Es lo que `buildInterproc`
 * hace dentro de un archivo, con la resolución de imports en el medio.
 */
export function buildCrossModuleEdges(
  index: ProjectIndex,
  files: ProjectFile[],
): CrossModuleLinks {
  const fnById = new Map<string, IRFunction>();
  const fileOfFn = new Map<string, string>();
  for (const f of files) {
    for (const node of f.graph.nodes) {
      if (node.kind !== "Function") continue;
      fnById.set(node.id, node as IRFunction);
      fileOfFn.set(node.id, f.abs);
    }
  }

  const edges: IREdge[] = [];
  const pairs = new Map<string, [string, string]>();
  let calls = 0;

  for (const f of files) {
    // buildDefIndex solo mira los nodos.
    const defsByName = buildDefIndex({ file: f.graph.file, nodes: f.graph.nodes, assignments: [] });
    for (const node of f.graph.nodes) {
      if (node.kind !== "Call") continue;
      const call = node as IRCall;
      const fnId = resolveImportedCallee(index, f.abs, call.callee);
      const fn = fnId ? fnById.get(fnId) : undefined;
      const target = fnId ? fileOfFn.get(fnId) : undefined;
      if (!fn || !target || target === f.abs) continue;

      calls++;
      edges.push({ kind: "CALLS", from: call.id, to: fn.id });
      const scope = nodeOwnerFnId(call);
      call.argFlows.forEach((flow, i) => {
        const paramId = fn.paramIds[i];
        if (!paramId) return;
        for (const from of flowInputIds(flow, scope, defsByName)) {
          edges.push({ kind: "BINDS_TO", from, to: paramId });
        }
      });
      pairs.set(`${f.abs}\0${target}`, [f.abs, target]);
    }
  }

  return { edges, calls, pairs: [...pairs.values()] };
}

/**
 * Agrupa los archivos en componentes conexos según las llamadas entre ellos.
 * Un archivo sin llamadas a otros queda solo: se analiza igual que antes.
 */
export function connectedComponents(
  files: readonly string[],
  pairs: readonly [string, string][],
): string[][] {
  const parent = new Map(files.map((f) => [f, f]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const [a, b] of pairs) {
    if (!parent.has(a) || !parent.has(b)) continue;
    parent.set(find(a), find(b));
  }

  const groups = new Map<string, string[]>();
  for (const f of files) {
    const root = find(f);
    const list = groups.get(root);
    if (list) list.push(f);
    else groups.set(root, [f]);
  }
  return [...groups.values()];
}
