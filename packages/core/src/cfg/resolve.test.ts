import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";
import type { IRGraph, IRNode } from "../ir/types.js";

/** Nombre del nodo source de cada hallazgo, para ver dónde arranca el camino. */
function sourcesOf(code: string): string[] {
  const graph = analyzeGraph(code, "t.ts");
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return analyzeTaint(graph).map((f) => byId.get(f.sourceId)!.name).sort();
}

function callsFrom(graph: IRGraph, callee: string): IRNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const call = graph.nodes.find((n) => n.kind === "Call" && n.name === callee)!;
  return graph.edges
    .filter((e) => e.kind === "CALLS" && e.from === call.id)
    .map((e) => byId.get(e.to)!);
}

describe("resolución de llamadas — funciones guardadas en variables", () => {
  it("una arrow en un const se resuelve por el nombre de la variable", () => {
    expect(sourcesOf(`
      const runQuery = (sql) => db.query(sql);
      const handler = (req) => { runQuery(req.body.q); };
    `)).toEqual(["req"]);
  });

  it("una function expression en un let se resuelve igual", () => {
    expect(sourcesOf(`
      let runQuery = function (sql) { db.query(sql); };
      function handler(req) { runQuery(req.body.q); }
    `)).toEqual(["req"]);
  });
});

describe("resolución de llamadas — métodos", () => {
  it("this.m() apunta al método de la misma clase", () => {
    expect(sourcesOf(`
      class UserController {
        show(req) { return this.load(req.params.id); }
        load(id) { return db.query("SELECT * FROM u WHERE id = " + id); }
      }
    `)).toEqual(["req"]);
  });

  it("this.m() con dos clases que tienen m elige la de la llamada", () => {
    const graph = analyzeGraph(`
      class A { run(x) { return this.load(x); } load(v) { return v; } }
      class B { load(w) { return db.query(w); } }
    `, "t.ts");
    const targets = callsFrom(graph, "this.load");
    expect(targets.map((t) => (t as { memberOf?: string }).memberOf)).toEqual(["A"]);
  });

  it("un campo arrow de clase se resuelve con this", () => {
    expect(sourcesOf(`
      class Ctrl {
        handle = (req) => this.save(req.body);
        save = (data) => db.query(data);
      }
    `)).toEqual(["req"]);
  });

  it("this.servicio.m() se ata al único método m del código", () => {
    expect(sourcesOf(`
      class UserService {
        findUser(id) { return db.query(\`SELECT * FROM u WHERE id = \${id}\`); }
      }
      class UserController {
        constructor(service) { this.service = service; }
        handle(req) { return this.service.findUser(req.query.id); }
      }
    `)).toEqual(["req"]);
  });

  it("Clase.m() y objeto.m() se resuelven por su contenedor", () => {
    expect(sourcesOf(`
      class Repo { static byId(id) { return db.query(id); } }
      const svc = { byName: (name) => db.query(name) };
      function a(req) { Repo.byId(req.params.id); }
      function b(request) { svc.byName(request.query.n); }
    `)).toEqual(["req", "request"]);
  });

  it("un nombre ambiguo no se resuelve: dos clases con el mismo método", () => {
    const graph = analyzeGraph(`
      class A { save(x) { return x; } }
      class B { save(y) { return y; } }
      function h(req) { repo.save(req.body); }
    `, "t.ts");
    expect(callsFrom(graph, "repo.save")).toEqual([]);
  });

  it("un método con nombre de la biblioteca estándar no captura array.find()", () => {
    const graph = analyzeGraph(`
      class Repo { find(id) { return db.query(id); } }
      function h(req) { return items.find(req.body); }
    `, "t.ts");
    expect(callsFrom(graph, "items.find")).toEqual([]);
  });

  it("una llamada suelta no se resuelve a un método con el mismo nombre", () => {
    const graph = analyzeGraph(`
      class Repo { load(id) { return db.query(id); } }
      function h(req) { load(req.body); }
    `, "t.ts");
    expect(callsFrom(graph, "load")).toEqual([]);
  });
});

describe("valor de retorno de una llamada resuelta", () => {
  it("un sanitizer dentro de la función llamada corta el camino", () => {
    expect(sourcesOf(`
      function clean(x) { return escape(x); }
      function h(req) { db.query(clean(req.body)); }
    `)).toEqual([]);
  });

  it("una función que pasa el dato sin sanear lo sigue contaminando", () => {
    expect(sourcesOf(`
      function wrap(x) { return "SELECT * FROM t WHERE id = " + x; }
      function h(req) { db.query(wrap(req.body)); }
    `)).toEqual(["req"]);
  });

  it("una función que ignora su argumento no contamina el resultado", () => {
    expect(sourcesOf(`
      function constant(x) { return "SELECT 1"; }
      function h(req) { db.query(constant(req.body)); }
    `)).toEqual([]);
  });

  it("el sanitizer dentro de un método resuelto con this también corta", () => {
    expect(sourcesOf(`
      class Ctrl {
        show(req) { return db.query(this.safe(req.query.id)); }
        safe(v) { return sanitize(v); }
      }
    `)).toEqual([]);
  });

  it("una resolución por nombre único no apaga un sink de biblioteca con el mismo nombre", () => {
    // \`u.save()\` es el sink de Mongoose; que exista Cache.save no lo cambia.
    expect(sourcesOf(`
      class Cache { save(k) { return 1; } }
      function h(req) { const u = new User(req.body); u.save(); }
    `)).toEqual(["req"]);
  });
});
