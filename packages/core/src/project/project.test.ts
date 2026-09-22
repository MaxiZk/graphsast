import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanPaths } from "../scan/scan.js";
import { reportToText } from "../scan/reporters/text.js";
import { reportToSarif } from "../scan/reporters/sarif.js";
import { resolveSpecifier } from "./links.js";
import { connectedComponents } from "./link.js";

const dirs: string[] = [];

/** Crea un proyecto temporal con los archivos dados y lo escanea. */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "graphsast-project-"));
  dirs.push(root);
  for (const [rel, code] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), code);
  }
  return root;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const REPOSITORY = [
  "export function findById(userId: string) {",
  "  return db.query(`SELECT * FROM users WHERE id = ${userId}`);",
  "}",
  "",
].join("\n");

const THREE_LAYERS = {
  "src/controller.ts": [
    'import { getUser } from "./service";',
    "export function show(req: any, res: any) {",
    "  const user = getUser(req.params.id);",
    "  res.json(user);",
    "}",
    "",
  ].join("\n"),
  "src/service.ts": [
    'import { findById } from "./repository";',
    "export function getUser(id: string) {",
    "  return findById(id);",
    "}",
    "",
  ].join("\n"),
  "src/repository.ts": REPOSITORY,
};

describe("analisis entre archivos: controlador → servicio → repositorio", () => {
  const root = project(THREE_LAYERS);

  it("sigue el dato por los tres archivos hasta el sink", () => {
    const result = scanPaths([root]);
    expect(result.totals.errors).toBe(0);
    expect(result.totals.crossFileCalls).toBe(2);
    expect(result.findings).toHaveLength(1);

    const f = result.findings[0]!;
    expect(f.cwe).toBe(89);
    expect(f.file).toBe(path.join("src", "repository.ts"));
    expect(f.source).toMatchObject({ file: path.join("src", "controller.ts"), name: "req", line: 2 });
    expect(f.sink).toMatchObject({ file: path.join("src", "repository.ts"), line: 2 });

    const files = f.steps.map((s) => s.file);
    const order = files.filter((file, i) => i === 0 || file !== files[i - 1]);
    expect(order).toEqual([
      path.join("src", "controller.ts"),
      path.join("src", "service.ts"),
      path.join("src", "repository.ts"),
    ]);
  });

  it("sin el cruce, el hallazgo arranca en el parametro del repositorio", () => {
    const result = scanPaths([root], { crossFile: false });
    expect(result.totals.crossFileCalls).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.source).toMatchObject({
      file: path.join("src", "repository.ts"),
      name: "userId",
    });
  });

  it("el reporte de texto marca cada cambio de archivo", () => {
    const text = reportToText(scanPaths([root]));
    const line = text.split("\n").find((l) => l.includes("CWE-89"))!;
    expect(line).toMatch(/^ {2}L2 {2}CWE-89 {2}req \(src[/\\]controller\.ts:2\) → /);
    expect(line).toMatch(/\(src[/\\]service\.ts:\d+\)/);
    expect(line).toMatch(/\(src[/\\]repository\.ts:\d+\) → db\.query$/);
    expect(text).toContain("2 llamada(s) entre archivos");
  });

  it("SARIF ubica cada paso del codeFlow en su archivo", () => {
    const sarif = JSON.parse(reportToSarif(scanPaths([root]), { baseDir: root }));
    const result = sarif.runs[0].results[0];
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe("src/repository.ts");
    const uris = result.codeFlows[0].threadFlows[0].locations
      .map((l: { location: { physicalLocation: { artifactLocation: { uri: string } } } }) =>
        l.location.physicalLocation.artifactLocation.uri);
    expect(new Set(uris)).toEqual(
      new Set(["src/controller.ts", "src/service.ts", "src/repository.ts"]),
    );
  });
});

