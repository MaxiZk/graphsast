import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../index.js";
import { analyzeTaint, annotateTaint, getTaintRoles } from "../taint/analyzer.js";
import { defaultTaintRules } from "../taint/rules.js";
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
    expect(TAINT_PATH_CYPHER).toContain("sanitizerCwes");
  });
});

describe("store/cypher — mismas reglas que el motor en memoria", () => {
  const g = analyzeGraph(
    `function h(req) {
      db.query("SELECT * FROM u WHERE id = ?", [req.params.id]);
      User.findOne({ email: String(req.body.email) });
    }`,
    "t.ts",
  );
  const rules = defaultTaintRules();
  const stmts = buildPersistStatements(g, getTaintRoles(g), annotateTaint(g, rules));
  const nodeStmt = (callee: string) =>
    stmts.find((s) => s.startsWith("CREATE") && s.includes(`callee: ${JSON.stringify(callee)}`))!;

  it("el sink lleva su CWE y sus argumentos peligrosos", () => {
    expect(nodeStmt("db.query")).toContain("sinkCwe: 89");
    expect(nodeStmt("db.query")).toContain("sinkArgs: [0]");
    expect(nodeStmt("User.findOne")).toContain("sinkCwe: 943");
    expect(nodeStmt("User.findOne")).toContain("sinkArgs: [0]");
  });

  it(".save() recibe el documento en el receptor: no restringe argumentos", () => {
    const save = analyzeGraph(`function h(req) { const doc = new User(req.body); doc.save(); }`, "s.ts");
    const saveStmts = buildPersistStatements(save, getTaintRoles(save), annotateTaint(save, rules));
    const stmt = saveStmts.find((s) => s.startsWith("CREATE") && s.includes(`callee: "doc.save"`))!;
    expect(stmt).toContain("sinkCwe: 943");
    expect(stmt).toContain("sinkArgs: null");
  });

  it("el sanitizer lleva las CWE para las que vale", () => {
    expect(nodeStmt("String")).toContain("sanitizerCwes: [943]");
    expect(nodeStmt("db.query")).toContain("sanitizerCwes: null");
  });

  it("las aristas hacia una llamada llevan el argumento por el que entran", () => {
    expect(stmts.some((s) => /CREATE \(a\)-\[:FLOWS_TO \{arg: 1\}\]->\(b\)/.test(s))).toBe(true);
  });

  it("la consulta filtra sanitizers por CWE y la entrada al sink por argumento", () => {
    expect(TAINT_PATH_CYPHER).toContain("SANITIZED_BY");
    expect(TAINT_PATH_CYPHER).toContain("k.sinkCwe IN n.sanitizerCwes");
    expect(TAINT_PATH_CYPHER).toContain("last(relationships(p)).arg IN k.sinkArgs");
  });

  it("y el motor en memoria, con esas mismas anotaciones, no da hallazgos acá", () => {
    expect(analyzeTaint(g, { rules })).toEqual([]);
  });
});
