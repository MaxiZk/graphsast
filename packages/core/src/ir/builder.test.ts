import { describe, it, expect } from "vitest";
import { loadSource } from "../parser/parser.js";
import { buildIR } from "./builder.js";
import type {
  IRFunction, IRParameter, IRVariable, IRLiteral, IRCall,
} from "./types.js";

describe("buildIR — funciones y parámetros", () => {
  it("extrae una función con su nombre y ubicación", () => {
    const ir = buildIR(loadSource("function greet(name) { return name; }", "a.ts"));
    const fns = ir.nodes.filter((n): n is IRFunction => n.kind === "Function");
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe("greet");
    expect(fns[0].loc.file).toBe("a.ts");
    expect(fns[0].loc.line).toBe(1);
  });

  it("extrae los parámetros y los vincula a su función", () => {
    const ir = buildIR(loadSource("function add(a, b) { return a; }", "a.ts"));
    const fn = ir.nodes.find((n): n is IRFunction => n.kind === "Function")!;
    const params = ir.nodes.filter((n): n is IRParameter => n.kind === "Parameter");
    expect(params.map((p) => p.name)).toEqual(["a", "b"]);
    expect(params.map((p) => p.index)).toEqual([0, 1]);
    expect(params.every((p) => p.ownerFnId === fn.id)).toBe(true);
    expect(fn.paramIds).toEqual(params.map((p) => p.id));
  });
});

describe("buildIR — variables y literales", () => {
  it("extrae una variable con el texto de su inicializador", () => {
    const ir = buildIR(loadSource('const user = req.body;', "a.ts"));
    const vars = ir.nodes.filter((n): n is IRVariable => n.kind === "Variable");
    expect(vars).toHaveLength(1);
    expect(vars[0].name).toBe("user");
    expect(vars[0].initText).toBe("req.body");
  });

  it("marca initText null cuando la variable no tiene inicializador", () => {
    const ir = buildIR(loadSource("let x;", "a.ts"));
    const v = ir.nodes.find((n): n is IRVariable => n.kind === "Variable")!;
    expect(v.initText).toBeNull();
  });

  it("extrae literales de cadena con su valor", () => {
    const ir = buildIR(loadSource('const s = "hola";', "a.ts"));
    const lits = ir.nodes.filter((n): n is IRLiteral => n.kind === "Literal");
    expect(lits.map((l) => l.value)).toContain("hola");
  });
});

describe("buildIR — llamadas", () => {
  it("extrae una llamada con su callee y argumentos", () => {
    const ir = buildIR(loadSource('db.query("SELECT " + user);', "a.ts"));
    const calls = ir.nodes.filter((n): n is IRCall => n.kind === "Call");
    expect(calls).toHaveLength(1);
    expect(calls[0].callee).toBe("db.query");
    expect(calls[0].argTexts).toEqual(['"SELECT " + user']);
  });

  it("extrae múltiples llamadas en el mismo archivo", () => {
    const ir = buildIR(loadSource("f(); g(1, 2);", "a.ts"));
    const calls = ir.nodes.filter((n): n is IRCall => n.kind === "Call");
    expect(calls.map((c) => c.callee)).toEqual(["f", "g"]);
    expect(calls[1].argTexts).toEqual(["1", "2"]);
  });
});

describe("buildIR — arrow functions y callbacks Express", () => {
  it("extrae parámetros de una arrow function en app.post", () => {
    const ir = buildIR(loadSource(
      `app.post('/finances', async (req, res) => {
  const data = req.body;
  Finance.create(data);
});`,
      "routes.js",
    ));
    const params = ir.nodes.filter((n): n is IRParameter => n.kind === "Parameter");
    expect(params.map((p) => p.name)).toEqual(["req", "res"]);
    expect(params.every((p) => p.ownerFnId)).toBe(true);
  });

  it("asigna ownerFnId a variables dentro del callback", () => {
    const ir = buildIR(loadSource(
      `app.get('/x', (req, res) => { const q = req.body; });`,
      "routes.js",
    ));
    const fn = ir.nodes.find((n): n is IRFunction => n.kind === "Function" && n.name === "")!;
    const vars = ir.nodes.filter((n): n is IRVariable => n.kind === "Variable");
    expect(vars[0].ownerFnId).toBe(fn.id);
  });

  it("extrae function expressions anónimas", () => {
    const ir = buildIR(loadSource(
      `app.post('/x', function (req, res) { db.query(req.body); });`,
      "routes.js",
    ));
    const params = ir.nodes.filter((n): n is IRParameter => n.kind === "Parameter");
    expect(params.map((p) => p.name)).toEqual(["req", "res"]);
  });
});
