import type { IRCall, IREdge, IRGraph, IRNode } from "../ir/types.js";
import { cweForSinkNode } from "../catalog/rules.js";
import { defaultTaintRules } from "./rules.js";
import { findPath } from "./reach.js";
import type { TaintConfig, TaintFinding, TaintRoles, TaintRule } from "./types.js";

function nodesMatching(rules: TaintRule[], kind: TaintRule["kind"], nodes: IRNode[]) {
  const matchers = rules.filter((r) => r.kind === kind);
  return nodes.filter((n) => matchers.some((r) => r.match(n)));
}

/** Parámetros alimentados por BINDS_TO no son entradas raíz del programa. */
function rootSources(graph: IRGraph, sources: IRNode[]): IRNode[] {
  const boundParams = new Set(
    graph.edges.filter((e) => e.kind === "BINDS_TO").map((e) => e.to),
  );
  return sources.filter(
    (n) => n.kind !== "Parameter" || !boundParams.has(n.id),
  );
}

/** Cómo participa cada nodo en el taint, según las reglas. */
export interface TaintAnnotations {
  /**
   * Sinks: CWE de la primera regla que los reconoce, argumentos peligrosos y
   * largo máximo del camino si la familia lo fija.
   */
  sinks: Map<string, {
    cwe?: number;
    args?: readonly number[];
    maxDepth?: number;
    /** Solo cuentan caminos desde una entrada del catálogo (`catalogSourceIds`). */
    catalogSourceOnly?: boolean;
  }>;
  /**
   * Nodos que son entrada según el catálogo (`req`, `@Body()`…), para los
   * sinks con `catalogSourceOnly`. Vacío si ninguna familia lo pide.
   */
  catalogSourceIds: Set<string>;
  /**
   * Sanitizers: CWE de cada regla que los reconoce (`undefined` = regla sin
   * CWE, vale para todos los sinks).
   */
  sanitizers: Map<string, (number | undefined)[]>;
}

/**
 * Las decisiones del motor que no dependen del recorrido: qué sinks hay, con
 * qué CWE y por qué argumentos, y para qué CWE vale cada sanitizer. Las usan
 * el motor en memoria y el de Neo4j (que las persiste como propiedades), así
 * los dos aplican las mismas reglas.
 */
export function annotateTaint(graph: IRGraph, rules: TaintRule[]): TaintAnnotations {
  const sinkRules = rules.filter((r) => r.kind === "sink");
  const sanitizerRules = rules.filter((r) => r.kind === "sanitizer");
  const sinks: TaintAnnotations["sinks"] = new Map();
  const sanitizers: TaintAnnotations["sanitizers"] = new Map();
  // Todas las familias que restringen las entradas usan el mismo criterio
  // (las entradas del catálogo): alcanza con el filtro de cualquiera.
  const sourceFilter = sinkRules.find((r) => r.sourceFilter)?.sourceFilter;
  const catalogSourceIds = new Set<string>();
  for (const node of graph.nodes) {
    const sink = sinkRules.find((r) => r.match(node));
    if (sink) {
      sinks.set(node.id, {
        cwe: sink.cwe,
        ...(sink.args ? { args: sink.args } : {}),
        ...(sink.maxDepth !== undefined ? { maxDepth: sink.maxDepth } : {}),
        ...(sink.sourceFilter ? { catalogSourceOnly: true } : {}),
      });
    }
    const cwes = sanitizerRules.filter((r) => r.match(node)).map((r) => r.cwe);
    if (cwes.length > 0) sanitizers.set(node.id, cwes);
    if (sourceFilter?.(node)) catalogSourceIds.add(node.id);
  }
  return { sinks, sanitizers, catalogSourceIds };
}

/**
 * ¿El sanitizer protege a un sink de esta CWE? Sí si alguna de sus reglas es
 * de esa CWE o no declara CWE; un sink sin CWE se protege con cualquiera.
 * `escape` para SQL no protege un sink XSS, ni `String(x)` —que neutraliza
 * operadores de MongoDB— una consulta SQL.
 */
export function sanitizerApplies(
  sanitizerCwes: readonly (number | undefined)[],
  sinkCwe: number | undefined,
): boolean {
  if (sinkCwe === undefined) return true;
  return sanitizerCwes.some((c) => c === undefined || c === sinkCwe);
}

