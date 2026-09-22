import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  API_HOST,
  isLoopbackUri,
  MAX_BODY_BYTES,
  startApiServer,
} from "./server.js";
import { resolveInsideRoot, PathRejectedError } from "./paths.js";

let base: string;
let root: string;
let outside: string;
let server: Server;
let port: number;

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: http.IncomingHttpHeaders;
}

function request(
  method: string,
  urlPath: string,
  opts: { body?: string | Buffer; headers?: Record<string, string> } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: API_HOST, port, method, path: urlPath, headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : {}, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const postJson = (body: unknown) =>
  request("POST", "/api/analyze", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), "graphsast-api-"));
  root = path.join(base, "proyecto");
  outside = path.join(base, "afuera");
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(
    path.join(root, "src", "users.js"),
    "function h(req){ db.query(`SELECT ${req.params.id}`); }\n",
  );
  writeFileSync(path.join(root, "README.md"), "# nada\n");
  writeFileSync(path.join(outside, "secreto.js"), "function h(req){ db.query(req.body); }\n");
  symlinkSync(outside, path.join(root, "enlace"));

  server = await startApiServer({ root, port: 0 });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(base, { recursive: true, force: true });
});

describe("API local", () => {
  it("escucha solo en 127.0.0.1", () => {
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
  });

  it("GET /api/health", async () => {
    const r = await request("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ok", service: "graphsast", engine: "memory" });
    expect(r.headers["content-type"]).toMatch(/application\/json/);
  });

  it("GET /api/catalog devuelve las familias activas con sus conteos", async () => {
    const r = await request("GET", "/api/catalog");
    expect(r.status).toBe(200);
    const families = r.body.families as { id: string; sinks: number; sanitizers: number }[];
    expect(families.map((f) => f.id)).toEqual(
      expect.arrayContaining(["cwe-89", "cwe-78", "cwe-79", "cwe-943"]),
    );
    for (const f of families) expect(f.sinks).toBeGreaterThan(0);
    const totals = r.body.totals as { families: number; sinks: number };
    expect(totals.families).toBe(families.length);
    expect(totals.sinks).toBe(families.reduce((n, f) => n + f.sinks, 0));
  });

  it("POST /api/analyze con codigo", async () => {
    const r = await postJson({ code: "function h(req){ db.query(req.body); }", file: "a.js" });
    expect(r.status).toBe(200);
    expect((r.body.findings as unknown[]).length).toBe(1);
    expect(r.body).toHaveProperty("graph");
    expect(r.body).toHaveProperty("verdict");
  });

  it("POST /api/analyze con una ruta dentro de la raiz", async () => {
    for (const p of ["src", "./src/users.js", path.join(root, "src")]) {
      const r = await postJson({ path: p });
      expect(r.status).toBe(200);
      expect((r.body.totals as { findings: number }).findings).toBe(1);
    }
  });

  it("rechaza ../ con 400", async () => {
    for (const p of ["../../etc/passwd", "../afuera", "src/../../afuera/secreto.js"]) {
      const r = await postJson({ path: p });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/fuera del directorio/);
    }
  });

  it("rechaza rutas absolutas externas con 400, existan o no", async () => {
    for (const p of ["/etc/passwd", path.join(outside, "secreto.js"), "/no/existe"]) {
      expect((await postJson({ path: p })).status).toBe(400);
    }
  });

  it("rechaza un enlace simbolico que apunta afuera con 400", async () => {
    const r = await postJson({ path: "enlace/secreto.js" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/enlace simbólico/);
  });

  it("404 si la ruta no existe dentro de la raiz", async () => {
    expect((await postJson({ path: "src/nope.js" })).status).toBe(404);
  });

  it("400 si la ruta no tiene archivos analizables", async () => {
    expect((await postJson({ path: "README.md" })).status).toBe(400);
  });

  it("413 si el cuerpo supera el limite", async () => {
    const big = JSON.stringify({ code: "x".repeat(MAX_BODY_BYTES) });
    const r = await request("POST", "/api/analyze", {
      body: big,
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status).toBe(413);
  });

  it("valida el cuerpo", async () => {
    expect((await postJson({})).status).toBe(400);
    expect((await postJson({ code: "x", path: "src" })).status).toBe(400);
    expect((await postJson({ code: 42 })).status).toBe(400);
    expect((await postJson({ path: "a\u0000b" })).status).toBe(400);
    expect((await postJson([1])).status).toBe(400);
    const bad = await request("POST", "/api/analyze", {
      body: "{no json",
      headers: { "Content-Type": "application/json" },
    });
    expect(bad.status).toBe(400);
  });

  it("415 sin Content-Type JSON (bloquea POST simples desde otra web)", async () => {
    const r = await request("POST", "/api/analyze", {
      body: JSON.stringify({ code: "x" }),
      headers: { "Content-Type": "text/plain" },
    });
    expect(r.status).toBe(415);
  });

  it("403 si el Host no es loopback (DNS rebinding)", async () => {
    const r = await request("GET", "/api/health", { headers: { Host: "evil.example:5174" } });
    expect(r.status).toBe(403);
    const ok = await request("GET", "/api/health", { headers: { Host: `localhost:${port}` } });
    expect(ok.status).toBe(200);
  });

  it("no emite cabeceras CORS", async () => {
    const r = await request("GET", "/api/health", { headers: { Origin: "https://evil.example" } });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("404 en endpoints desconocidos y 405 con el metodo equivocado", async () => {
    expect((await request("GET", "/api/nada")).status).toBe(404);
    expect((await request("GET", "/")).status).toBe(404);
    const r = await request("GET", "/api/analyze");
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe("POST");
  });
});

describe("resolveInsideRoot", () => {
  it("devuelve la ruta real dentro de la raiz", () => {
    expect(resolveInsideRoot(root, "src")).toBe(path.join(root, "src"));
  });

  it("lanza PathRejectedError con el status adecuado", () => {
    expect(() => resolveInsideRoot(root, "../afuera")).toThrow(PathRejectedError);
    try {
      resolveInsideRoot(root, "no-existe");
    } catch (err) {
      expect((err as PathRejectedError).status).toBe(404);
    }
  });
});

describe("isLoopbackUri", () => {
  it("acepta solo destinos locales", () => {
    expect(isLoopbackUri("bolt://localhost:7687")).toBe(true);
    expect(isLoopbackUri("bolt://127.0.0.1:7687")).toBe(true);
    expect(isLoopbackUri("neo4j://[::1]:7687")).toBe(true);
    expect(isLoopbackUri("neo4j+s://db.example.com:7687")).toBe(false);
    expect(isLoopbackUri("bolt://192.168.1.10:7687")).toBe(false);
    expect(isLoopbackUri("no es una uri")).toBe(false);
  });
});
