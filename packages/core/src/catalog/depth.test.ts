import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";
import { getCatalogBundle } from "../taint/rules.js";
import { rulesFromCatalog } from "./rules.js";
import type { CatalogBundle } from "./types.js";

/** El catálogo real con `maxDepth` fijado en la familia SQL. */
function withSqlDepth(maxDepth: number): CatalogBundle {
  const bundle = getCatalogBundle();
  return {
    ...bundle,
    entries: bundle.entries.map((e) => (e.cwe === 89 ? { ...e, maxDepth } : e)),
  };
}

const graph = analyzeGraph(
  `function h(req) {
    const a = req.query.id;
    const b = a;
    const c = b;
    db.query("SELECT * FROM u WHERE id = " + c);
    document.body.innerHTML = c;
  }`,
  "t.ts",
);

const cwes = (rules = rulesFromCatalog(getCatalogBundle()), maxDepth?: number) =>
  analyzeTaint(graph, { rules, maxDepth }).map((f) => f.cwe).sort();

/** Largo (en aristas) del camino hasta el sink SQL con el catálogo tal cual. */
const sqlLength = analyzeTaint(graph).find((f) => f.cwe === 89)!.path.length - 1;

describe("maxDepth por familia del catálogo", () => {
  it("sin maxDepth, el camino SQL se encuentra", () => {
    expect(cwes()).toEqual([79, 89]);
  });

  it("un maxDepth más corto que el camino descarta solo esa familia", () => {
    expect(cwes(rulesFromCatalog(withSqlDepth(sqlLength - 1)))).toEqual([79]);
  });

  it("un maxDepth igual al largo del camino lo mantiene", () => {
    expect(cwes(rulesFromCatalog(withSqlDepth(sqlLength)))).toEqual([79, 89]);
  });

  it("--max-depth reemplaza el de la familia", () => {
    const rules = rulesFromCatalog(withSqlDepth(sqlLength - 1));
    expect(cwes(rules, sqlLength)).toEqual([79, 89]);
  });
});
