import { describe, it, expect } from "vitest";
import { loadSource } from "../parser/parser.js";
import { buildIR } from "../ir/builder.js";
import { buildInterproc } from "./interproc.js";
import type { IRNode } from "../ir/types.js";

function interOf(code: string, file = "t.ts") {
  const mod = buildIR(loadSource(code, file));
  return { mod, edges: buildInterproc(mod) };
}

function nodeByName(nodes: IRNode[], kind: IRNode["kind"], name: string) {
  return nodes.find((n) => n.kind === kind && n.name === name)!;
}

describe("buildInterproc — BINDS_TO (argumento -> parámetro)", () => {
  it("argumento identificador liga con el parámetro de igual índice", () => {
    const { mod, edges } = interOf(
      `function sink(q){ db.query(q); } function h(name){ sink(name); }`,
    );

    const binds = edges.filter((e) => e.kind === "BINDS_TO");
    const argName = nodeByName(mod.nodes, "Parameter", "name");
    const paramQ = nodeByName(mod.nodes, "Parameter", "q");

    expect(binds).toContainEqual({
      kind: "BINDS_TO",
      from: argName.id,
      to: paramQ.id,
    });
  });

  it("argumento compuesto liga por la raíz del identificador", () => {
    const { mod, edges } = interOf(
      `function sink(q){ db.query(q); } function h(name){ sink(name + 1); }`,
    );
    const argName = nodeByName(mod.nodes, "Parameter", "name");
    const paramQ = nodeByName(mod.nodes, "Parameter", "q");
    expect(edges).toContainEqual({
      kind: "BINDS_TO",
      from: argName.id,
      to: paramQ.id,
    });
  });

  it("argumento sin identificadores no liga", () => {
    const { edges } = interOf(
      `function sink(q){ db.query(q); } function h(){ sink("a" + "b"); }`,
    );
    expect(edges.filter((e) => e.kind === "BINDS_TO")).toHaveLength(0);
  });

  it("argumento sin def declarada no liga", () => {
    const { edges } = interOf(
      `function sink(q){ db.query(q); } function h(){ sink(otro); }`,
    );
    expect(edges.filter((e) => e.kind === "BINDS_TO")).toHaveLength(0);
  });

  it("llamada a función no declarada (miembro) no liga", () => {
    const { edges } = interOf(`function h(name){ db.query(name); }`);
    expect(edges.filter((e) => e.kind === "BINDS_TO")).toHaveLength(0);
  });
});

describe("buildInterproc — RETURNS (valor retornado -> llamada)", () => {
  it("lo que la función retorna llega al nodo de cada llamada", () => {
    const { mod, edges } = interOf(
      `function src(){ const x = 1; return x; } function h(){ const a = src(); const b = src(); }`,
    );
    const varX = nodeByName(mod.nodes, "Variable", "x");
    const calls = mod.nodes.filter((n) => n.kind === "Call" && n.name === "src");
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(edges).toContainEqual({ kind: "RETURNS", from: varX.id, to: call.id });
    }
  });

  it("retornar un parámetro liga el parámetro con la llamada", () => {
    const { mod, edges } = interOf(`function id(p){ return p; } function h(v){ return id(v); }`);
    const paramP = nodeByName(mod.nodes, "Parameter", "p");
    const call = nodeByName(mod.nodes, "Call", "id");
    expect(edges).toContainEqual({ kind: "RETURNS", from: paramP.id, to: call.id });
  });

  it("una función que nadie llama no genera RETURNS", () => {
    const { edges } = interOf(`function id(p){ return p; }`);
    expect(edges.filter((e) => e.kind === "RETURNS")).toHaveLength(0);
  });

  it("retorno literal no genera RETURNS", () => {
    const { edges } = interOf(`function f(){ return 1; } function h(){ f(); }`);
    expect(edges.filter((e) => e.kind === "RETURNS")).toHaveLength(0);
  });

  it("función sin return no genera RETURNS", () => {
    const { edges } = interOf(`function f(){ const x = 1; } function h(){ f(); }`);
    expect(edges.filter((e) => e.kind === "RETURNS")).toHaveLength(0);
  });
});
