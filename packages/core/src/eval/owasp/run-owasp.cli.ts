import path from "node:path";
import { tmpdir } from "node:os";
import { loadNodeLanguages } from "../../lang/node.js";
import { ensureCheckout } from "../nodegoat/run-nodegoat.js";
import { formatOwasp, OWASP_BENCHMARK, runOwasp } from "./run-owasp.js";

const cacheRoot = process.env.OWASP_BENCHMARK_CACHE ?? path.join(tmpdir(), "graphsast-owasp");

await loadNodeLanguages();
process.stderr.write(`GraphSAST — OWASP Benchmark Java ${OWASP_BENCHMARK.commit.slice(0, 7)}\nCopia: ${cacheRoot}\n\n`);
const root = ensureCheckout(OWASP_BENCHMARK, cacheRoot);
for (const sources of ["params", "catalog"] as const) {
  process.stdout.write(`Modo ${sources}\n${formatOwasp(runOwasp(root, sources))}\n\n`);
}