/**
 * Sanitizers a excluir del recorrido para un par (source, sink). Los extremos
 * nunca se bloquean: un nodo puede ser sink y sanitizer a la vez.
 */
function blockedFor(
  annotations: TaintAnnotations,
  sinkCwe: number | undefined,
  sourceId: string,
  sinkId: string,
): Set<string> {
  const blocked = new Set<string>();
  for (const [id, cwes] of annotations.sanitizers) {
    if (id !== sourceId && id !== sinkId && sanitizerApplies(cwes, sinkCwe)) blocked.add(id);
  }
  return blocked;
}

/**
 * Por dónde puede entrar el dato al sink. Si la regla del sink restringe los
 * argumentos (`db.query(sql, [id])` → solo `sql`), solo cuentan los
 * `FLOWS_TO` de esas posiciones; sin restricción, cualquier arista.
 */
export function entersSink(args: readonly number[] | undefined): (edge: IREdge) => boolean {
  if (!args) return () => true;
  return (edge) =>
    (edge.kind === "FLOWS_TO" || edge.kind === "SANITIZED_BY")
    && edge.arg !== undefined
    && args.includes(edge.arg);
}

/**
 * Detecta caminos source → sink sin sanitizer intermedio sobre el grafo IR.
 *
 * Los sanitizers se **quitan del grafo** antes de buscar el camino, de modo
 * que todo camino hallado es por construcción no sanitizado. Inspeccionar un
 * único camino más corto a posteriori era incorrecto: un sanitizer sobre el
 * camino corto suprimía hallazgos alcanzables por otra ruta.
 */
export function analyzeTaint(
  graph: IRGraph,
  config: TaintConfig = {},
): TaintFinding[] {
  const rules = config.rules ?? defaultTaintRules(graph.language);
  const sources = rootSources(
    graph,
    nodesMatching(rules, "source", graph.nodes),
  );
  const annotations = annotateTaint(graph, rules);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  const findings: TaintFinding[] = [];

  for (const [sinkId, spec] of annotations.sinks) {
    const sink = byId.get(sinkId)!;
    const enters = entersSink(spec.args);
    const reachConfig = {
      maxDepth: config.maxDepth ?? spec.maxDepth,
      propagateEdges: config.propagateEdges,
    };
    const allowed = spec.catalogSourceOnly
      ? sources.filter((s) => annotations.catalogSourceIds.has(s.id))
      : sources;
    for (const source of allowed) {
      const path = findPath(
        graph,
        source.id,
        sink.id,
        reachConfig,
        blockedFor(annotations, spec.cwe, source.id, sink.id),
        enters,
      );
      if (!path) continue;

      findings.push({
        sourceId: source.id,
        sinkId: sink.id,
        path,
        sanitized: false,
        ...enrichFinding(sink, rules),
      });
    }
  }

  return dedupeFindings(findings);
}

function enrichFinding(
  sink: IRNode,
  rules: TaintRule[],
): Pick<TaintFinding, "cwe" | "cweName" | "ruleId"> {
  if (sink.kind !== "Call") return {};
  return cweForSinkNode(rules, sink as IRCall);
}

function dedupeFindings(findings: TaintFinding[]): TaintFinding[] {
  const seen = new Set<string>();
  const out: TaintFinding[] = [];
  for (const f of findings) {
    const key = `${f.sinkId}\t${f.path.join("\t")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Marca nodos source/sink/sanitizer aunque no haya camino (para visualización). */
export function getTaintRoles(
  graph: IRGraph,
  config: TaintConfig = {},
): TaintRoles {
  const rules = config.rules ?? defaultTaintRules(graph.language);
  const sources = rootSources(
    graph,
    nodesMatching(rules, "source", graph.nodes),
  );
  const sinks = nodesMatching(rules, "sink", graph.nodes);
  const sanitizers = nodesMatching(rules, "sanitizer", graph.nodes);
  return {
    sourceIds: sources.map((n) => n.id),
    sinkIds: sinks.map((n) => n.id),
    sanitizerIds: sanitizers.map((n) => n.id),
  };
}
