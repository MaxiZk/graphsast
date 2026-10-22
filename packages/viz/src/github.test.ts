import { describe, it, expect } from "vitest";
import { GithubImportError, importGithubRepo, parseGithubUrl, wantedPath } from "./github.js";

describe("parseGithubUrl", () => {
  it("acepta la URL del repositorio, sin protocolo, con .git o como dueño/repo", () => {
    const target = { owner: "appsecco", repo: "dvna" };
    expect(parseGithubUrl("https://github.com/appsecco/dvna")).toEqual(target);
    expect(parseGithubUrl("github.com/appsecco/dvna/")).toEqual(target);
    expect(parseGithubUrl("https://github.com/appsecco/dvna.git")).toEqual(target);
    expect(parseGithubUrl("  appsecco/dvna ")).toEqual(target);
    expect(parseGithubUrl("https://www.github.com/appsecco/dvna?tab=readme")).toEqual(target);
  });

  it("toma la rama y la carpeta de /tree/, y la carpeta del archivo de /blob/", () => {
    expect(parseGithubUrl("https://github.com/juice-shop/juice-shop/tree/develop/routes"))
      .toEqual({ owner: "juice-shop", repo: "juice-shop", ref: "develop", dir: "routes" });
    expect(parseGithubUrl("https://github.com/o/r/tree/main"))
      .toEqual({ owner: "o", repo: "r", ref: "main" });
    expect(parseGithubUrl("https://github.com/o/r/blob/main/src/app.js"))
      .toEqual({ owner: "o", repo: "r", ref: "main", dir: "src" });
  });

  it("rechaza lo que no es un repositorio de GitHub", () => {
    expect(parseGithubUrl("https://gitlab.com/o/r")).toBeNull();
    expect(parseGithubUrl("https://github.com/solo-un-dueño")).toBeNull();
    expect(parseGithubUrl("https://github.com/o/r/issues/3")).toBeNull();
    expect(parseGithubUrl("")).toBeNull();
  });
});

describe("wantedPath", () => {
  it("baja JS/TS, configuraciones de alias y archivos de exclusión, fuera de node_modules", () => {
    expect(wantedPath("src/app.ts", 100)).toBe(true);
    expect(wantedPath("tsconfig.json", 100)).toBe(true);
    expect(wantedPath("src/.gitignore", 10)).toBe(true);
    expect(wantedPath(".graphsastignore", 10)).toBe(true);
    expect(wantedPath("README.md", 100)).toBe(false);
    expect(wantedPath("node_modules/x/index.js", 100)).toBe(false);
    expect(wantedPath("big.js", 2_000_000)).toBe(false);
  });
});

/** fetch simulado: responde por URL; lo que no está, 404. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) return new Response("no", { status: 404 });
    const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200, headers: route.headers });
  }) as typeof fetch;
  return { fn, calls };
}

const API = "https://api.github.com/repos/o/r";
const RAW = "https://raw.githubusercontent.com/o/r/main";

describe("importGithubRepo", () => {
  const tree = {
    tree: [
      { path: "src", type: "tree" },
      { path: "src/app.js", type: "blob", size: 30 },
      { path: "src/db.ts", type: "blob", size: 20 },
      { path: "README.md", type: "blob", size: 5 },
      { path: "node_modules/x/index.js", type: "blob", size: 5 },
      { path: "tsconfig.json", type: "blob", size: 10 },
    ],
  };

  it("usa la rama por defecto y baja solo lo que el análisis usa", async () => {
    const { fn, calls } = fakeFetch({
      [API]: { body: { default_branch: "main" } },
      [`${API}/git/trees/main?recursive=1`]: { body: tree },
      [`${RAW}/src/app.js`]: { body: "db.query(req.query.id)" },
      [`${RAW}/src/db.ts`]: { body: "export {}" },
      [`${RAW}/tsconfig.json`]: { body: "{}" },
    });
    const progress: string[] = [];
    const result = await importGithubRepo({ owner: "o", repo: "r" }, { fetch: fn, onProgress: (_d, _t, p) => progress.push(p) });
    expect(result.target).toEqual({ owner: "o", repo: "r", ref: "main", dir: "" });
    expect(result.files.map((f) => f.path)).toEqual(["src/app.js", "src/db.ts", "tsconfig.json"]);
    expect(await result.files[0]!.file.text()).toBe("db.query(req.query.id)");
    expect(progress).toHaveLength(3);
    expect(calls.some((c) => c.includes("README") || c.includes("node_modules"))).toBe(false);
  });

  it("con una carpeta, las rutas quedan relativas a ella", async () => {
    const { fn } = fakeFetch({
      [`${API}/git/trees/main?recursive=1`]: { body: tree },
      [`${RAW}/src/app.js`]: { body: "a" },
      [`${RAW}/src/db.ts`]: { body: "b" },
    });
    const result = await importGithubRepo({ owner: "o", repo: "r", ref: "main", dir: "src" }, { fetch: fn });
    expect(result.files.map((f) => f.path)).toEqual(["app.js", "db.ts"]);
  });

  it("explica el repositorio inexistente o privado y el límite de la API", async () => {
    await expect(importGithubRepo({ owner: "o", repo: "r" }, { fetch: fakeFetch({}).fn }))
      .rejects.toThrow(/repositorios públicos/);
    const limited = fakeFetch({
      [API]: { status: 403, body: { message: "rate limit" }, headers: { "x-ratelimit-remaining": "0" } },
    });
    await expect(importGithubRepo({ owner: "o", repo: "r" }, { fetch: limited.fn }))
      .rejects.toThrow(/60 consultas por hora/);
  });

  it("un repositorio sin JS/TS es un error, no un análisis vacío", async () => {
    const { fn } = fakeFetch({
      [`${API}/git/trees/main?recursive=1`]: { body: { tree: [{ path: "main.go", type: "blob", size: 9 }] } },
    });
    await expect(importGithubRepo({ owner: "o", repo: "r", ref: "main" }, { fetch: fn }))
      .rejects.toBeInstanceOf(GithubImportError);
  });
});
