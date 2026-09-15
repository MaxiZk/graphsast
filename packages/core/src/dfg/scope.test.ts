import { describe, it, expect } from "vitest";
import { loadSource } from "../parser/parser.js";
import { buildIR } from "../ir/builder.js";
import { buildDataFlow } from "./dataflow.js";
import { scopeEncloses } from "./scope.js";
import { analyzeGraph } from "../index.js";
import { analyzeTaint } from "../taint/analyzer.js";
import type { IRNode, IRVariable, IRCall } from "../ir/types.js";

function dfgOf(code: string, file = "t.ts") {
  const mod = buildIR(loadSource(code, file));
  return { mod, edges: buildDataFlow(mod) };
}

function varsNamed(nodes: IRNode[], name: string): IRVariable[] {
  return nodes.filter((n): n is IRVariable => n.kind === "Variable" && n.name === name);
}

function callAt(nodes: IRNode[], line: number): IRCall {
  return nodes.find((n): n is IRCall => n.kind === "Call" && n.loc.line === line)!;
}

/**
 * Regresión: antes el único discriminante de ámbito era la función
 * contenedora, así que N declaraciones del mismo nombre en bloques hermanos
 * se fusionaban en un solo binding y generaban N×M aristas espurias.
 */
describe("ámbito de bloque — regresión de fusión de bindings", () => {
  const switchCode = `
function handler(req, res) {
  switch (req.query.mode) {
    case 'a': {
      const x = "constante-segura";
      res.send(x);
      break;
    }
    case 'b': {
      const x = req.query.evil;
      console.log(x);
      break;
    }
  }
}
`;

  it("dos `const x` en `case` hermanos no se ven entre sí", () => {
    const { mod, edges } = dfgOf(switchCode);
    const [xA, xB] = varsNamed(mod.nodes, "x");
    expect(xA).toBeDefined();
    expect(xB).toBeDefined();

    const send = callAt(mod.nodes, 6);
    const log = callAt(mod.nodes, 11);

    expect(edges).toContainEqual({ kind: "FLOWS_TO", from: xA.id, to: send.id });
    expect(edges).toContainEqual({ kind: "FLOWS_TO", from: xB.id, to: log.id });

    // Los cruces entre bloques hermanos son inalcanzables en ejecución.
    expect(edges).not.toContainEqual({ kind: "FLOWS_TO", from: xB.id, to: send.id });
    expect(edges).not.toContainEqual({ kind: "FLOWS_TO", from: xA.id, to: log.id });
  });

  it("no reporta el XSS falso que cruzaba de un `case` al otro", () => {
    const graph = analyzeGraph(switchCode, "t.ts");
    expect(analyzeTaint(graph)).toEqual([]);
  });

  it("una def de bloque no alcanza usos del bloque hermano en un `if`", () => {
    const { mod, edges } = dfgOf(`
function f(req, res) {
  if (req.flag) {
    const v = "seguro";
    res.send(v);
  } else {
    const v = req.query.evil;
    sink(v);
  }
}
`);
    const [vThen, vElse] = varsNamed(mod.nodes, "v");
    const send = callAt(mod.nodes, 5);
    expect(edges).toContainEqual({ kind: "FLOWS_TO", from: vThen.id, to: send.id });
    expect(edges).not.toContainEqual({ kind: "FLOWS_TO", from: vElse.id, to: send.id });
  });
});

describe("ámbito de bloque — casos que deben seguir conectando", () => {
  it("una def externa alcanza usos en un bloque anidado", () => {
    const { mod, edges } = dfgOf(`
function f(req) {
  const q = req.query.id;
  if (req.flag) {
    db.query(q);
  }
}
`);
    const [q] = varsNamed(mod.nodes, "q");
    const call = callAt(mod.nodes, 5);
    expect(edges).toContainEqual({ kind: "FLOWS_TO", from: q.id, to: call.id });
  });

  it("`var` se iza al ámbito de función y alcanza usos fuera de su bloque", () => {
    const { mod, edges } = dfgOf(`
function f(req) {
  if (req.flag) {
    var v = req.query.evil;
  }
  db.query(v);
}
`);
    const [v] = varsNamed(mod.nodes, "v");
    const call = callAt(mod.nodes, 6);
    expect(edges).toContainEqual({ kind: "FLOWS_TO", from: v.id, to: call.id });
  });

  it("un parámetro alcanza usos en cualquier bloque de su función", () => {
    const { mod, edges } = dfgOf(`
function f(req) {
  while (true) {
    { db.query(req.body); }
  }
}
`);
    const param = mod.nodes.find((n) => n.kind === "Parameter" && n.name === "req")!;
    const call = callAt(mod.nodes, 4);
    expect(edges).toContainEqual({ kind: "FLOWS_TO", from: param.id, to: call.id });
  });

  /**
   * Limitación preexistente, no introducida por el ámbito de bloque: el
   * filtro por función contenedora corta la captura de un closure sobre la
   * variable de su función envolvente. Verificado idéntico con y sin
   * `scopePath`. Queda como test de constancia: si algún día se resuelve
   * (BINDS_TO inter-procedural), este test falla y hay que actualizarlo.
   */
  it("closure sobre variable externa: no conecta (limitación conocida)", () => {
    const { mod, edges } = dfgOf(`
function f(req) {
  const q = req.query.id;
  run(() => { db.query(q); });
}
`);
    const [q] = varsNamed(mod.nodes, "q");
    const call = mod.nodes.find(
      (n): n is IRCall => n.kind === "Call" && n.callee === "db.query",
    )!;
    expect(edges).not.toContainEqual({ kind: "FLOWS_TO", from: q.id, to: call.id });
  });

  it("el taint real dentro de un mismo bloque se sigue detectando", () => {
    const graph = analyzeGraph(`
function handler(req, res) {
  switch (req.query.mode) {
    case 'b': {
      const x = req.query.evil;
      res.send(x);
      break;
    }
  }
}
`, "t.ts");
    expect(analyzeTaint(graph).length).toBeGreaterThan(0);
  });
});

describe("scopeEncloses", () => {
  it("prefijo propio: la def externa encierra al uso interno", () => {
    expect(scopeEncloses(["S0", "S1"], ["S0", "S1", "S2"])).toBe(true);
  });
  it("mismo ámbito", () => {
    expect(scopeEncloses(["S0", "S1"], ["S0", "S1"])).toBe(true);
  });
  it("hermanos: divergen en el último segmento", () => {
    expect(scopeEncloses(["S0", "S1"], ["S0", "S2"])).toBe(false);
  });
  it("la def está más adentro que el uso", () => {
    expect(scopeEncloses(["S0", "S1", "S2"], ["S0", "S1"])).toBe(false);
  });
  it("sin info de ámbito no filtra (degrada a la sobre-aproximación previa)", () => {
    expect(scopeEncloses([], ["S0", "S1"])).toBe(true);
  });
});
