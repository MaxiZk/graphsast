import { describe, it, expect } from "vitest";
import { analyzeGraph, analyzeTaint } from "@graphsast/core";
import { describeFinding, describeNoFinding } from "./labels.js";

function firstFinding(code: string) {
  const graph = analyzeGraph(code, "demo.ts");
  const findings = analyzeTaint(graph);
  return { graph, finding: findings[0]! };
}

describe("describeFinding", () => {
  it("describe el caso intra-procedural en prosa", () => {
    const { graph, finding } = firstFinding(`function handler(input) {
  const q = input;
  db.query(q);
}`);
    expect(describeFinding(graph, finding)).toBe(
      "El dato entra por el parámetro input, se copia a la variable q y llega "
        + "a db.query sin pasar por ninguna función de saneamiento.",
    );
  });

  it("nombra la función que cruza el dato en el caso inter-procedural", () => {
    const { graph, finding } = firstFinding(`function sink(q) {
  db.query(q);
}

function handler(input) {
  sink(input);
}`);
    const text = describeFinding(graph, finding);
    expect(text.startsWith("El dato entra por el parámetro input")).toBe(true);
    expect(text).toContain("db.query");
    expect(text.endsWith("sin pasar por ninguna función de saneamiento.")).toBe(true);
  });

  it("contrae «a el» al cruzar un parámetro", () => {
    const { graph, finding } = firstFinding(`function runQuery(sql) {
  db.query(sql);
}

function handler(input) {
  runQuery(input);
}`);
    const text = describeFinding(graph, finding);
    expect(text).toContain("pasa al parámetro sql");
    expect(text).not.toContain("a el parámetro");
  });

  it("sin camino intermedio, encadena entrada y sink", () => {
    const { graph, finding } = firstFinding(`function handler(input) {
  eval(input);
}`);
    expect(describeFinding(graph, finding)).toBe(
      "El dato entra por el parámetro input y llega a eval sin pasar por "
        + "ninguna función de saneamiento.",
    );
  });
});

describe("describeNoFinding", () => {
  it("concuerda en singular", () => {
    expect(describeNoFinding(1, 1)).toBe(
      "Ningún dato llega de 1 entrada a 1 operación sensible sin pasar por "
        + "una función de saneamiento.",
    );
  });

  it("concuerda en plural", () => {
    expect(describeNoFinding(2, 3)).toBe(
      "Ningún dato llega de 2 entradas a 3 operaciones sensibles sin pasar "
        + "por una función de saneamiento.",
    );
  });

  it("sin cobertura, no afirma que el código sea seguro", () => {
    expect(describeNoFinding(1, 0)).toBe(
      "No hay camino que describir: el código tiene 1 entrada y "
        + "0 operaciones sensibles.",
    );
  });
});
