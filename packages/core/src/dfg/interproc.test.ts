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

  it("argumento que no es identificador simple no liga", () => {
    const { edges } = interOf(
      `function sink(q){ db.query(q); } function h(name){ sink(name + 1); }`,
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

describe("buildInterproc — RETURNS (función -> def retornada)", () => {
  it("retorno de un identificador liga la función con su def", () => {
    const { mod, edges } = interOf(`function src(){ const x = 1; return x; }`);

    const fn = nodeByName(mod.nodes, "Function", "src");
    const varX = nodeByName(mod.nodes, "Variable", "x");

    expect(edges).toContainEqual({
      kind: "RETURNS",
      from: fn.id,
      to: varX.id,
    });
  });

  it("retorno de parámetro liga la función con el parámetro", () => {
    const { mod, edges } = interOf(`function id(p){ return p; }`);

    const fn = nodeByName(mod.nodes, "Function", "id");
    const paramP = nodeByName(mod.nodes, "Parameter", "p");

    expect(edges).toContainEqual({
      kind: "RETURNS",
      from: fn.id,
      to: paramP.id,
    });
  });

  it("retorno literal no genera RETURNS", () => {
    const { edges } = interOf(`function f(){ return 1; }`);
    expect(edges.filter((e) => e.kind === "RETURNS")).toHaveLength(0);
  });

  it("función sin return no genera RETURNS", () => {
    const { edges } = interOf(`function f(){ const x = 1; }`);
    expect(edges.filter((e) => e.kind === "RETURNS")).toHaveLength(0);
  });
});
