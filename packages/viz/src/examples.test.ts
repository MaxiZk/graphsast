import { describe, it, expect } from "vitest";
import { analyzeGraph, analyzeTaint, getTaintRoles } from "@graphsast/core";
import { DEFAULT_EXAMPLE_ID, DEMO_EXAMPLES, getExample } from "./examples.js";

function analyze(code: string) {
  const graph = analyzeGraph(code, "demo.ts");
  return { graph, findings: analyzeTaint(graph), roles: getTaintRoles(graph) };
}

describe("ejemplos de la demo", () => {
  it.each(DEMO_EXAMPLES.map((e) => [e.id, e] as const))(
    "%s: el motor coincide con expectFinding y con la familia CWE",
    (_id, ex) => {
      const { findings, roles } = analyze(ex.code);
      expect(findings.length > 0).toBe(ex.expectFinding);
      if (ex.expectFinding) {
        expect(findings.every((f) => f.cwe === ex.cwe)).toBe(true);
      } else {
        // Corregido no es «sin nada que evaluar»: el sink sigue ahí y el
        // camino se corta.
        expect(roles.sinkIds.length).toBeGreaterThan(0);
      }
    },
  );

  it("el ejemplo por defecto es una vulnerabilidad", () => {
    expect(getExample(DEFAULT_EXAMPLE_ID).expectFinding).toBe(true);
  });

  it("el ejemplo entre funciones cruza al menos dos funciones", () => {
    const { graph, findings } = analyze(getExample("vulnerable").code);
    const owners = new Set(
      findings[0]!.path
        .map((id) => graph.nodes.find((n) => n.id === id))
        .map((n) => (n && "ownerFnId" in n ? n.ownerFnId : null))
        .filter(Boolean),
    );
    expect(owners.size).toBeGreaterThanOrEqual(2);
  });
});

describe("pares vulnerable / corregido", () => {
  const pairs = DEMO_EXAMPLES.filter((e) => e.expectFinding && e.pair);

  it.each(pairs.map((e) => [e.id, e.pair!] as const))(
    "%s y %s: el par es recíproco, de la misma familia, y difiere en una línea",
    (vulnId, fixedId) => {
      const vuln = getExample(vulnId);
      const fixed = getExample(fixedId);
      expect(fixed.id).toBe(fixedId);
      expect(fixed.pair).toBe(vulnId);
      expect(fixed.expectFinding).toBe(false);
      expect(fixed.cwe).toBe(vuln.cwe);
      const a = vuln.code.split("\n");
      const b = fixed.code.split("\n");
      expect(a).toHaveLength(b.length);
      expect(a.filter((line, i) => line !== b[i])).toHaveLength(1);
    },
  );

  it("cubre las seis familias del catálogo", () => {
    expect(new Set(DEMO_EXAMPLES.filter((e) => e.expectFinding).map((e) => e.cwe))).toEqual(
      new Set([89, 79, 943, 78, 22, 95]),
    );
  });

  it("la versión sanitizada entre funciones corta el camino con una arista SANITIZED_BY", () => {
    const { graph, findings } = analyze(getExample("sanitized").code);
    expect(findings).toHaveLength(0);
    expect(graph.edges.some((e) => e.kind === "SANITIZED_BY")).toBe(true);
  });
});
