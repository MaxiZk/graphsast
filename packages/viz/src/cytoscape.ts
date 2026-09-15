import type { IRGraph, IREdgeKind, TaintFinding, TaintRoles } from "@graphsast/core";

export interface VizOptions {
  highlight?: {
    path?: string[];
    sourceId?: string;
    sinkId?: string;
  };
  roles?: TaintRoles;
  visibleEdges?: ReadonlySet<IREdgeKind>;
  dimNonPath?: boolean;
}

export interface CytoscapeElement {
  data: {
    id: string;
    label: string;
    kind?: string;
    code?: string;
    line?: number;
    source?: string;
    target?: string;
  };
  classes?: string;
}

function nodeLabel(node: { kind: string; name: string; callee?: string }): string {
  if (node.kind === "Call") return (node as { callee: string }).callee;
  if (node.name) return `${node.kind}: ${node.name}`;
  return node.kind;
}

function pathEdgeSet(path: string[]): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    keys.add(`${path[i]!}\t${path[i + 1]!}`);
  }
  return keys;
}

export function toCytoscapeElements(
  graph: IRGraph,
  options: VizOptions = {},
): CytoscapeElement[] {
  const { highlight, roles, visibleEdges, dimNonPath } = options;
  const pathIds = new Set(highlight?.path ?? []);
  const pathEdges = highlight?.path ? pathEdgeSet(highlight.path) : new Set<string>();
  const hasHighlight = (highlight?.path?.length ?? 0) > 0;
  const sourceIds = new Set(roles?.sourceIds ?? []);
  const sinkIds = new Set(roles?.sinkIds ?? []);
  const sanitizerIds = new Set(roles?.sanitizerIds ?? []);

  const elements: CytoscapeElement[] = [];

  for (const node of graph.nodes) {
    const classes = [node.kind.toLowerCase()];
    if (sourceIds.has(node.id)) classes.push("source");
    if (sinkIds.has(node.id)) classes.push("sink");
    if (sanitizerIds.has(node.id)) classes.push("sanitizer");
    if (pathIds.has(node.id)) classes.push("risk-path");
    if (dimNonPath && hasHighlight && !pathIds.has(node.id)) {
      classes.push("dimmed");
    }

    elements.push({
      data: {
        id: node.id,
        label: nodeLabel(node),
        kind: node.kind,
        code: node.code,
        line: node.loc.line,
      },
      classes: classes.join(" "),
    });
  }

  for (const edge of graph.edges) {
    if (visibleEdges && !visibleEdges.has(edge.kind)) continue;
    const onPath = pathEdges.has(`${edge.from}\t${edge.to}`);
    const edgeKind = edge.kind.toLowerCase().replaceAll("_", "-");
    const classes = [onPath ? "risk-edge" : edgeKind];
    if (dimNonPath && hasHighlight && !onPath) classes.push("dimmed");

    elements.push({
      data: {
        id: `${edge.from}|${edge.kind}|${edge.to}`,
        source: edge.from,
        target: edge.to,
        label: edge.kind,
        kind: edge.kind,
      },
      classes: classes.join(" "),
    });
  }

  return elements;
}

export function linesOnPath(graph: IRGraph, finding?: TaintFinding): number[] {
  if (!finding) return [];
  const lines = new Set<number>();
  for (const id of finding.path) {
    const node = graph.nodes.find((n) => n.id === id);
    if (node) lines.add(node.loc.line);
  }
  return [...lines].sort((a, b) => a - b);
}
