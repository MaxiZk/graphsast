import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect, type Plugin } from "vite";
import type { Driver } from "neo4j-driver";
import {
  analyzeGraph,
  analyzeWithEngine,
  buildAnalysisReport,
  createNeo4jDriver,
  getCatalogBundle,
  getRuleLabels,
  getTaintRoles,
  verifyNeo4j,
} from "@graphsast/core";
import type { IRGraph, TaintRoles } from "@graphsast/core";

const dir = path.dirname(fileURLToPath(import.meta.url));

let neo4jDriver: Driver | null | undefined;

async function resolveNeo4j(): Promise<Driver | null> {
  if (neo4jDriver !== undefined) return neo4jDriver;
  if (!process.env.NEO4J_URI) {
    neo4jDriver = null;
    return null;
  }
  try {
    const driver = await createNeo4jDriver();
    if (await verifyNeo4j(driver)) {
      neo4jDriver = driver;
      return driver;
    }
    await driver.close();
  } catch {
    /* Neo4j opcional en dev */
  }
  neo4jDriver = null;
  return null;
}

/** Fallback si el bundle no exporta getTaintRoles (caché vieja). */
function rolesForGraph(graph: IRGraph): TaintRoles {
  return getTaintRoles(graph);
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function countEdges(edges: { kind: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of edges) {
    out[e.kind] = (out[e.kind] ?? 0) + 1;
  }
  return out;
}

function analyzeMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (req.url !== "/api/analyze" || req.method !== "POST") {
      next();
      return;
    }

    const started = performance.now();
    try {
      const body = JSON.parse(await readBody(req)) as {
        code?: string;
        file?: string;
      };
      const code = body.code ?? "";
      const file = body.file ?? "input.ts";
      const graph = analyzeGraph(code, file);
      const driver = await resolveNeo4j();
      const { engine, findings } = await analyzeWithEngine(graph, { driver: driver ?? undefined });
      const roles = rolesForGraph(graph);
      const elapsedMs = Math.round(performance.now() - started);
      const lineCount = code.split("\n").length;
      const rules = getRuleLabels();
      const catalog = getCatalogBundle();

      const report = buildAnalysisReport({
        code,
        file,
        engine,
        findings,
        graph,
        elapsedMs,
        rules,
        catalog,
      });

      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          graph,
          findings,
          roles,
          engine,
          report,
          stats: {
            elapsedMs,
            lineCount,
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            edgeKinds: countEdges(graph.edges),
            findingCount: findings.length,
          },
          rules,
          catalog: catalog.entries.map((e) => ({
            cwe: e.cwe,
            name: e.name,
            sinks: e.sinks.length,
            sanitizers: e.sanitizers.length,
          })),
        }),
      );
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: String(err) }));
    }
  };
}

function graphsastApi(): Plugin {
  const attach = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use(analyzeMiddleware());
  };
  return {
    name: "graphsast-analyze-api",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  root: dir,
  plugins: [graphsastApi()],
  server: { port: 5173 },
  ssr: {
    noExternal: ["@graphsast/core", "neo4j-driver"],
  },
});
