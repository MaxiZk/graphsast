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
