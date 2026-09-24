import { writeFileSync } from "node:fs";
import { compareWithBaseline, formatComparison } from "./run-baseline.js";
import { corpusStats } from "../benchmark/corpus.js";

const stats = corpusStats();
const comparison = compareWithBaseline();

console.log("GraphSAST frente a la línea de base por patrones");
console.log(
  `Banco sintético: ${stats.total} casos (${stats.vulnerable} vulnerables, ${stats.safe} seguros)`,
);
console.log("");
console.log(formatComparison(comparison));

if (process.env.BASELINE_JSON) {
  writeFileSync(process.env.BASELINE_JSON, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
  console.error(`\nJSON escrito en ${process.env.BASELINE_JSON}`);
}