describe("analisis entre archivos: se comporta como dentro de un archivo", () => {
  it("un parametro que otro archivo liga a una constante deja de ser fuente", () => {
    const code = {
      "service.ts": REPOSITORY,
      "controller.ts": [
        'import { findById } from "./service";',
        'export function handler() { const fixed = "42"; return findById(fixed); }',
        "",
      ].join("\n"),
    };
    expect(scanPaths([project(code)]).findings).toEqual([]);
    // Mismo código en un solo archivo: mismo resultado.
    const single = REPOSITORY.replace("export function", "function")
      + 'export function handler() { const fixed = "42"; return findById(fixed); }\n';
    expect(scanPaths([project({ "app.ts": single })]).findings).toEqual([]);
  });

  it("un sanitizer en el llamador corta el camino y elimina el falso positivo", () => {
    const root = project({
      "repository.ts": REPOSITORY,
      "controller.ts": [
        'import { findById } from "./repository";',
        "export function show(req: any) {",
        "  const safe = escape(req.params.id);",
        "  return findById(safe);",
        "}",
        "",
      ].join("\n"),
    });
    expect(scanPaths([root]).findings).toEqual([]);
    // Sin el cruce, el parámetro del repositorio queda como fuente raíz.
    expect(scanPaths([root], { crossFile: false }).findings).toHaveLength(1);
  });

  it("un sanitizer dentro de la funcion llamada no corta el camino, igual que en un archivo", () => {
    // Limitación previa del motor, no del cruce: CALLS + RETURNS llevan el
    // dato del argumento a lo que la función retorna sin pasar por `escape`.
    const service = [
      "export function getUser(id: string) {",
      "  const safe = escape(id);",
      "  return findById(safe);",
      "}",
    ].join("\n");
    const cross = scanPaths([project({
      ...THREE_LAYERS,
      "src/service.ts": `import { findById } from "./repository";\n${service}\n`,
    })]);
    const single = scanPaths([project({
      "app.ts": [
        REPOSITORY.replace("export function", "function"),
        service.replace("export function", "function"),
        THREE_LAYERS["src/controller.ts"].split("\n").slice(1).join("\n"),
      ].join("\n"),
    })]);
    expect(cross.findings).toHaveLength(1);
    expect(single.findings).toHaveLength(1);
  });
});

/** Proyecto donde el controlador llama al repositorio a través de `importLine`. */
function viaImport(importLine: string, call: string, extra: Record<string, string> = {}) {
  return project({
    "repository.ts": REPOSITORY,
    "controller.ts": `${importLine}\nexport function show(req: any) {\n  ${call}(req.params.id);\n}\n`,
    ...extra,
  });
}

function sourceOf(root: string) {
  const r = scanPaths([root]);
  expect(r.findings).toHaveLength(1);
  return { source: r.findings[0]!.source, calls: r.totals.crossFileCalls };
}

describe("formas de import y export soportadas", () => {
  const cases: [string, string, string, Record<string, string>?][] = [
    ["alias", 'import { findById as byId } from "./repository";', "byId"],
    ["specifier .js hacia .ts", 'import { findById } from "./repository.js";', "findById"],
    ["namespace", 'import * as repo from "./repository";', "repo.findById"],
    ["barrel con export *", 'import { findById } from "./db";', "findById",
      { "db/index.ts": 'export * from "../repository";\n' }],
    ["re-export con alias", 'import { lookup } from "./db";', "lookup",
      { "db.ts": 'export { findById as lookup } from "./repository";\n' }],
    ["re-export de un import", 'import { findById } from "./db";', "findById",
      { "db.ts": 'import { findById } from "./repository";\nexport { findById };\n' }],
  ];

  for (const [name, importLine, call, extra] of cases) {
    it(name, () => {
      const { source, calls } = sourceOf(viaImport(importLine, call, extra));
      expect(source).toMatchObject({ file: "controller.ts", name: "req" });
      expect(calls).toBe(1);
    });
  }

  it("default export de una function", () => {
    const root = project({
      "repository.ts": REPOSITORY.replace("export function findById", "export default function findById"),
      "controller.ts": 'import byId from "./repository";\nexport function show(req: any) {\n  byId(req.params.id);\n}\n',
    });
    expect(sourceOf(root).source).toMatchObject({ file: "controller.ts", name: "req" });
  });

  it("export { f } y export default f de una function local", () => {
    for (const [exportLine, importLine] of [
      ["export { findById };", 'import { findById as f } from "./repository";'],
      ["export default findById;", 'import f from "./repository";'],
    ]) {
      const root = project({
        "repository.ts": REPOSITORY.replace("export function", "function") + `${exportLine}\n`,
        "controller.ts": `${importLine}\nexport function show(req: any) {\n  f(req.params.id);\n}\n`,
      });
      expect(sourceOf(root).source).toMatchObject({ file: "controller.ts", name: "req" });
    }
  });

  it("re-exports circulares no cuelgan el analisis", () => {
    const root = project({
      "a.ts": 'export * from "./b";\n',
      "b.ts": 'export * from "./a";\n',
      "controller.ts": 'import { nada } from "./a";\nexport function h(req: any) { nada(req); }\n',
    });
    expect(scanPaths([root]).totals.crossFileCalls).toBe(0);
  });
});

