import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";
import { taintRulesFor } from "../taint/rules.js";

function sourcesOf(code: string, mode: "params" | "catalog"): string[] {
  const graph = analyzeGraph(code, "t.ts");
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return analyzeTaint(graph, { rules: taintRulesFor(mode) })
    .map((f) => byId.get(f.sourceId)!.name)
    .sort();
}

const LIBRARY = `
export function buildQuery(table: string, column: string) {
  return db.query("SELECT " + column + " FROM " + table);
}
`;

describe("modelo de source", () => {
  it("params: una función de librería que nadie llama es punto de entrada", () => {
    expect(sourcesOf(LIBRARY, "params")).toEqual(["column", "table"]);
  });

  it("catalog: la misma función no lo es", () => {
    expect(sourcesOf(LIBRARY, "catalog")).toEqual([]);
  });

  it("catalog: los handlers de Express, Koa y Fetch siguen siéndolo", () => {
    expect(sourcesOf(`
      function a(req, res) { db.query("SELECT " + req.query.id); }
      async function b(ctx) { db.query("SELECT " + ctx.query.id); }
      async function c(request) { db.query("SELECT " + (await request.json()).id); }
    `, "catalog")).toEqual(["ctx", "req", "request"]);
  });

  it("catalog: parámetros decorados de NestJS", () => {
    expect(sourcesOf(`
      class UsersController {
        find(@Param("id") id: string, @Query() q: any, limit: number) {
          db.query("SELECT * FROM u WHERE id = " + id + " LIMIT " + limit);
          return User.find(q);
        }
      }
    `, "catalog")).toEqual(["id", "q"]);
  });

  it("catalog: el camino entre funciones arranca igual en el handler", () => {
    expect(sourcesOf(`
      function repo(email) { return db.query("SELECT * FROM u WHERE e = '" + email + "'"); }
      function handler(req) { return repo(req.body.email); }
    `, "catalog")).toEqual(["req"]);
  });
});
