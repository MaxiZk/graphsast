import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../index.js";
import { getTaintRoles } from "../taint/analyzer.js";
import { buildPersistStatements, TAINT_PATH_CYPHER } from "./cypher.js";

describe("store/cypher", () => {
  it("genera CREATE por nodo y aristas tipadas", () => {
    const g = analyzeGraph(`function f(input){ db.query(input); }`, "t.ts");
    const roles = getTaintRoles(g);
    const stmts = buildPersistStatements(g, roles);
    expect(stmts[0]).toContain("DETACH DELETE");
    expect(stmts.some((s) => s.includes("GSNode"))).toBe(true);
    expect(stmts.some((s) => s.includes("FLOWS_TO"))).toBe(true);
  });

  it("plantilla Cypher de taint referencia aristas de propagación", () => {
    expect(TAINT_PATH_CYPHER).toContain("FLOWS_TO");
    expect(TAINT_PATH_CYPHER).toContain("BINDS_TO");
    expect(TAINT_PATH_CYPHER).toContain("sanitizer");
  });
});
