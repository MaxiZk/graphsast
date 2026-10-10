import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanPaths } from "./scan.js";
import { scanFiles, scanFilesWithGraphs, type ScanInput } from "./scan-files.js";
import * as posix from "../util/posix-path.js";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const THREE_LAYERS: Record<string, string> = {
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
  "src/repository.ts": [
    "export function findById(userId: string) {",
    "  return db.query(`SELECT * FROM users WHERE id = ${userId}`);",
    "}",
    "",
  ].join("\n"),
};

function inputsOf(files: Record<string, string>): ScanInput[] {
  return Object.entries(files).map(([p, content]) => ({ path: p, content }));
}

/** Resultado sin lo que depende del reloj, para comparar dos escaneos. */
function stable(result: ReturnType<typeof scanFiles>) {
  return {
    findings: result.findings,
    files: result.files.map(({ elapsedMs: _, ...rest }) => rest),
    totals: { ...result.totals, elapsedMs: 0 },
  };
}

describe("scanFiles: el mismo análisis sin disco", () => {
  it("da el mismo resultado que scanPaths sobre los mismos archivos", () => {
    const root = mkdtempSync(path.join(tmpdir(), "graphsast-files-"));
    dirs.push(root);
    for (const [rel, code] of Object.entries(THREE_LAYERS)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), code);
    }
    const fromDisk = scanPaths([root]);
    // scanPaths ordena por ruta absoluta; acá se pasan en el mismo orden.
    const order = fromDisk.files.map((f) => f.file);
    const inMemory = scanFiles(order.map((p) => ({ path: p, content: THREE_LAYERS[p]! })));
    expect(stable(inMemory)).toEqual(stable(fromDisk));
    expect(inMemory.totals.crossFileCalls).toBe(2);
    expect(inMemory.findings).toHaveLength(1);
  });

  it("devuelve el grafo unido con el hallazgo crudo alineado al reportable", () => {
    const { result, graphs } = scanFilesWithGraphs(inputsOf(THREE_LAYERS));
    expect(graphs).toHaveLength(1);
    const [g] = graphs;
    expect([...g!.files].sort()).toEqual(Object.keys(THREE_LAYERS).sort());
    expect(g!.findings).toHaveLength(1);
    expect(g!.scanFindings).toEqual(result.findings);
    const ids = new Set(g!.graph.nodes.map((n) => n.id));
    expect(g!.findings[0]!.path.every((id) => ids.has(id))).toBe(true);
  });

  it("un archivo ilegible queda como error sin frenar el resto", () => {
    const result = scanFiles([
      { path: "a.ts", error: "No se pudo leer el archivo" },
      { path: "b.ts", content: "function f(input) { db.query(input); }" },
    ]);
    expect(result.files.map((f) => f.file)).toEqual(["a.ts", "b.ts"]);
    expect(result.files[0]!.error).toBe("No se pudo leer el archivo");
    expect(result.totals.errors).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  it("avisa el progreso antes de cada archivo", () => {
    const seen: string[] = [];
    scanFilesWithGraphs(inputsOf(THREE_LAYERS), {}, "", (done, total, file) =>
      seen.push(`${done}/${total} ${file}`),
    );
    expect(seen).toEqual([
      "0/3 src/controller.ts",
      "1/3 src/service.ts",
      "2/3 src/repository.ts",
    ]);
  });
});

describe("rutas posix", () => {
  it("resuelve specifiers relativos como node:path en posix", () => {
    const cases: [string, string][] = [
      ["/src", "./service"],
      ["/src/a", "../lib/x.ts"],
      ["/src", "../../escape"],
      ["/", "./index.ts"],
    ];
    for (const [dir, rel] of cases) {
      expect(posix.resolve(dir, rel)).toBe(path.posix.resolve(dir, rel));
    }
  });

  it("dirname, extname y join coinciden con node:path en posix", () => {
    for (const p of ["/src/a.ts", "/a", "/src/.eslintrc", "/src/a.test.ts", "/x/y."]) {
      expect(posix.dirname(p)).toBe(path.posix.dirname(p));
      expect(posix.extname(p)).toBe(path.posix.extname(p));
    }
    expect(posix.join("/src/lib", "index.ts")).toBe(path.posix.join("/src/lib", "index.ts"));
  });
});
