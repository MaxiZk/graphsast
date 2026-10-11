import { randomUUID } from "node:crypto";
import neo4j, { type Driver, type Session } from "neo4j-driver";
import type { TaintAnnotations } from "../taint/analyzer.js";
import type { IRGraph } from "../ir/types.js";
import type { TaintFinding, TaintRoles } from "../taint/types.js";
import {
  EDGE_KINDS,
  nodeProperties,
  parseTaintRows,
  taintPathCypher,
} from "./cypher.js";
import { DEFAULT_MAX_DEPTH } from "../taint/reach.js";

export interface Neo4jConfig {
  uri?: string;
  user?: string;
  password?: string;
  database?: string;
}

export function neo4jConfigFromEnv(): Neo4jConfig {
  return {
    uri: process.env.NEO4J_URI ?? "bolt://localhost:7687",
    user: process.env.NEO4J_USER ?? "neo4j",
    password: process.env.NEO4J_PASSWORD ?? "graphsast-dev",
    database: process.env.NEO4J_DATABASE ?? "neo4j",
  };
}

export async function createNeo4jDriver(config: Neo4jConfig = {}): Promise<Driver> {
  const merged = { ...neo4jConfigFromEnv(), ...config };
  return neo4j.driver(
    merged.uri!,
    neo4j.auth.basic(merged.user!, merged.password!),
  );
}

export async function verifyNeo4j(driver: Driver): Promise<boolean> {
  const session = driver.session();
  try {
    await session.run("RETURN 1 AS ok");
    return true;
  } catch {
    return false;
  } finally {
    await session.close();
  }
}

/** Nodos o aristas por sentencia `UNWIND`: una ida y vuelta por lote, no por nodo. */
const BATCH = 5_000;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH));
  return out;
}

/** Drivers a los que ya se les creó el índice, para no repetirlo por análisis. */
const schemaReady = new WeakSet<Driver>();

/**
 * Índice compuesto por análisis e id: sin él, cada `MATCH` de una arista
 * recorre todos los nodos. `IF NOT EXISTS` lo hace idempotente.
 */
export async function ensureSchema(driver: Driver, database?: string): Promise<void> {
  if (schemaReady.has(driver)) return;
  const session = driver.session({ database });
  try {
    await session.run("CREATE INDEX gsnode_run_id IF NOT EXISTS FOR (n:GSNode) ON (n.run, n.id)");
    await session.run("CALL db.awaitIndexes(60)");
    schemaReady.add(driver);
  } finally {
    await session.close();
  }
}

/**
 * Persiste el grafo como un análisis aparte (`run`) y devuelve su id. Cada
 * análisis vive solo con sus nodos: dos peticiones simultáneas no se pisan, y
 * la consulta se limita a uno con `queryTaintPaths(driver, db, run)`.
 */
export async function persistGraph(
  driver: Driver,
  graph: IRGraph,
  roles: TaintRoles,
  database?: string,
  annotations?: TaintAnnotations,
): Promise<string> {
  await ensureSchema(driver, database);
  const run = randomUUID();
  const nodes = graph.nodes.map((node) => ({ ...nodeProperties(node, roles, annotations), run }));
  const session = driver.session({ database });
  try {
    await session.executeWrite(async (tx) => {
      for (const batch of chunks(nodes)) {
        await tx.run("UNWIND $nodes AS props CREATE (n:GSNode) SET n = props", { nodes: batch });
      }
      // El tipo de una relación no puede ser un parámetro: una sentencia por
      // tipo, y solo los tipos conocidos.
      for (const kind of EDGE_KINDS) {
        const edges = graph.edges
          .filter((e) => e.kind === kind)
          .map((e) => ({ from: e.from, to: e.to, arg: e.arg ?? null }));
        for (const batch of chunks(edges)) {
          await tx.run(
            `UNWIND $edges AS e
             MATCH (a:GSNode {run: $run, id: e.from}), (b:GSNode {run: $run, id: e.to})
             CREATE (a)-[:${kind} {arg: e.arg}]->(b)`,
            { run, edges: batch },
          );
        }
      }
    });
  } finally {
    await session.close();
  }
  return run;
}

/** Borra los nodos y aristas de un análisis. */
export async function deleteRun(driver: Driver, run: string, database?: string): Promise<void> {
  const session = driver.session({ database });
  try {
    await session.executeWrite((tx) => tx.run("MATCH (n:GSNode {run: $run}) DETACH DELETE n", { run }));
  } finally {
    await session.close();
  }
}

/**
 * Caminos source → sink de un análisis (`run`), o de todo el grafo si se
 * omite. `maxDepth` fija el largo para todas las familias; `maxHops` es la
 * cota del patrón (ver `taintPathCypher`).
 */
export async function queryTaintPaths(
  driver: Driver,
  database?: string,
  run?: string,
  depth: { maxDepth?: number; maxHops?: number } = {},
): Promise<TaintFinding[]> {
  const session = driver.session({ database });
  try {
    const cypher = taintPathCypher(depth.maxDepth ?? depth.maxHops ?? DEFAULT_MAX_DEPTH);
    const result = await session.run(cypher, { run: run ?? null, maxDepth: depth.maxDepth ?? null });
    return parseTaintRows(result.records).map((row) => ({
      ...row,
      sanitized: false,
    }));
  } finally {
    await session.close();
  }
}

export async function withNeo4jSession<T>(
  driver: Driver,
  fn: (session: Session) => Promise<T>,
  database?: string,
): Promise<T> {
  const session = driver.session({ database });
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
