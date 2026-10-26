import type { FlowRef, IRCall, IREdge, IRFunction, IRModule, IRNode, IRVariable } from "../ir/types.js";
import { resolveCalls } from "../cfg/callgraph.js";
import { defsInScope, nodeOwnerFnId, nodeScopePath } from "./scope.js";

/**
 * Métodos que guardan sus argumentos en el objeto sobre el que se llaman:
 * colecciones (`add`, `put`, `push`, `extend`) y armado de texto (`append`).
 * Se dejan afuera los nombres que también usan las bibliotecas de base de
 * datos o HTTP con otro sentido (`update`, `insert`, `set`).
 */
const MUTATORS = new Set([
  "add", "addAll", "addElement", "addFirst", "addLast", "offer", "offerFirst", "offerLast",
  "put", "putAll", "putIfAbsent", "push", "unshift", "append", "extend", "appendleft",
]);

function isMutator(call: IRCall): boolean {
  const dot = call.callee.lastIndexOf(".");
  return dot > 0 && MUTATORS.has(call.callee.slice(dot + 1));
}

const STRING_KEY = /^(["'])[^"'\\]*\1$/;
const KEYED_PUTS = new Set(["put", "putIfAbsent"]);
const KEYED_READS = new Set(["get", "getOrDefault", "containsKey", "remove"]);

/** Nombre de la variable sobre la que se llama el método, si es una sola. */
function simpleReceiver(call: IRCall): string | undefined {
  const { names, callIds } = call.receiverFlow;
  return names.length === 1 && callIds.length === 0 ? names[0] : undefined;
}

function methodOf(call: IRCall): string {
  return call.callee.slice(call.callee.lastIndexOf(".") + 1);
}

/**
 * Mapas que solo se usan con claves literales: `m.put("a", x)` y
 * `m.get("a")`. Ahí el valor sale por la lectura de la misma clave, no por
 * el mapa entero: `m.put("b", dato); m.get("a")` no trae el dato. Si el mapa
 * aparece de cualquier otra forma (se pasa a una función, se recorre, se lee
 * con una clave variable), se lo trata entero, como cualquier colección.
 */
function keyedMaps(mod: IRModule, callsById: ReadonlyMap<string, IRCall>): Map<string, { puts: IRCall[]; gets: IRCall[] }> {
  const maps = new Map<string, { puts: IRCall[]; gets: IRCall[] }>();
  const keyedUses = new Set<IRCall>();
  for (const call of callsById.values()) {
    const name = simpleReceiver(call);
    const method = methodOf(call);
    if (!name || !STRING_KEY.test(call.argTexts[0] ?? "")) continue;
    if (!KEYED_PUTS.has(method) && !KEYED_READS.has(method)) continue;
    const entry = maps.get(name) ?? { puts: [], gets: [] };
    (KEYED_PUTS.has(method) ? entry.puts : entry.gets).push(call);
    maps.set(name, entry);
    keyedUses.add(call);
  }
  // Cualquier otra aparición del nombre lo descarta.
  const discard = (flow: FlowRef | undefined, except?: IRCall) => {
    for (const name of flow?.names ?? []) if (maps.has(name) && !(except && keyedUses.has(except))) maps.delete(name);
  };
  for (const node of mod.nodes) {
    if (node.kind === "Call") {
      const call = node as IRCall;
      call.argFlows.forEach((f) => discard(f));
      discard(call.receiverFlow, call);
    } else if (node.kind === "Variable") {
      discard((node as IRVariable).initFlow);
    } else if (node.kind === "Function") {
      (node as IRFunction).returnFlows?.forEach((f) => discard(f));
    }
  }
  for (const assign of mod.assignments) discard(assign.flow);
  for (const [name, entry] of maps) if (entry.puts.length === 0) maps.delete(name);
  return maps;
}

/** Índice de definiciones (variables y parámetros) por nombre. */
export function buildDefIndex(mod: IRModule): Map<string, IRNode[]> {
  const defsByName = new Map<string, IRNode[]>();
  for (const node of mod.nodes) {
    if (node.kind !== "Variable" && node.kind !== "Parameter") continue;
    const list = defsByName.get(node.name);
    if (list) list.push(node);
    else defsByName.set(node.name, [node]);
  }
  return defsByName;
}

/**
 * Ids que alimentan una referencia de flujo dentro de un ámbito:
 * defs de los identificadores raíz + nodos Call cuyo retorno se consume.
 */
export function flowInputIds(
  flow: FlowRef,
  scope: string | null,
  defsByName: Map<string, IRNode[]>,
  scopePath?: string[],
): string[] {
  const out: string[] = [];
  for (const name of flow.names) {
    const from = flow.reachingFrom?.[name];
    for (const def of defsInScope(defsByName.get(name) ?? [], scope, scopePath)) {
      if (from && (def.loc.line < from[0] || (def.loc.line === from[0] && def.loc.col < from[1]))) continue;
      out.push(def.id);
    }
  }
  out.push(...flow.callIds);
  return out;
}

/**
 * Construye el data-flow graph intra-procedural (aristas `FLOWS_TO`).
 * Las defs solo conectan con usos dentro de la misma función.
 *
 * `exactCallIds` son las llamadas que se resolvieron con certeza a una función
 * del código analizado. En ellas los argumentos no fluyen directo al nodo
 * Call: entran a la función por `BINDS_TO` y el valor de la llamada sale de lo
 * que la función retorna (`RETURNS`, ver `buildInterproc`). Así lo que la
 * función hace con el dato —sanearlo, descartarlo— decide si el resultado
 * sigue contaminado. En una llamada que no se resuelve (una biblioteca, un
 * sink) el valor de retorno se aproxima por sus argumentos y su receptor.
 */
export function buildDataFlow(
  mod: IRModule,
  exactCallIds: ReadonlySet<string> = resolveCalls(mod).exactCallIds,
): IREdge[] {
  const defsByName = buildDefIndex(mod);
  const edges: IREdge[] = [];
  const seen = new Set<string>();

  const link = (from: string, to: string, arg?: number): void => {
    if (from === to) return;
    const key = `${from}\t${to}\t${arg ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(arg === undefined ? { kind: "FLOWS_TO", from, to } : { kind: "FLOWS_TO", from, to, arg });
  };

  const linkFlow = (
    flow: FlowRef,
    to: string,
    scope: string | null,
    scopePath?: string[],
    arg?: number,
  ): void => {
    for (const from of flowInputIds(flow, scope, defsByName, scopePath)) link(from, to, arg);
  };

  // Argumentos y receptor de cada llamada fluyen al nodo Call. La arista
  // recuerda por qué argumento entra (-1: receptor), para los sinks que solo
  // son peligrosos en algunos (`db.query(sql, [id])`).
  for (const node of mod.nodes) {
    if (node.kind !== "Call" || exactCallIds.has(node.id)) continue;
    const scope = nodeOwnerFnId(node);
    const path = nodeScopePath(node);
    node.argFlows.forEach((flow, i) => linkFlow(flow, node.id, scope, path, i));
    linkFlow(node.receiverFlow, node.id, scope, path, -1);
  }

  // `lista.add(x)`, `sb.append(x)`: el método guarda el dato en el objeto, y
  // lo que se lea después de la variable lo trae. La llamada (que ya recibe
  // los argumentos) alimenta las defs del receptor, también a través de una
  // cadena `sb.append(a).append(b)`.
  const callsById = new Map<string, IRCall>();
  for (const node of mod.nodes) if (node.kind === "Call") callsById.set(node.id, node as IRCall);
  const keyed = keyedMaps(mod, callsById);
  for (const { puts, gets } of keyed.values()) {
    for (const put of puts) {
      for (const get of gets) if (get.argTexts[0] === put.argTexts[0]) link(put.id, get.id);
    }
  }
  for (const call of callsById.values()) {
    if (exactCallIds.has(call.id) || !(isMutator(call) || call.callee === "array_push")) continue;
    if (keyed.has(simpleReceiver(call) ?? "")) continue;
    // `array_push($lista, $x)` de PHP: la lista es el primer argumento.
    let receiver: FlowRef = call.callee === "array_push" ? call.argFlows[0] ?? call.receiverFlow : call.receiverFlow;
    for (let hops = 0; receiver.names.length === 0 && receiver.callIds.length === 1 && hops < 32; hops++) {
      const inner = callsById.get(receiver.callIds[0]!);
      if (!inner || exactCallIds.has(inner.id) || !isMutator(inner)) break;
      receiver = inner.receiverFlow;
    }
    if (receiver.names.length !== 1 || receiver.callIds.length > 0) continue;
    const target = receiver.names[0]!;
    for (const def of defsInScope(defsByName.get(target) ?? [], call.ownerFnId, nodeScopePath(call))) {
      link(call.id, def.id);
    }
  }

  // El inicializador fluye a la variable declarada.
  for (const node of mod.nodes) {
    if (node.kind !== "Variable") continue;
    linkFlow(node.initFlow, node.id, nodeOwnerFnId(node), nodeScopePath(node));
  }

  // `q = expr` alimenta la def existente de `q` en el mismo ámbito.
  for (const assign of mod.assignments) {
    const defs = defsInScope(
      defsByName.get(assign.target) ?? [],
      assign.ownerFnId,
      assign.scopePath,
    );
    for (const def of defs) {
      linkFlow(assign.flow, def.id, assign.ownerFnId, assign.scopePath);
    }
  }

  return edges;
}
