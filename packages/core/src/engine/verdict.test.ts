import { describe, it, expect } from "vitest";
import { parseSource } from "../parser/parser.js";
import { analyzeGraph } from "../index.js";
import { analyzeTaint, getTaintRoles } from "../taint/analyzer.js";
import { buildVerdict } from "./verdict.js";

function verdictOf(code: string, file = "t.ts") {
  const parse = parseSource(code, file);
  if (parse.syntaxErrors > 0) {
    return buildVerdict({
      graph: { file, nodes: [], edges: [] },
      roles: { sourceIds: [], sinkIds: [], sanitizerIds: [] },
      findings: [],
      parse,
    });
  }
  const graph = analyzeGraph(code, file);
  return buildVerdict({
    graph,
    roles: getTaintRoles(graph),
    findings: analyzeTaint(graph),
    parse,
  });
}

describe("buildVerdict — distingue las tres causas de «0 hallazgos»", () => {
  it("código de otro lenguaje: no analizable, no concluyente", () => {
    const v = verdictOf(`package main

import "os/exec"

func run(cmd string) error {
    return exec.Command("sh", "-c", cmd).Run()
}`);
    expect(v.kind).toBe("not-analyzable");
    expect(v.conclusive).toBe(false);
    expect(v.syntaxErrors).toBeGreaterThan(0);
  });

  it("JS válido sin sinks: verde pero no concluyente", () => {
    const v = verdictOf(`function total(items) {
  return items.reduce((n, i) => n + i.price, 0);
}`);
    expect(v.kind).toBe("no-coverage");
    expect(v.conclusive).toBe(false);
    expect(v.sinks).toBe(0);
  });

  it("sources y sinks presentes, camino sanitizado: verde concluyente", () => {
    const v = verdictOf(`function h(req) {
  const q = sanitize(req.body);
  db.query(q);
}`);
    expect(v.kind).toBe("clean");
    expect(v.conclusive).toBe(true);
    expect(v.sources).toBeGreaterThan(0);
    expect(v.sinks).toBeGreaterThan(0);
  });

  it("camino sin sanitizar: vulnerable", () => {
    const v = verdictOf(`function h(req) {
  db.query(req.body);
}`);
    expect(v.kind).toBe("vulnerable");
    expect(v.conclusive).toBe(true);
    expect(v.findings).toBeGreaterThan(0);
  });

  it("un verde no concluyente nunca afirma que el código sea seguro", () => {
    for (const code of ["const a = 1;", "function f() { return 2; }"]) {
      const v = verdictOf(code);
      expect(v.conclusive).toBe(false);
      expect(v.detail).toContain("no afirma");
    }
  });
});

describe("parseSource — dialecto y errores de sintaxis", () => {
  it("TypeScript válido: sin errores", () => {
    const r = parseSource(`export const f = (x: number): number => x * 2;`, "t.ts");
    expect(r.syntaxErrors).toBe(0);
    expect(r.dialect).toBe("ts");
  });

  it("JSX pegado como .ts: reintenta como .tsx y lo acepta", () => {
    const r = parseSource(
      `function Card({ user }) {\n  return <div className="c">{user.name}</div>;\n}`,
      "demo.ts",
    );
    expect(r.syntaxErrors).toBe(0);
    expect(r.dialect).toBe("tsx");
  });

  it("Go: errores de sintaxis con mensaje ubicado", () => {
    const r = parseSource(`func main() {\n    ch := make(chan int)\n    <-ch\n}`, "t.ts");
    expect(r.syntaxErrors).toBeGreaterThan(0);
    expect(r.messages[0]).toMatch(/^línea \d+:/);
  });

  it("identificador no declarado es semántico, no sintáctico", () => {
    const r = parseSource(`db.query(noExisteEnNingunLado);`, "t.ts");
    expect(r.syntaxErrors).toBe(0);
  });
});
