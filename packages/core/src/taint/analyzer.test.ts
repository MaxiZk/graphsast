import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../index.js";
import { analyzeTaint } from "./analyzer.js";

describe("analyzeTaint", () => {
  it("Caso A (vulnerable, intra-procedural)", () => {
    const g = analyzeGraph(
      `function handler(input){ const q = input; db.query(q); }`,
      "caseA.ts",
    );
    const findings = analyzeTaint(g);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.sanitized).toBe(false);
    expect(findings[0]!.path[0]).toBe(findings[0]!.sourceId);
    expect(findings[0]!.path.at(-1)).toBe(findings[0]!.sinkId);
  });

  it("Caso B (vulnerable, inter-procedural)", () => {
    const g = analyzeGraph(
      `function sink(q){ db.query(q); } function handler(input){ sink(input); }`,
      "caseB.ts",
    );
    expect(analyzeTaint(g)).toHaveLength(1);
  });

  it("Caso C (no vulnerable): el sink no consume el dato tainted", () => {
    const g = analyzeGraph(
      `function handler(input){ db.query("SELECT 1"); }`,
      "caseC.ts",
    );
    expect(analyzeTaint(g)).toHaveLength(0);
  });

  it("Caso D (sanitizado): sanitize en el camino bloquea el finding", () => {
    const g = analyzeGraph(
      `function handler(input){ const safe = sanitize(input); db.query(safe); }`,
      "caseD.ts",
    );
    expect(analyzeTaint(g)).toHaveLength(0);
  });

  it("Caso E (req.body → SQLi)", () => {
    const g = analyzeGraph(
      `function handler(req){ const q = req.body; db.query(q); }`,
      "caseE.ts",
    );
    expect(analyzeTaint(g)).toHaveLength(1);
  });

  it("Caso F (eval / command injection)", () => {
    const g = analyzeGraph(
      `function handler(input){ eval(input); }`,
      "caseF.ts",
    );
    expect(analyzeTaint(g)).toHaveLength(1);
  });

  it("Caso G (Finance / Mongoose)", () => {
    const g = analyzeGraph(
      `function postFinances(req){ const data = req.body; Finance.create(data); }`,
      "caseG.ts",
    );
    expect(analyzeTaint(g)).toHaveLength(1);
  });

  it("Caso G completo: tres handlers sin cruces espurios entre funciones", () => {
    const g = analyzeGraph(
      `function postFinances(req, res) {
  const data = req.body;
  Finance.create(data);
}
function putFinance(req, res) {
  const id = req.params.id;
  const data = req.body;
  Finance.findByIdAndUpdate(id, data);
}
function deleteFinance(req, res) {
  Finance.findByIdAndDelete(req.params.id);
}`,
      "finance.ts",
    );
    const findings = analyzeTaint(g);
    expect(findings).toHaveLength(3);
    const sinkCallees = findings.map((f) => {
      const sink = g.nodes.find((n) => n.id === f.sinkId);
      return sink?.kind === "Call" ? sink.callee : "";
    });
    expect(sinkCallees).toContain("Finance.create");
    expect(sinkCallees).toContain("Finance.findByIdAndUpdate");
    expect(sinkCallees).toContain("Finance.findByIdAndDelete");
  });

  it("Caso H (Express arrow): app.post con callback async", () => {
    const g = analyzeGraph(
      `app.post('/finances', async (req, res) => {
  const data = req.body;
  Finance.create(data);
});`,
      "routes.js",
    );
    expect(g.nodes.filter((n) => n.kind === "Parameter")).toHaveLength(2);
    expect(analyzeTaint(g)).toHaveLength(1);
  });

  it("Caso H (Express arrow): new Model(req.body) + .save()", () => {
    const g = analyzeGraph(
      `app.post('/finances', async (req, res) => {
  const finance = new Finance(req.body);
  await finance.save();
});`,
      "routes.js",
    );
    expect(analyzeTaint(g)).toHaveLength(1);
  });
});
