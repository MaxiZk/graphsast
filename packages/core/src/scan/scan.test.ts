import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverFiles, commonRoot } from "./files.js";
import { scanPaths, scanSource } from "./scan.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "graphsast-scan-"));
  mkdirSync(path.join(root, "src", "routes"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(path.join(root, "dist"), { recursive: true });

  writeFileSync(
    path.join(root, "src", "routes", "users.js"),
    "function h(req){ db.query(`SELECT ${req.params.id}`); }\n",
  );
  writeFileSync(
    path.join(root, "src", "routes", "safe.js"),
    "function h(req){ const q = validator.escape(req.body); db.query(q); }\n",
  );
  writeFileSync(
    path.join(root, "src", "cmd.ts"),
    "export function run(req: any) { execSync(req.body.cmd); }\n",
  );
  writeFileSync(path.join(root, "README.md"), "# no analizable\n");
  writeFileSync(
    path.join(root, "node_modules", "pkg", "index.js"),
    "function h(req){ db.query(req.body); }\n",
  );
  writeFileSync(
    path.join(root, "dist", "bundle.js"),
    "function h(req){ db.query(req.body); }\n",
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("discoverFiles", () => {
  it("encuentra solo archivos con extension analizable", () => {
    const files = discoverFiles(root).map((f) => path.relative(root, f));
    expect(files).toContain(path.join("src", "routes", "users.js"));
    expect(files).toContain(path.join("src", "cmd.ts"));
    expect(files).not.toContain("README.md");
  });

  it("excluye node_modules y dist por defecto", () => {
    const files = discoverFiles(root).map((f) => path.relative(root, f));
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.startsWith("dist"))).toBe(false);
  });

  it("respeta la lista de ignore explicita", () => {
    const files = discoverFiles(root, { ignore: ["routes"] })
      .map((f) => path.relative(root, f));
    expect(files.some((f) => f.includes("routes"))).toBe(false);
    expect(files).toContain(path.join("src", "cmd.ts"));
  });

  it("filtra por extension", () => {
    const files = discoverFiles(root, { extensions: [".ts"] })
      .map((f) => path.relative(root, f));
    expect(files).toEqual([path.join("src", "cmd.ts")]);
  });

  it("acepta un archivo suelto como objetivo", () => {
    const single = path.join(root, "src", "cmd.ts");
    expect(discoverFiles(single)).toEqual([single]);
  });

  it("omite archivos por encima de maxFileBytes", () => {
    expect(discoverFiles(root, { maxFileBytes: 1 })).toEqual([]);
  });

  it("devuelve vacio si la ruta no existe", () => {
    expect(discoverFiles(path.join(root, "no-existe"))).toEqual([]);
  });
});

describe("scanSource", () => {
  it("reporta el hallazgo con ubicacion y camino", () => {
    const r = scanSource(
      "function h(req){\n  const q = req.body;\n  db.query(q);\n}",
      "a.js",
    );
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.file).toBe("a.js");
    expect(f.cwe).toBe(89);
    expect(f.sink.line).toBe(3);
    expect(f.source.name).toBe("req");
    expect(f.steps.map((s) => s.line)).toEqual([1, 2, 3]);
  });

  it("filtra por CWE", () => {
    const code = "function h(req){ execSync(req.body); }";
    expect(scanSource(code, "a.js", { cwe: [78] }).findings).toHaveLength(1);
    expect(scanSource(code, "a.js", { cwe: [89] }).findings).toHaveLength(0);
  });
});

describe("scanPaths", () => {
  it("agrega hallazgos de todo el arbol y omite dependencias", () => {
    const result = scanPaths([root]);
    expect(result.totals.files).toBe(3);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
    expect(result.findings.every((f) => !f.file.includes("node_modules"))).toBe(true);
  });

  it("no reporta el archivo sanitizado", () => {
    const result = scanPaths([root]);
    expect(result.findings.some((f) => f.file.includes("safe.js"))).toBe(false);
  });

  it("usa rutas relativas a la raiz comun", () => {
    const result = scanPaths([root]);
    expect(result.findings.every((f) => !path.isAbsolute(f.file))).toBe(true);
  });

  it("los totales son coherentes", () => {
    const result = scanPaths([root]);
    expect(result.totals.findings).toBe(result.findings.length);
    expect(result.totals.errors).toBe(0);
    expect(result.totals.lines).toBeGreaterThan(0);
  });

  it("no falla si la ruta no existe", () => {
    const result = scanPaths([path.join(root, "nope")]);
    expect(result.totals.files).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

describe("commonRoot", () => {
  it("resuelve el ancestro comun de dos rutas", () => {
    const a = path.join(root, "src", "routes", "users.js");
    const b = path.join(root, "src", "cmd.ts");
    expect(commonRoot([a, b])).toBe(path.join(root, "src"));
  });
});
