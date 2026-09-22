import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Ajv from "ajv-draft-04";
import addFormats from "ajv-formats";
import { scanSource } from "../scan.js";
import type { ScanResult } from "../types.js";
import { reportToText } from "./text.js";
import { reportToSarif } from "./sarif.js";

const ESC = String.fromCharCode(27);

function resultOf(code: string, file = "a.js"): ScanResult {
  const fileResult = scanSource(code, file);
  return {
    analyzedAt: new Date().toISOString(),
    root: "/proyecto",
    files: [fileResult],
    findings: fileResult.findings,
    totals: {
      files: 1,
      filesWithFindings: fileResult.findings.length > 0 ? 1 : 0,
      findings: fileResult.findings.length,
      lines: fileResult.lineCount,
      elapsedMs: fileResult.elapsedMs,
      errors: 0,
    },
  };
}

const VULN = "function h(req){\n  const q = req.body;\n  db.query(q);\n}";

describe("reportToText", () => {
  it("agrupa por archivo con una linea por hallazgo: linea, CWE y camino", () => {
    const lines = reportToText(resultOf(VULN)).split("\n");
    const header = lines.indexOf("a.js");
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]).toBe("  L3  CWE-89  req → q → db.query");
  });

  it("verbose muestra un bloque con ubicacion y codigo de cada paso", () => {
    const text = reportToText(resultOf(VULN), { verbose: true });
    expect(text).toContain("a.js:3:3");
    expect(text).toContain("q = req.body");
    expect(text).toContain("regla: cwe-89-sink-db_query");
  });

  it("sin color no emite secuencias ANSI", () => {
    expect(reportToText(resultOf(VULN), { color: false }).includes(ESC)).toBe(false);
  });

  it("con color emite secuencias ANSI", () => {
    expect(reportToText(resultOf(VULN), { color: true }).includes(ESC)).toBe(true);
  });

  it("informa explicitamente cuando no hay hallazgos", () => {
    const text = reportToText(resultOf('db.query("SELECT 1");'));
    expect(text).toContain("Sin hallazgos");
  });

  it("showPath false muestra solo source y sink", () => {
    expect(reportToText(resultOf(VULN), { showPath: true }))
      .toContain("req → q → db.query");
    expect(reportToText(resultOf(VULN), { showPath: false }))
      .toContain("req → db.query");
    const full = reportToText(resultOf(VULN), { showPath: true, verbose: true });
    const brief = reportToText(resultOf(VULN), { showPath: false, verbose: true });
    expect(full.split("\n").length).toBeGreaterThan(brief.split("\n").length);
  });
});

describe("reportToSarif", () => {
  it("produce SARIF 2.1.0 valido con reglas referenciadas", () => {
    const sarif = JSON.parse(reportToSarif(resultOf(VULN)));
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0];
    expect(run.tool.driver.name).toBe("GraphSAST");
    const ruleIds = new Set(run.tool.driver.rules.map((r: { id: string }) => r.id));
    for (const res of run.results) {
      expect(ruleIds.has(res.ruleId)).toBe(true);
    }
  });

  it("emite el camino de taint como codeFlows", () => {
    const sarif = JSON.parse(reportToSarif(resultOf(VULN)));
    const flow = sarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations;
    expect(flow).toHaveLength(3);
    expect(flow[0].location.physicalLocation.region.startLine).toBe(1);
    expect(flow[2].location.physicalLocation.region.startLine).toBe(3);
  });

  it("usa rutas con separador POSIX", () => {
    const sarif = JSON.parse(
      reportToSarif(resultOf(VULN, "src\\routes\\a.js"), { baseDir: "/proyecto" }),
    );
    const uri = sarif.runs[0].results[0].locations[0].physicalLocation
      .artifactLocation.uri;
    expect(uri).toBe("src/routes/a.js");
  });
});

describe("reportToSarif contra el esquema oficial", () => {
  // Esquema OASIS SARIF 2.1.0 (errata01), guardado como fixture para que el
  // test no dependa de la red.
  const schema = JSON.parse(
    readFileSync(new URL("./fixtures/sarif-schema-2.1.0.json", import.meta.url), "utf8"),
  );
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const families = [
    { cwe: 89, name: "SQL Injection", description: "Consulta SQL armada con entrada." },
    { cwe: 78, name: "OS Command Injection" },
  ];

  function sarifOf(result: ScanResult, baseDir = "/proyecto") {
    return JSON.parse(reportToSarif(result, { baseDir, families, toolVersion: "0.1.0" }));
  }

  it("el validador rechaza un SARIF invalido", () => {
    expect(validate({ version: "2.1.0", runs: [{ results: [] }] })).toBe(false);
  });

  it("valida contra el esquema 2.1.0 con y sin hallazgos", () => {
    for (const r of [resultOf(VULN), resultOf('db.query("SELECT 1");')]) {
      const ok = validate(sarifOf(r));
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    }
  });

  it("valida tambien con archivos que no se pudieron analizar", () => {
    const r = resultOf(VULN);
    r.files.push({
      file: "roto.ts", findings: [], lineCount: 1, nodeCount: 0, edgeCount: 0,
      elapsedMs: 0, error: "No se pudo analizar",
    });
    r.totals.errors = 1;
    const sarif = sarifOf(r);
    expect(validate(sarif)).toBe(true);
    const inv = sarif.runs[0].invocations[0];
    expect(inv.executionSuccessful).toBe(false);
    expect(inv.toolExecutionNotifications[0].message.text).toBe("No se pudo analizar");
  });

  it("ruleId es la familia CWE y hay una regla por familia activa", () => {
    const run = sarifOf(resultOf(VULN)).runs[0];
    expect(run.results[0].ruleId).toBe("cwe-89");
    expect(run.results[0].properties["graphsast/sinkRule"]).toBe("cwe-89-sink-db_query");
    expect(run.tool.driver.rules.map((r: { id: string }) => r.id))
      .toEqual(["cwe-89", "cwe-78"]);
    expect(run.tool.driver.rules[0].fullDescription.text)
      .toBe("Consulta SQL armada con entrada.");
    expect(run.tool.driver.rules[run.results[0].ruleIndex].id).toBe("cwe-89");
  });

  it("ubicacion fisica con archivo, linea y rango del sink", () => {
    const loc = sarifOf(resultOf(VULN, "src/a.js")).runs[0].results[0].locations[0]
      .physicalLocation;
    expect(loc.artifactLocation).toEqual({ uri: "src/a.js", uriBaseId: "%SRCROOT%" });
    expect(loc.region).toMatchObject({ startLine: 3, startColumn: 3, endLine: 3 });
    expect(loc.region.endColumn).toBeGreaterThan(loc.region.startColumn);
  });

  it("las URIs son relativas a baseDir, no a la carpeta escaneada", () => {
    const r = resultOf(VULN, "controllers/a.js");
    r.root = "/repo/src";
    const uri = sarifOf(r, "/repo").runs[0].results[0].locations[0]
      .physicalLocation.artifactLocation.uri;
    expect(uri).toBe("src/controllers/a.js");
  });

  it("un archivo fuera de baseDir usa una URI file: absoluta", () => {
    const r = resultOf(VULN, "a.js");
    r.root = "/otro";
    const loc = sarifOf(r, "/repo").runs[0].results[0].locations[0]
      .physicalLocation.artifactLocation;
    expect(loc).toEqual({ uri: "file:///otro/a.js" });
  });
});
