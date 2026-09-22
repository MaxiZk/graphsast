import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type HttpServer, type Logger, type Plugin } from "vite";
import {
  API_HOST,
  DEFAULT_API_PORT,
  resolveLocalNeo4j,
  startApiServer,
} from "@graphsast/core";

const dir = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = Number(process.env.GRAPHSAST_API_PORT ?? DEFAULT_API_PORT);
const API_URL = `http://${API_HOST}:${API_PORT}`;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** ¿Lo que responde en API_URL es una API de GraphSAST? */
async function isGraphsastApi(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/health`);
    const body = (await res.json()) as { service?: string };
    return body.service === "graphsast";
  } catch {
    return false;
  }
}

/**
 * La interfaz consume la API local de `graphsast serve` a través del proxy
 * de Vite. Si ya hay una levantada en el puerto se reutiliza; si no, se
 * levanta una en este mismo proceso.
 */
function graphsastApi(): Plugin {
  let api: Server | null = null;

  async function ensureApi(logger: Logger): Promise<void> {
    const neo4j = await resolveLocalNeo4j();
    if (neo4j.warning) logger.warn(`GraphSAST: ${neo4j.warning}`);
    try {
      api = await startApiServer({
        port: API_PORT,
        root: process.env.INIT_CWD ?? process.cwd(),
        driver: neo4j.driver,
      });
      logger.info(`  GraphSAST API: ${API_URL}`);
    } catch (err) {
      await neo4j.driver?.close();
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE" && await isGraphsastApi()) {
        logger.info(`  GraphSAST API: reutilizando ${API_URL}`);
        return;
      }
      throw err;
    }
  }

  const attach = async (server: { httpServer: HttpServer | null; config: { logger: Logger } }) => {
    await ensureApi(server.config.logger);
    server.httpServer?.once("close", () => api?.close());
  };

  return {
    name: "graphsast-api",
    // El proxy reenvía a la API todo lo que llega a Vite: si Vite escuchara en
    // la red (`--host`), la API quedaría expuesta a través de él.
    configResolved(config) {
      if (config.command !== "serve") return;
      for (const host of [config.server.host, config.preview.host]) {
        if (host !== undefined && !(typeof host === "string" && LOOPBACK.has(host))) {
          throw new Error(
            `GraphSAST: la interfaz solo puede escuchar en ${API_HOST} `
            + `(se pidió host=${String(host)}). El código analizado no sale de la máquina.`,
          );
        }
      }
    },
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

const proxy = { "/api": { target: API_URL, changeOrigin: true } };

export default defineConfig({
  root: dir,
  plugins: [graphsastApi()],
  server: { host: API_HOST, port: 5173, proxy },
  preview: { host: API_HOST, proxy },
  ssr: {
    noExternal: ["@graphsast/core", "neo4j-driver"],
  },
});
