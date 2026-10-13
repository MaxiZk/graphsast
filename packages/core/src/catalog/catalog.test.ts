import { describe, it, expect } from "vitest";
import { loadCatalogBundle } from "./load.js";
import {
  calleeMatchesPattern,
  sinkSpecOf,
  cweForSinkNode,
  labelsFromCatalog,
  rulesFromCatalog,
} from "./rules.js";
import type { IRCall } from "../ir/types.js";

describe("catalog CWE", () => {
  const bundle = loadCatalogBundle();

  it("carga las cuatro familias CWE del repositorio", () => {
    expect(bundle.entries.length).toBeGreaterThanOrEqual(4);
    const cwes = bundle.entries.map((e) => e.cwe).sort();
    expect(cwes).toContain(89);
    expect(cwes).toContain(78);
    expect(cwes).toContain(79);
    expect(cwes).toContain(943);
  });

  it("cada familia explica el riesgo, un ataque y cómo corregirlo", () => {
    for (const entry of bundle.entries) {
      for (const field of ["description", "attack", "fix"] as const) {
        expect(entry[field]?.trim(), `CWE-${entry.cwe}.${field}`).toBeTruthy();
      }
    }
  });

  it("CWE-89 cubre clientes SQL y solo mira el texto de la consulta", () => {
    const sqli = bundle.entries.find((e) => e.cwe === 89)!;
    const specs = sqli.sinks.map(sinkSpecOf);
    for (const callee of ["db.query", "connection.execute", "knex.raw", ".$queryRawUnsafe", "db.prepare"]) {
      expect(specs.map((s) => s.callee)).toContain(callee);
    }
    // Los valores ligados (`db.query(sql, [id])`) son la forma segura.
    for (const spec of specs) expect(spec.args).toEqual([0]);
  });

  it("CWE-943 cubre los sinks de Mongoose/MongoDB", () => {
    const nosql = bundle.entries.find((e) => e.cwe === 943)!;
    for (const pattern of [
      ".save",
      ".create",
      "findByIdAndUpdate",
      "findByIdAndDelete",
      "insertOne",
      "updateOne",
    ]) {
      expect(nosql.sinks).toContain(pattern);
    }
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

  it("clasifica cada sink en su familia: Mongoose → 943, SQL → 89", () => {
    const rules = rulesFromCatalog(bundle);
    const call = (callee: string) =>
      ({ kind: "Call", callee }) as unknown as IRCall;

    expect(cweForSinkNode(rules, call("Finance.create")).cwe).toBe(943);
    expect(cweForSinkNode(rules, call("finance.save")).cwe).toBe(943);
    expect(cweForSinkNode(rules, call("Finance.findByIdAndUpdate")).cwe).toBe(943);
    expect(cweForSinkNode(rules, call("Finance.findByIdAndDelete")).cwe).toBe(943);
    expect(cweForSinkNode(rules, call("col.insertOne")).cwe).toBe(943);
    expect(cweForSinkNode(rules, call("col.updateOne")).cwe).toBe(943);

    expect(cweForSinkNode(rules, call("db.query")).cwe).toBe(89);
    expect(cweForSinkNode(rules, call("pool.query")).cwe).toBe(89);
    expect(cweForSinkNode(rules, call("connection.execute")).cwe).toBe(89);
  });

  it("toda familia explica qué es la debilidad, no solo cómo se llama", () => {
    for (const entry of bundle.entries) {
      expect(entry.description, `CWE-${entry.cwe} sin description`).toBeTruthy();
      // Una frase corta no alcanza para explicar nada.
      expect(entry.description!.length).toBeGreaterThan(60);
      // El nombre ya está en el título: la descripción tiene que agregar algo.
      expect(entry.description).not.toBe(entry.name);
    }
  });

  it("expone etiquetas legibles para la UI", () => {
    const labels = labelsFromCatalog(bundle);
    expect(labels["param-any"]).toBeTruthy();
    expect(Object.keys(labels).length).toBeGreaterThan(5);
  });
});
