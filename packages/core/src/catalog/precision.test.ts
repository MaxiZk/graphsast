import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";

function cwesOf(code: string): number[] {
  return analyzeTaint(analyzeGraph(code, "t.ts")).map((f) => f.cwe!).sort();
}

describe("sinks por posición de argumento", () => {
  it("una consulta parametrizada no es hallazgo", () => {
    expect(cwesOf(`
      function h(req) {
        db.query("SELECT * FROM users WHERE id = ?", [req.params.id]);
        pool.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
        connection.execute("UPDATE t SET a = ? WHERE id = ?", [req.body.a, req.body.id]);
      }
    `)).toEqual([]);
  });

  it("concatenar en el texto de la consulta sí lo es", () => {
    expect(cwesOf(`
      function h(req) { db.query("SELECT * FROM users WHERE id = " + req.params.id, []); }
    `)).toEqual([89]);
  });

  it("insertAdjacentHTML solo es peligroso por el HTML, no por la posición", () => {
    expect(cwesOf(`function h(req) { el.insertAdjacentHTML(req.query.pos, "<b>hola</b>"); }`)).toEqual([]);
    expect(cwesOf(`function h(req) { el.insertAdjacentHTML("beforeend", req.query.html); }`)).toEqual([79]);
  });
});

describe("sinks por módulo, no por nombre suelto", () => {
  it("regex.exec(x) no es child_process.exec", () => {
    expect(cwesOf(`function h(req) { const m = /^(\\w+)$/.exec(req.query.name); pattern.exec(req.body); }`)).toEqual([]);
  });

  it("exec suelto sigue siendo sink (import nombrado o global)", () => {
    expect(cwesOf(`function h(req) { exec("ls " + req.query.dir); }`)).toEqual([78]);
  });

  it("child_process importado con otro nombre se reconoce igual", () => {
    expect(cwesOf(`
      const cp = require("child_process");
      import * as proc from "node:child_process";
      const { execSync: run } = require("child_process");
      function a(req) { cp.exec("ls " + req.query.dir); }
      function b(req) { proc.spawn(req.body.cmd); }
      function c(req) { run(req.body.cmd); }
    `)).toEqual([78, 78, 78]);
  });

  it("db.exec de SQLite es SQL, no un comando del sistema", () => {
    expect(cwesOf(`function h(req) { db.exec("DELETE FROM t WHERE id = " + req.params.id); }`)).toEqual([89]);
  });

  it("el argumento de opciones de exec no es peligroso", () => {
    expect(cwesOf(`function h(req) { exec("ls", { cwd: req.query.dir }); }`)).toEqual([]);
  });
});

describe("sinks acotados por receptor", () => {
  it("Model.find(req.query) es NoSQL, array.find no", () => {
    expect(cwesOf(`function h(req) { return User.find(req.query); }`)).toEqual([943]);
    expect(cwesOf(`function h(req) { return db.collection("users").find(req.query); }`)).toEqual([943]);
    expect(cwesOf(`function h(req) { return users.find((u) => u.id === req.params.id); }`)).toEqual([]);
  });
});

describe("sanitizers por CWE", () => {
  it("String() neutraliza operadores de MongoDB pero no una inyección SQL", () => {
    expect(cwesOf(`function h(req) { return User.findOne({ email: String(req.body.email) }); }`)).toEqual([]);
    expect(cwesOf(`function h(req) { db.query("SELECT * FROM u WHERE e = '" + String(req.body.email) + "'"); }`)).toEqual([89]);
  });

  it("una conversión numérica neutraliza cualquier inyección", () => {
    expect(cwesOf(`function h(req) { db.query("SELECT * FROM u WHERE id = " + parseInt(req.params.id, 10)); }`)).toEqual([]);
    expect(cwesOf(`function h(req) { res.send("<p>" + Number(req.query.n) + "</p>"); }`)).toEqual([]);
  });

  it("escapeHtml protege HTML, no SQL", () => {
    expect(cwesOf(`function h(req) { res.send("<p>" + escapeHtml(req.query.q) + "</p>"); }`)).toEqual([]);
  });
});

describe("sinks nuevos del catálogo", () => {
  it.each([
    [`function h(req) { knex.raw("SELECT * FROM t WHERE a = " + req.query.a); }`, 89],
    [`function h(req) { qb.whereRaw("a = " + req.query.a); }`, 89],
    [`function h(req) { prisma.$queryRawUnsafe("SELECT " + req.query.a); }`, 89],
    [`function h(req) { db.prepare("SELECT * FROM t WHERE a = " + req.query.a).get(); }`, 89],
    [`function h(req) { res.write(req.query.q); }`, 79],
    [`function h(req) { $("#out").html(req.query.q); }`, 79],
    [`function h(req) { frame.srcdoc = req.query.q; }`, 79],
    [`function h(req) { User.findOneAndUpdate({ _id: req.params.id }, req.body); }`, 943],
    [`function h(req) { shell.exec("git log " + req.query.ref); }`, 78],
  ])("%s", (code, cwe) => {
    expect(cwesOf(code)).toEqual([cwe]);
  });
});
