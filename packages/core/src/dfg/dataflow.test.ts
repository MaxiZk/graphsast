import { describe, it, expect } from "vitest";
import { loadSource } from "../parser/parser.js";
import { buildIR } from "../ir/builder.js";
import { buildDataFlow } from "./dataflow.js";
import type { IRNode, IRCall } from "../ir/types.js";

function dfgOf(code: string, file = "t.ts") {
  const mod = buildIR(loadSource(code, file));
  return { mod, edges: buildDataFlow(mod) };
}

function nodeByName(nodes: IRNode[], kind: IRNode["kind"], name: string) {
  return nodes.find((n) => n.kind === kind && n.name === name)!;
}

describe("buildDataFlow — R1 (uso en llamada)", () => {
  it("parámetro usado como argumento fluye al Call", () => {
    const { mod, edges } = dfgOf(`function f(name) { db.query(name); }`);

    const flows = edges.filter((e) => e.kind === "FLOWS_TO");
    expect(flows).toHaveLength(1);

    const param = nodeByName(mod.nodes, "Parameter", "name");
    const call = mod.nodes.find(
      (n): n is IRCall => n.kind === "Call" && n.callee === "db.query",
    )!;
    expect(flows[0]).toEqual({ kind: "FLOWS_TO", from: param.id, to: call.id });
  });

  it("variable usada como argumento fluye al Call", () => {
    const { mod, edges } = dfgOf(`const q = 1; db.query(q);`);

    const flows = edges.filter((e) => e.kind === "FLOWS_TO");
    const variable = nodeByName(mod.nodes, "Variable", "q");
    const call = mod.nodes.find(
      (n): n is IRCall => n.kind === "Call" && n.callee === "db.query",
    )!;
    expect(flows).toContainEqual({
      kind: "FLOWS_TO",
      from: variable.id,
      to: call.id,
    });
  });

  it("argumento sin def declarada no genera arista", () => {
    const { edges } = dfgOf(`db.query(otro);`);
    expect(edges.filter((e) => e.kind === "FLOWS_TO")).toHaveLength(0);
  });

  it("argumento que no es identificador simple no genera arista", () => {
    const { edges } = dfgOf(`const x = 1; db.query(x + 1);`);
    expect(edges.filter((e) => e.kind === "FLOWS_TO")).toHaveLength(0);
  });
});

describe("buildDataFlow — R2 (uso en inicializador) + encadenado", () => {
  it("cadena param -> const -> sink produce dos aristas FLOWS_TO", () => {
    const { mod, edges } = dfgOf(
      `function f(name) { const q = name; db.query(q); }`,
    );

    const flows = edges.filter((e) => e.kind === "FLOWS_TO");
    expect(flows).toHaveLength(2);

    const param = nodeByName(mod.nodes, "Parameter", "name");
    const variable = nodeByName(mod.nodes, "Variable", "q");
    const call = mod.nodes.find(
      (n): n is IRCall => n.kind === "Call" && n.callee === "db.query",
    )!;

    // R2: name -> q
    expect(flows).toContainEqual({
      kind: "FLOWS_TO",
      from: param.id,
      to: variable.id,
    });
    // R1: q -> db.query
    expect(flows).toContainEqual({
      kind: "FLOWS_TO",
      from: variable.id,
      to: call.id,
    });
  });

  it("inicializador literal no genera arista por R2", () => {
    const { edges } = dfgOf(`const a = 1;`);
    expect(edges.filter((e) => e.kind === "FLOWS_TO")).toHaveLength(0);
  });
});

describe("buildDataFlow — R3 (retorno de llamada)", () => {
  it("`const v = callee(arg)` conecta Call → Variable", () => {
    const { mod, edges } = dfgOf(
      `function f(input) { const safe = sanitize(input); }`,
    );

    const variable = nodeByName(mod.nodes, "Variable", "safe");
    const call = mod.nodes.find(
      (n): n is IRCall => n.kind === "Call" && n.callee === "sanitize",
    )!;
    const param = nodeByName(mod.nodes, "Parameter", "input");

    expect(edges).toContainEqual({
      kind: "FLOWS_TO",
      from: call.id,
      to: variable.id,
    });
    expect(edges).toContainEqual({
      kind: "FLOWS_TO",
      from: param.id,
      to: call.id,
    });
  });
});

describe("buildDataFlow — req.body (operando miembro)", () => {
  it("`const q = req.body` conecta Parameter req → Variable q", () => {
    const { mod, edges } = dfgOf(
      `function handler(req) { const q = req.body; }`,
    );
    const param = nodeByName(mod.nodes, "Parameter", "req");
    const variable = nodeByName(mod.nodes, "Variable", "q");
    expect(edges).toContainEqual({
      kind: "FLOWS_TO",
      from: param.id,
      to: variable.id,
    });
  });

  it("`db.query(req.body)` conecta Parameter req → Call", () => {
    const { mod, edges } = dfgOf(`function handler(req) { db.query(req.body); }`);
    const param = nodeByName(mod.nodes, "Parameter", "req");
    const call = mod.nodes.find(
      (n): n is IRCall => n.kind === "Call" && n.callee === "db.query",
    )!;
    expect(edges).toContainEqual({
      kind: "FLOWS_TO",
      from: param.id,
      to: call.id,
    });
  });
});
