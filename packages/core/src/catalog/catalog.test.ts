import { describe, it, expect } from "vitest";
import { loadCatalogBundle } from "./load.js";
import { calleeMatchesPattern, labelsFromCatalog, rulesFromCatalog } from "./rules.js";

describe("catalog CWE", () => {
  const bundle = loadCatalogBundle();

  it("carga las tres entradas CWE del repositorio", () => {
    expect(bundle.entries.length).toBeGreaterThanOrEqual(3);
    const cwes = bundle.entries.map((e) => e.cwe).sort();
    expect(cwes).toContain(89);
    expect(cwes).toContain(78);
    expect(cwes).toContain(79);
  });

  it("genera reglas de sink por patrón", () => {
    const rules = rulesFromCatalog(bundle);
    const sinks = rules.filter((r) => r.kind === "sink");
    expect(sinks.length).toBeGreaterThan(10);
    expect(sinks.some((r) => r.cwe === 89)).toBe(true);
  });

  it("calleeMatchesPattern reconoce sufijos Mongoose", () => {
    expect(calleeMatchesPattern("Finance.create", ".create")).toBe(true);
    expect(calleeMatchesPattern("finance.save", ".save")).toBe(true);
    expect(calleeMatchesPattern("db.query", "db.query")).toBe(true);
  });

  it("expone etiquetas legibles para la UI", () => {
    const labels = labelsFromCatalog(bundle);
    expect(labels["param-any"]).toBeTruthy();
    expect(Object.keys(labels).length).toBeGreaterThan(5);
  });
});
