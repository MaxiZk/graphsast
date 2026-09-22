import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import type { Driver } from "neo4j-driver";
import { scanPaths } from "../scan/scan.js";
import { createNeo4jDriver, verifyNeo4j } from "../store/neo4j.js";
import { getCatalogBundle } from "../taint/rules.js";
import { VERSION } from "../version.js";
import { analyzeCode } from "./analyze-code.js";
import { PathRejectedError, resolveInsideRoot } from "./paths.js";

/**
 * Única interfaz en la que escucha la API. No es configurable a propósito:
 * el código analizado no sale de la máquina del usuario.
 */
export const API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 5174;
/** Tope del cuerpo de una petición (el CLI omite archivos de más de 1 MB). */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_FILE_LABEL = 255;

/** Nombres de host aceptados en el header Host (defensa contra DNS rebinding). */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface ApiOptions {
  /** Directorio de trabajo permitido para los análisis por ruta. */
  root: string;
  /** Neo4j opcional. Ver `resolveLocalNeo4j`. */
  driver?: Driver | null;
  maxBodyBytes?: number;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/, "");
  return a === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** ¿La URI (p. ej. de Neo4j) apunta a esta máquina? */
export function isLoopbackUri(uri: string): boolean {
  try {
    const host = new URL(uri).hostname.toLowerCase();
    return host === "localhost" || host === "[::1]" || isLoopbackAddress(host);
  } catch {
    return false;
  }
}

/**
 * Driver de Neo4j solo si `NEO4J_URI` está definido y apunta a loopback.
 * El grafo persistido incluye fragmentos del código analizado: mandarlo a
 * otra máquina rompería la garantía de que el código no sale del equipo.
 */
export async function resolveLocalNeo4j(): Promise<{ driver: Driver | null; warning?: string }> {
  const uri = process.env.NEO4J_URI;
  if (!uri) return { driver: null };
  if (!isLoopbackUri(uri)) {
    return {
      driver: null,
      warning: `NEO4J_URI (${uri}) no apunta a esta máquina; se ignora y se usa el `
        + `motor en memoria para que el código no salga del equipo.`,
    };
  }
  try {
    const driver = await createNeo4jDriver();
    if (await verifyNeo4j(driver)) return { driver };
    await driver.close();
  } catch {
    /* Neo4j es opcional */
  }
  return { driver: null, warning: `No se pudo conectar a Neo4j en ${uri}; se usa el motor en memoria.` };
}

function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(hostHeader.trim().toLowerCase());
  return match ? match[1]! : null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(json);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const tooLarge = () => new HttpError(413, `El cuerpo supera el límite de ${limit} bytes.`);
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(tooLarge());

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function catalogPayload() {
  const entries = getCatalogBundle().entries;
  const families = entries.map((e) => ({
    id: `cwe-${e.cwe}`,
    cwe: e.cwe,
    name: e.name,
    description: e.description ?? "",
    sinks: e.sinks.length,
    sanitizers: e.sanitizers.length,
  }));
  return {
    families,
    totals: {
      families: families.length,
      sinks: families.reduce((n, f) => n + f.sinks, 0),
      sanitizers: families.reduce((n, f) => n + f.sanitizers, 0),
    },
  };
}

type Route = {
  method: "GET" | "POST";
  handle: (req: IncomingMessage) => Promise<unknown> | unknown;
};

/** Manejador HTTP de la API. Todo lo que no sea `/api/*` conocido da 404. */
export function createApiHandler(options: ApiOptions) {
  const root = path.resolve(options.root);
  const limit = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const driver = options.driver ?? undefined;

  async function analyze(req: IncomingMessage): Promise<unknown> {
    // Exigir JSON obliga al navegador a hacer preflight CORS, que esta API no
    // responde: una página web ajena no puede disparar análisis.
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
      throw new HttpError(415, "Content-Type debe ser application/json.");
    }
    const raw = await readBody(req, limit);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "El cuerpo no es JSON válido.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "El cuerpo debe ser un objeto JSON.");
    }
    const { code, path: target, file } = body as Record<string, unknown>;
    if ((code === undefined) === (target === undefined)) {
      throw new HttpError(400, "Enviar exactamente uno de: code, path.");
    }

    if (code !== undefined) {
      if (typeof code !== "string") throw new HttpError(400, "code debe ser un string.");
      if (file !== undefined && (typeof file !== "string" || file.length > MAX_FILE_LABEL)) {
        throw new HttpError(400, `file debe ser un string de hasta ${MAX_FILE_LABEL} caracteres.`);
      }
      return analyzeCode(code, (file as string | undefined) || "input.ts", { driver });
    }

    const abs = resolveInsideRoot(root, target);
    const result = scanPaths([abs]);
    if (result.totals.files === 0) {
      throw new HttpError(400, "No hay archivos analizables en esa ruta.");
    }
    return result;
  }

  const routes: Record<string, Route> = {
    "/api/health": {
      method: "GET",
      handle: () => ({
        status: "ok",
        service: "graphsast",
        version: VERSION,
        engine: driver ? "neo4j" : "memory",
        root,
      }),
    },
    "/api/catalog": { method: "GET", handle: catalogPayload },
    "/api/analyze": { method: "POST", handle: analyze },
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        throw new HttpError(403, "Solo se aceptan conexiones locales.");
      }
      const hostname = hostnameOf(req.headers.host);
      if (!hostname || !LOOPBACK_HOSTNAMES.has(hostname)) {
        throw new HttpError(403, "Host no permitido.");
      }
      const { pathname } = new URL(req.url ?? "/", `http://${API_HOST}`);
      const route = routes[pathname];
      if (!route) throw new HttpError(404, "Endpoint desconocido.");
      if (req.method !== route.method) {
        res.setHeader("Allow", route.method);
        throw new HttpError(405, `Método no permitido; usar ${route.method}.`);
      }
      send(res, 200, await route.handle(req));
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError || err instanceof PathRejectedError) {
        if (err.status === 413) res.setHeader("Connection", "close");
        send(res, err.status, { error: err.message });
        return;
      }
      send(res, 500, { error: `Error interno: ${err instanceof Error ? err.message : String(err)}` });
    }
  };
}

/** Levanta la API en 127.0.0.1. Con `port: 0` el sistema elige un puerto libre. */
export function startApiServer(options: ApiOptions & { port?: number }): Promise<Server> {
  const server = http.createServer(createApiHandler(options));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? DEFAULT_API_PORT, API_HOST, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
