import neo4j, { type Driver, type Session } from "neo4j-driver";
import type { IRGraph } from "../ir/types.js";
import type { TaintFinding, TaintRoles } from "../taint/types.js";
import {
  nodeProperties,
  parseTaintRows,
  TAINT_PATH_CYPHER,
} from "./cypher.js";

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

export async function persistGraph(
  driver: Driver,
  graph: IRGraph,
  roles: TaintRoles,
  database?: string,
): Promise<void> {
  const session = driver.session({ database });
  try {
    await session.executeWrite(async (tx) => {
      await tx.run("MATCH (n:GSNode) DETACH DELETE n");
      for (const node of graph.nodes) {
        await tx.run(
          `CREATE (n:GSNode {
            id: $id, kind: $kind, name: $name, code: $code,
            file: $file, line: $line, col: $col, callee: $callee,
            taintRole: $taintRole
          })`,
          nodeProperties(node, roles),
        );
      }
      for (const edge of graph.edges) {
        await tx.run(
          `MATCH (a:GSNode {id: $from}), (b:GSNode {id: $to})
           CREATE (a)-[r:${edge.kind}]->(b)`,
          { from: edge.from, to: edge.to },
        );
      }
    });
  } finally {
    await session.close();
  }
}

export async function queryTaintPaths(
  driver: Driver,
  database?: string,
): Promise<TaintFinding[]> {
  const session = driver.session({ database });
  try {
    const result = await session.run(TAINT_PATH_CYPHER);
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
