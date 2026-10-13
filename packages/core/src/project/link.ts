import type { IRCall, IREdge, IRFunction, IRGraph, IRNode } from "../ir/types.js";
import { buildDefIndex } from "../dfg/dataflow.js";
import { callSiteEdges } from "../dfg/interproc.js";
import { FunctionIndex, normalizeCallee } from "../cfg/resolve.js";
import { isExternalReceiver, resolveImportedCallee, type ProjectIndex } from "./links.js";

export interface ProjectFile {
  abs: string;
  graph: IRGraph;
}

export interface CrossModuleLinks {
  /** `CALLS`, `BINDS_TO` y `RETURNS` entre archivos, iguales a los de `buildInterproc`. */
  edges: IREdge[];
  /**
   * Llamadas resueltas con certeza a una función de otro archivo. Al unir los
   * grafos se les quitan los `FLOWS_TO` argumento → llamada: el valor sale de
   * lo que la función retorna (ver `buildDataFlow`).
   */
  exactCallIds: Set<string>;
  /** Llamadas resueltas a una función de otro archivo. */
  calls: number;
  /** Pares de archivos (ruta absoluta) unidos por al menos una llamada. */
  pairs: [string, string][];
}

/**
 * Aristas inter-procedurales entre archivos: cada llamada a una función de otro
 * archivo liga la llamada con la función (`CALLS`), cada argumento con el
 * parámetro de la misma posición (`BINDS_TO`) y lo que la función retorna con
 * la llamada (`RETURNS`). Es lo que `buildInterproc` hace dentro de un archivo.
 *
 * Una llamada se resuelve por el import que la nombra (con certeza) o, si es
 * un método sobre un receptor desconocido que no se resolvió dentro de su
 * archivo, por el único método con ese nombre en todo el escaneo (heurística,
 * ver `FunctionIndex.resolve`).
 */
export function buildCrossModuleEdges(
  index: ProjectIndex,
  files: ProjectFile[],
): CrossModuleLinks {
  const fnById = new Map<string, IRFunction>();
  const fileOfFn = new Map<string, string>();
  const allNodes: IRNode[] = [];
  const defsOfFile = new Map<string, Map<string, IRNode[]>>();
  for (const f of files) {
    // buildDefIndex solo mira los nodos.
    defsOfFile.set(f.abs, buildDefIndex({ file: f.graph.file, nodes: f.graph.nodes, assignments: [] }));
    for (const node of f.graph.nodes) {
      if (node.kind !== "Function") continue;
      allNodes.push(node);
      fnById.set(node.id, node as IRFunction);
      fileOfFn.set(node.id, f.abs);
    }
  }
  const projectFunctions = new FunctionIndex(allNodes);

  const edges: IREdge[] = [];
  const exactCallIds = new Set<string>();
  const pairs = new Map<string, [string, string]>();
  let calls = 0;

  for (const f of files) {
    const callerDefs = defsOfFile.get(f.abs)!;
    for (const node of f.graph.nodes) {
      if (node.kind !== "Call") continue;
      const call = node as IRCall;
      const { fn, exact } = crossFileTarget(index, f.abs, call, projectFunctions, fnById);
      const target = fn ? fileOfFn.get(fn.id) : undefined;
      if (!fn || !target || target === f.abs) continue;

      calls++;
      if (exact) exactCallIds.add(call.id);
      call.resolution = exact ? "exact" : "guess";
      edges.push({ kind: "CALLS", from: call.id, to: fn.id });
      edges.push(...callSiteEdges(call, fn, callerDefs, defsOfFile.get(target)!));
      pairs.set(`${f.abs}\0${target}`, [f.abs, target]);
    }
  }

  return { edges, exactCallIds, calls, pairs: [...pairs.values()] };
}

/** Función de otro archivo a la que apunta una llamada, si la hay. */
function crossFileTarget(
  index: ProjectIndex,
  abs: string,
  call: IRCall,
  projectFunctions: FunctionIndex,
  fnById: ReadonlyMap<string, IRFunction>,
): { fn?: IRFunction; exact: boolean } {
  const imported = resolveImportedCallee(index, abs, call.callee);
  if (imported) return { fn: fnById.get(imported), exact: true };

  // Ya resuelta dentro de su archivo, o método de un paquete: no se adivina.
  if (call.resolution || isExternalReceiver(index, abs, call.callee)) return { exact: false };
  const callee = normalizeCallee(call.callee);
  const dot = callee.lastIndexOf(".");
  if (dot === -1) return { exact: false };
  const [only] = projectFunctions.uniqueMember(callee.slice(dot + 1));
  return { fn: only, exact: false };
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
