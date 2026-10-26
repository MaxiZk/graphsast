import { describe, expect, it } from "vitest";
import { formatOwasp, parseExpected, scoreOwasp } from "./run-owasp.js";

describe("OWASP Benchmark", () => {
  const csv = `# test name, category, real vulnerability, cwe
BenchmarkTest00001,pathtraver,true,22
BenchmarkTest00002,sqli,false,89
BenchmarkTest00003,crypto,true,327
BenchmarkTest00004,sqli,true,89`;

  it("lee solo las categorías del catálogo", () => {
    expect(parseExpected(csv).map((c) => c.name)).toEqual(["BenchmarkTest00001", "BenchmarkTest00002", "BenchmarkTest00004"]);
  });

  it("cuenta la matriz de confusión por categoría y el score", () => {
    const scores = scoreOwasp(parseExpected(csv), (c) => c.name !== "BenchmarkTest00004");
    expect(scores).toEqual([
      { category: "pathtraver", tp: 1, fn: 0, fp: 0, tn: 0 },
      { category: "sqli", tp: 0, fn: 1, fp: 1, tn: 0 },
    ]);
    expect(formatOwasp(scores).split("\n").at(-1)).toBe("Total\t1\t1\t1\t0\t0.500\t1.000\t-0.500");
  });
});
