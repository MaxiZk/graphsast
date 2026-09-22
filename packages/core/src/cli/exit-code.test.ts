import { describe, it, expect } from "vitest";
import { EXIT, exitCodeFor, parseCweFamily } from "./exit-code.js";
import type { ScanFinding, ScanResult } from "../scan/types.js";

const step = { kind: "Call" as const, name: "x", code: "x", line: 1, col: 1 };

function finding(cwe?: number): ScanFinding {
  return { file: "a.ts", cwe, source: step, sink: step, steps: [step, step] };
}

function result(opts: { files?: number; errors?: number; cwes?: (number | undefined)[] }): ScanResult {
  const findings = (opts.cwes ?? []).map(finding);
  return {
    analyzedAt: "",
    root: "/",
    files: [],
    findings,
    totals: {
      files: opts.files ?? 1,
      filesWithFindings: findings.length ? 1 : 0,
      findings: findings.length,
      lines: 1,
      elapsedMs: 0,
      errors: opts.errors ?? 0,
    },
  };
}

describe("exitCodeFor", () => {
  it("0 sin hallazgos", () => {
    expect(exitCodeFor(result({}))).toBe(EXIT.CLEAN);
  });

  it("1 con hallazgos", () => {
    expect(exitCodeFor(result({ cwes: [89] }))).toBe(EXIT.FINDINGS);
  });

  it("2 si algun archivo no se pudo analizar, aunque haya hallazgos", () => {
    expect(exitCodeFor(result({ files: 3, errors: 1 }))).toBe(EXIT.ERROR);
    expect(exitCodeFor(result({ files: 3, errors: 1, cwes: [89] }))).toBe(EXIT.ERROR);
  });

  it("2 si no hubo ningun archivo que analizar", () => {
    expect(exitCodeFor(result({ files: 0 }))).toBe(EXIT.ERROR);
  });

  it("--exit-zero silencia los hallazgos pero no los errores", () => {
    expect(exitCodeFor(result({ cwes: [89] }), { exitZero: true })).toBe(EXIT.CLEAN);
    expect(exitCodeFor(result({ errors: 1 }), { exitZero: true })).toBe(EXIT.ERROR);
  });

  it("--fail-on solo cuenta las familias indicadas", () => {
    const r = result({ cwes: [79, 79] });
    expect(exitCodeFor(r, { failOn: [89, 78] })).toBe(EXIT.CLEAN);
    expect(exitCodeFor(r, { failOn: [79] })).toBe(EXIT.FINDINGS);
  });

  it("--fail-on no cuenta hallazgos sin CWE", () => {
    expect(exitCodeFor(result({ cwes: [undefined] }), { failOn: [89] })).toBe(EXIT.CLEAN);
  });
});

describe("parseCweFamily", () => {
  it("acepta cwe-N, CWE-N y N", () => {
    expect(parseCweFamily("cwe-89")).toBe(89);
    expect(parseCweFamily("CWE-943")).toBe(943);
    expect(parseCweFamily(" 78 ")).toBe(78);
  });

  it("rechaza lo demas", () => {
    expect(parseCweFamily("sqli")).toBeNull();
    expect(parseCweFamily("cwe-")).toBeNull();
    expect(parseCweFamily("cwe-89x")).toBeNull();
  });
});
