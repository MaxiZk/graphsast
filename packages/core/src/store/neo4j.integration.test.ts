import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Driver } from "neo4j-driver";
import { analyzeGraph } from "../index.js";
import { analyzeWithEngine } from "../engine/analyze.js";
import { BENCHMARK_CORPUS } from "../eval/benchmark/corpus.js";
import { analyzeTaint } from "../taint/analyzer.js";
import type { TaintFinding } from "../taint/types.js";
import { createNeo4jDriver } from "./neo4j.js";

/**
 * Motor Neo4j contra una base real. Solo corre con `NEO4J_URI` definido
 * (`npm run neo4j:up` en local; un service container en el CI). Usa la base
 * por defecto, así que no conviene apuntarlo a una con datos propios.
 */
const enabled = Boolean(process.env.NEO4J_URI);

const pairs = (findings: TaintFinding[]) =>
  [...new Set(findings.map((f) => `${f.sourceId} -> ${f.sinkId} CWE-${f.cwe}`))].sort();

describe.skipIf(!enabled)("motor Neo4j (base real)", () => {
  let driver: Driver;

  beforeAll(async () => {
    driver = await createNeo4jDriver();
  });
  afterAll(async () => {
    await driver?.close();
  });

  const count = async (cypher: string): Promise<number> => {
    const session = driver.session();
    try {
      const r = await session.run(cypher);
      return Number(r.records[0]!.get(0));
    } finally {
      await session.close();
    }
  };

  it("da los mismos hallazgos que el motor en memoria en todo el benchmark", async () => {
    for (const c of BENCHMARK_CORPUS) {
      const graph = analyzeGraph(c.code, c.file ?? `${c.id.toLowerCase()}.ts`);
      const neo = await analyzeWithEngine(graph, { driver });
      expect(neo.engine).toBe("neo4j");
      expect(pairs(neo.findings), c.id).toEqual(pairs(analyzeTaint(graph)));
    }
  }, 120_000);

  it("dos análisis simultáneos no se pisan", async () => {
    const vulnerable = BENCHMARK_CORPUS.find((c) => c.label === "vulnerable")!;
    const safe = BENCHMARK_CORPUS.find((c) => c.label === "safe")!;
    for (let i = 0; i < 5; i++) {
      // Mismo nombre de archivo: los ids de nodo coinciden entre los dos grafos.
      const gv = analyzeGraph(vulnerable.code, "input.ts");
      const gs = analyzeGraph(safe.code, "input.ts");
      const [a, b] = await Promise.all([
        analyzeWithEngine(gv, { driver }),
        analyzeWithEngine(gs, { driver }),
      ]);
      expect(pairs(a.findings)).toEqual(pairs(analyzeTaint(gv)));
      expect(b.findings).toEqual([]);
    }
  }, 60_000);

  it("no deja nodos del análisis en la base", async () => {
    const graph = analyzeGraph("function h(req) { db.query(req.body.q); }", "left.ts");
    await analyzeWithEngine(graph, { driver });
    expect(await count("MATCH (n:GSNode {file: 'left.ts'}) RETURN count(n)")).toBe(0);
  });

  it("crea el índice por análisis e id", async () => {
    expect(await count("SHOW INDEXES YIELD name WHERE name = 'gsnode_run_id' RETURN count(*)")).toBe(1);
  });
});
