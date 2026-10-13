import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv-draft-04";
import addFormats from "ajv-formats";

/**
 * Tests de punta a punta del CLI: un proceso aparte, con argumentos reales,
 * sobre carpetas reales. Corre el binario compilado (`dist/`), el mismo que se
 * instala; antes de empezar recompila con `tsc -b`, que es incremental, para
 * no probar nunca un `dist/` viejo.
 */

// Cada caso lanza uno o dos procesos; la compilación inicial, unos segundos.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = path.resolve(HERE, "../..");
const CLI = path.join(PACKAGE, "dist/cli/graphsast.cli.js");
// El script de typescript con node: `.bin/tsc` no se puede lanzar sin shell en Windows.
const TSC = path.resolve(PACKAGE, "../../node_modules/typescript/bin/tsc");

beforeAll(() => {
  const r = spawnSync(process.execPath, [TSC, "-b"], { cwd: PACKAGE, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tsc -b falló:\n${r.stdout}${r.stderr}`);
});

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "graphsast-cli-"));
  dirs.push(root);
  for (const [rel, code] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), code);
  }
  return root;
}

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 60_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const VULNERABLE = project({
  "src/controller.ts": [
    'import { findById } from "./repository";',
    "export function show(req: any, res: any) {",
    "  res.json(findById(req.params.id));",
    "}",
    "",
  ].join("\n"),
  "src/repository.ts": [
    "export const findById = (id: string) =>",
    "  db.query(`SELECT * FROM users WHERE id = ${id}`);",
    "",
  ].join("\n"),
  "src/view.js": "function render(req, res) { res.send('<h1>' + req.query.name + '</h1>'); }\n",
  "src/controller.test.ts": "function t(input) { db.query(input); }\n",
});

const CLEAN = project({
  "app.ts": [
    "export function show(req: any) {",
    '  return db.query("SELECT * FROM users WHERE id = ?", [req.params.id]);',
    "}",
    "",
  ].join("\n"),
});

describe("graphsast scan — códigos de salida", () => {
  it("con hallazgos sale 1 y los lista en texto", () => {
    const r = run("scan", VULNERABLE, "--exclude", "**/*.test.ts");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("src/repository.ts");
    expect(r.stdout).toContain("CWE-89");
    expect(r.stdout).toContain("src/view.js");
    expect(r.stdout).toContain("CWE-79");
  });

  it("sin hallazgos sale 0", () => {
    expect(run("scan", CLEAN).code).toBe(0);
  });

  it("--exit-zero sale 0 aunque haya hallazgos", () => {
    expect(run("scan", VULNERABLE, "--exit-zero").code).toBe(0);
  });

  it("--fail-on solo falla por las familias indicadas", () => {
    expect(run("scan", VULNERABLE, "--fail-on", "cwe-78").code).toBe(0);
    expect(run("scan", VULNERABLE, "--fail-on", "cwe-78,cwe-79").code).toBe(1);
  });

  it("uso incorrecto o ruta inexistente sale 2", () => {
    expect(run("scan", VULNERABLE, "--format", "xml").code).toBe(2);
    expect(run("scan", path.join(CLEAN, "no-existe")).code).toBe(2);
    expect(run("scan", CLEAN, "--sources", "todo").code).toBe(2);
  });

  it("un archivo que no se puede analizar sale 2 aunque el resto esté limpio", () => {
    const broken = project({ "ok.ts": "export const a = 1;\n", "bad.ts": "def f(x):\n    return x\n" });
    expect(run("scan", broken).code).toBe(2);
  });
});

describe("graphsast scan — formatos", () => {
  it("JSON: totales, camino entre archivos y source en el controlador", () => {
    const r = run("scan", VULNERABLE, "--format", "json", "--exclude", "**/*.test.ts");
    const report = JSON.parse(r.stdout);
    expect(report.totals.files).toBe(3);
    expect(report.totals.crossFileCalls).toBe(1);
    const sqli = report.findings.find((f: { cwe: number }) => f.cwe === 89);
    expect(sqli.file).toBe("src/repository.ts");
    expect(sqli.source.file).toBe("src/controller.ts");
    expect(sqli.source.name).toBe("req");
  });

  it("SARIF 2.1.0 válido contra el esquema oficial, escrito con --out", () => {
    const out = path.join(project({}), "graphsast.sarif");
    const r = run("scan", VULNERABLE, "--format", "sarif", "--out", out);
    expect(r.code).toBe(1);
    const sarif = JSON.parse(readFileSync(out, "utf8"));
    const schema = JSON.parse(
      readFileSync(path.join(HERE, "../scan/reporters/fixtures/sarif-schema-2.1.0.json"), "utf8"),
    );
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(sarif), JSON.stringify(validate.errors)).toBe(true);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
  });
});

describe("graphsast scan — filtros", () => {
  it("--cwe reporta solo esas familias", () => {
    const report = JSON.parse(run("scan", VULNERABLE, "--format", "json", "--cwe", "79").stdout);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.every((f: { cwe: number }) => f.cwe === 79)).toBe(true);
  });

  it("--exclude saca archivos del escaneo", () => {
    const all = JSON.parse(run("scan", VULNERABLE, "--format", "json").stdout);
    const some = JSON.parse(run("scan", VULNERABLE, "--format", "json", "--exclude", "**/*.test.ts").stdout);
    expect(all.totals.files).toBe(some.totals.files + 1);
  });

  it("--sources catalog descarta la función de test sin source declarado", () => {
    const params = JSON.parse(run("scan", VULNERABLE, "--format", "json").stdout);
    const catalog = JSON.parse(run("scan", VULNERABLE, "--format", "json", "--sources", "catalog").stdout);
    const fromTest = (r: { findings: { file: string }[] }) =>
      r.findings.filter((f) => f.file === "src/controller.test.ts").length;
    expect(fromTest(params)).toBe(1);
    expect(fromTest(catalog)).toBe(0);
    expect(catalog.findings.length).toBe(params.findings.length - 1);
  });

  it("--no-cross-file analiza cada archivo por separado", () => {
    const report = JSON.parse(run("scan", VULNERABLE, "--format", "json", "--no-cross-file").stdout);
    expect(report.totals.crossFileCalls).toBe(0);
    const sqli = report.findings.find((f: { cwe: number; file: string }) =>
      f.cwe === 89 && f.file === "src/repository.ts");
    expect(sqli.source.file).toBe("src/repository.ts");
  });
});
