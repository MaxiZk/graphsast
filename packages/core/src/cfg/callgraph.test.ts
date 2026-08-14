import { describe, it, expect } from "vitest";
import { loadSource } from "../parser/parser.js";
import { buildIR } from "../ir/builder.js";
import { buildCallGraph } from "./callgraph.js";
import type { IRFunction, IRCall } from "../ir/types.js";

function graphOf(code: string, file = "t.ts") {
  const mod = buildIR(loadSource(code, file));
  return { mod, edges: buildCallGraph(mod) };
}

describe("buildCallGraph", () => {
  it("resuelve una llamada a función local en una arista CALLS", () => {
    const { mod, edges } = graphOf(`
      function helper(x) { return x; }
      function main() { helper(1); }
    `);

    const calls = edges.filter((e) => e.kind === "CALLS");
    expect(calls).toHaveLength(1);

    const fn = mod.nodes.find(
      (n): n is IRFunction => n.kind === "Function" && n.name === "helper",
    )!;
    const call = mod.nodes.find(
      (n): n is IRCall => n.kind === "Call" && n.callee === "helper",
    )!;
    expect(calls[0]).toEqual({ kind: "CALLS", from: call.id, to: fn.id });
  });

  it("no genera arista para llamadas a miembro (db.query)", () => {
    const { edges } = graphOf(`function f(q) { db.query(q); }`);
    expect(edges.filter((e) => e.kind === "CALLS")).toHaveLength(0);
  });

  it("no genera arista para llamadas a nombres sin función declarada", () => {
    const { edges } = graphOf(`function f() { noExiste(1); }`);
    expect(edges.filter((e) => e.kind === "CALLS")).toHaveLength(0);
  });

  it("dos llamadas a la misma función generan dos aristas", () => {
    const { edges } = graphOf(`
      function helper(x) { return x; }
      function main() { helper(1); helper(2); }
    `);
    expect(edges.filter((e) => e.kind === "CALLS")).toHaveLength(2);
  });
});
