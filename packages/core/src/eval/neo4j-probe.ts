import {
  analyzeGraph,
  analyzeWithEngine,
  createNeo4jDriver,
  verifyNeo4j,
} from "../index.js";

const code = `function handler(input){ const q = input; db.query(q); }`;

async function main() {
  const driver = await createNeo4jDriver();
  const ok = await verifyNeo4j(driver);
  if (!ok) {
    console.log("neo4j: no disponible (docker compose up -d)");
    await driver.close();
    process.exitCode = 1;
    return;
  }

  const graph = analyzeGraph(code, "probe.ts");
  const memory = await analyzeWithEngine(graph);
  const neo = await analyzeWithEngine(graph, { driver });

  console.log("memory", { findings: memory.findings.length });
  console.log("neo4j", { findings: neo.findings.length });
  console.log(
    "parity",
    memory.findings.length === neo.findings.length ? "OK" : "MISMATCH",
  );

  await driver.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
