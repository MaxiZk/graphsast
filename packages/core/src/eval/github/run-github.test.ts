import { describe, it, expect } from "vitest";
import { classify, type GithubVulnerability } from "./run-github.js";

const vuln = (id: string, cwe: number | null, file: string, line?: number, outOfScope?: string): GithubVulnerability => ({
  id, cwe, file, description: "", ...(line !== undefined && { line }), ...(outOfScope && { outOfScope }),
});

describe("regla de conteo de la evaluación sobre GitHub", () => {
  const project = {
    vulnerabilities: [
      vuln("A", 89, "a.js", 10),
      vuln("B", 79, "b.js"),
      vuln("C", 79, "v.ejs", 3, "plantilla"),
      vuln("D", null, "limpio.js"),
    ],
    reviewedReal: [{ file: "c.js", line: 5, note: "" }],
  };

  it("exige misma familia y archivo, con tolerancia de líneas", () => {
    const r = classify(project, [
      { file: "a.js", line: 13, cwe: 89 },
      { file: "b.js", line: 99, cwe: 79 },
    ], 3);
    expect(r.detected).toEqual(["A", "B"]);
    expect(r.labeled).toBe(2);
  });

  it("no cuenta otra familia ni una línea fuera de la tolerancia", () => {
    const r = classify(project, [
      { file: "a.js", line: 10, cwe: 78 },
      { file: "a.js", line: 14, cwe: 89 },
    ], 3);
    expect(r.detected).toEqual([]);
    expect(r.missed).toEqual(["A", "B"]);
    expect(r.falseAlarms).toHaveLength(2);
  });

  it("agrupa por destino y separa los reales revisados", () => {
    const r = classify(project, [
      { file: "c.js", line: 5, cwe: 943 },
      { file: "c.js", line: 5, cwe: 943 },
      { file: "d.js", line: 1, cwe: 79 },
      { file: "d.js", line: 1, cwe: 79 },
    ], 3);
    expect(r.realExtra).toBe(1);
    expect(r.falseAlarms).toHaveLength(1);
  });
});
