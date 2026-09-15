import { runBenchmark, formatReportTable } from "./run-benchmark.js";
import { corpusStats } from "./benchmark/corpus.js";
import type { BenchmarkCaseResult } from "./types.js";

const report = runBenchmark();
const stats = corpusStats();

console.log("GraphSAST — benchmark de validación");
console.log(
  `Corpus: ${stats.total} casos (${stats.vulnerable} vulnerables, ${stats.safe} seguros, ${stats.lines} líneas)`,
);
console.log("");
console.log(formatReportTable(report));
console.log("");
console.log(JSON.stringify(report, null, 2));

const failed = report.cases.filter((c: BenchmarkCaseResult) => !c.correct);
if (failed.length > 0) {
  console.error(`\n${failed.length} caso(s) fallaron:`);
  for (const c of failed) {
    console.error(`  ${c.id}: esperado=${c.label}, findings=${c.findings}`);
  }
  process.exitCode = 1;
}
