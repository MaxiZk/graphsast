import { describe, it, expect } from "vitest";
import { matchFindings, type LabeledVulnerability } from "./run-nodegoat.js";

const vuln = (id: string, file: string, from: number, to: number): LabeledVulnerability => ({
  id, owasp: "", cwe: 78, catalogFamily: 78, description: "",
  sinkFile: file, sinkLines: [from, to], sinkInCatalog: true,
});

describe("regla de conteo de NodeGoat", () => {
  const vulns = [vuln("V1", "a.js", 10, 10), vuln("V2", "b.js", 5, 8)];

  it("cuenta un hallazgo en el archivo y el rango del destino", () => {
    const { outcomes, unmatched } = matchFindings(vulns, [
      { file: "a.js", line: 10, code: "" },
      { file: "b.js", line: 7, code: "" },
    ]);
    expect(outcomes.map((o) => o.detected)).toEqual([true, true]);
    expect(unmatched).toHaveLength(0);
  });

  it("no cuenta un hallazgo fuera del rango o en otro archivo", () => {
    const { outcomes, unmatched } = matchFindings(vulns, [
      { file: "a.js", line: 11, code: "" },
      { file: "c.js", line: 10, code: "" },
    ]);
    expect(outcomes.every((o) => !o.detected)).toBe(true);
    expect(unmatched).toHaveLength(2);
  });

  it("varios hallazgos sobre la misma vulnerabilidad cuentan una sola vez", () => {
    const { outcomes } = matchFindings(vulns, [
      { file: "b.js", line: 5, code: "" },
      { file: "b.js", line: 8, code: "" },
    ]);
    expect(outcomes.filter((o) => o.detected)).toHaveLength(1);
    expect(outcomes[1]!.matchedBy).toHaveLength(2);
  });
});