describe("fuera del alcance: no se liga (y no se simula)", () => {
  const unsupported: [string, Record<string, string>][] = [
    ["arrow function exportada", {
      "repository.ts": "export const findById = (userId: string) => db.query(`SELECT ${userId}`);\n",
      "controller.ts": 'import { findById } from "./repository";\nexport function show(req: any) { findById(req.params.id); }\n',
    }],
    ["CommonJS", {
      "repository.js": "function findById(userId) { return db.query(`SELECT ${userId}`); }\nmodule.exports = { findById };\n",
      "controller.js": 'const { findById } = require("./repository");\nfunction show(req) { findById(req.params.id); }\n',
    }],
    ["metodo de clase", {
      "repository.ts": "export class Repo { findById(userId: string) { return db.query(`SELECT ${userId}`); } }\n",
      "controller.ts": 'import { Repo } from "./repository";\nexport function show(req: any) { new Repo().findById(req.params.id); }\n',
    }],
  ];

  for (const [name, files] of unsupported) {
    it(name, () => {
      const r = scanPaths([project(files)]);
      expect(r.totals.crossFileCalls).toBe(0);
      // El hallazgo sigue existiendo, pero arranca en el parámetro del sink:
      // el camino desde el controlador no se reconstruye.
      expect(r.findings.length).toBeGreaterThan(0);
      for (const f of r.findings) expect(f.source.file).toBe(f.file);
    });
  }
});

describe("resolveSpecifier", () => {
  const known = new Set(["/p/a.ts", "/p/lib/index.ts", "/p/b.js"]);
  it("resuelve extension, index y .js hacia .ts", () => {
    expect(resolveSpecifier("/p/x.ts", "./a", known)).toBe("/p/a.ts");
    expect(resolveSpecifier("/p/x.ts", "./a.js", known)).toBe("/p/a.ts");
    expect(resolveSpecifier("/p/x.ts", "./b.js", known)).toBe("/p/b.js");
    expect(resolveSpecifier("/p/x.ts", "./lib", known)).toBe("/p/lib/index.ts");
    expect(resolveSpecifier("/p/sub/x.ts", "../a", known)).toBe("/p/a.ts");
  });

  it("no resuelve paquetes ni archivos fuera del escaneo", () => {
    expect(resolveSpecifier("/p/x.ts", "express", known)).toBeNull();
    expect(resolveSpecifier("/p/x.ts", "./nope", known)).toBeNull();
  });
});

describe("connectedComponents", () => {
  it("agrupa por llamadas y deja solos a los archivos sin llamadas", () => {
    const groups = connectedComponents(["a", "b", "c", "d"], [["a", "b"], ["c", "b"]]);
    expect(groups.map((g) => [...g].sort())).toEqual([["a", "b", "c"], ["d"]]);
  });
});
