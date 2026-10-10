import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanPaths } from "../scan/scan.js";
import { scanFiles } from "../scan/scan-files.js";
import { aliasResolverFor, isProjectConfigName } from "./tsconfig.js";

describe("aliasResolverFor", () => {
  const resolve = aliasResolverFor([
    {
      path: "/repo/tsconfig.json",
      content: `{
        // comentarios y comas finales, como los acepta TypeScript
        "extends": "./tsconfig.base.json",
        "compilerOptions": { "paths": { "@/*": ["src/*"], "@db": ["src/db/index.ts"], }, },
      }`,
    },
    { path: "/repo/tsconfig.base.json", content: `{ "compilerOptions": { "baseUrl": "." } }` },
    {
      path: "/repo/packages/api/tsconfig.json",
      content: `{ "compilerOptions": { "baseUrl": "src", "paths": { "~/*": ["*"] } } }`,
    },
  ]);

  it("resuelve un patrón con comodín contra baseUrl", () => {
    expect(resolve("/repo/src/a.ts", "@/repo/users")).toEqual(["/repo/src/repo/users"]);
  });

  it("resuelve un patrón exacto", () => {
    expect(resolve("/repo/src/a.ts", "@db")).toEqual(["/repo/src/db/index.ts"]);
  });

  it("con baseUrl, un specifier no relativo se busca desde ahí", () => {
    expect(resolve("/repo/src/a.ts", "services/user")).toEqual(["/repo/services/user"]);
  });

  it("aplica el tsconfig más cercano al archivo", () => {
    expect(resolve("/repo/packages/api/src/x.ts", "~/users")).toEqual(["/repo/packages/api/src/users"]);
    expect(resolve("/repo/packages/api/src/x.ts", "@/users")).toEqual(["/repo/packages/api/src/@/users"]);
  });

  it("no toca rutas relativas", () => {
    expect(resolve("/repo/src/a.ts", "./b")).toEqual([]);
  });

  it("reconoce los nombres de config", () => {
    expect(["tsconfig.json", "tsconfig.app.json", "jsconfig.json"].every(isProjectConfigName)).toBe(true);
    expect(isProjectConfigName("package.json")).toBe(false);
  });
});

const REPOSITORY = "export function findById(id: string) { return db.query(`SELECT * FROM u WHERE id = ${id}`); }\n";
const CONTROLLER = 'import { findById } from "@/repository";\nexport function show(req: any) { return findById(req.params.id); }\n';

describe("alias en el escaneo", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function project(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "graphsast-alias-"));
    dirs.push(root);
    mkdirSync(path.join(root, ".git"));
    for (const [rel, code] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), code);
    }
    return root;
  }

  it("CLI: el tsconfig de la raíz vale aunque se escanee solo src/", () => {
    const root = project({
      "tsconfig.json": '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
      "src/repository.ts": REPOSITORY,
      "src/controller.ts": CONTROLLER,
    });
    const r = scanPaths([path.join(root, "src")]);
    expect(r.totals.crossFileCalls).toBe(1);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.source.file).toBe("controller.ts");
    expect(r.findings[0]!.source.name).toBe("req");
  });

  it("CLI: extends hacia un tsconfig base", () => {
    const root = project({
      "tsconfig.base.json": '{ "compilerOptions": { "paths": { "@/*": ["./app/src/*"] } } }',
      "app/tsconfig.json": '{ "extends": "../tsconfig.base.json" }',
      "app/src/repository.ts": REPOSITORY,
      "app/src/controller.ts": CONTROLLER,
    });
    const r = scanPaths([path.join(root, "app")]);
    expect(r.totals.crossFileCalls).toBe(1);
    expect(r.findings[0]!.source.file).toBe("src/controller.ts");
  });

  it("web: los tsconfig que vienen entre los archivos se usan y no se cuentan como archivos", () => {
    const r = scanFiles([
      { path: "app/tsconfig.json", content: '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }' },
      { path: "app/src/repository.ts", content: REPOSITORY },
      { path: "app/src/controller.ts", content: CONTROLLER },
    ]);
    expect(r.totals.files).toBe(2);
    expect(r.totals.crossFileCalls).toBe(1);
    expect(r.findings[0]!.source.file).toBe("app/src/controller.ts");
  });

  it("sin tsconfig el alias no se resuelve", () => {
    const r = scanFiles([
      { path: "src/repository.ts", content: REPOSITORY },
      { path: "src/controller.ts", content: CONTROLLER },
    ]);
    expect(r.totals.crossFileCalls).toBe(0);
  });
});

describe("import() dinámico", () => {
  it("const m = await import('./x') se resuelve como namespace", () => {
    const r = scanFiles([
      { path: "repository.ts", content: REPOSITORY },
      {
        path: "controller.ts",
        content: 'export async function show(req: any) { const m = await import("./repository"); return m.findById(req.params.id); }\n',
      },
    ]);
    expect(r.totals.crossFileCalls).toBe(1);
    expect(r.findings[0]!.source.name).toBe("req");
  });

  it("const { f } = await import('./x') se resuelve por nombre", () => {
    const r = scanFiles([
      { path: "repository.ts", content: REPOSITORY },
      {
        path: "controller.ts",
        content: 'export async function show(req: any) { const { findById } = await import("./repository"); return findById(req.params.id); }\n',
      },
    ]);
    expect(r.totals.crossFileCalls).toBe(1);
  });
});
