import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runCveBenchmark, formatCveReport } from "./run-cve.js";
import type { CveCorpus } from "./types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS = path.resolve(MODULE_DIR, "../../../../../eval-cve-corpus.json");

const corpusPath = process.env.CVE_CORPUS ?? DEFAULT_CORPUS;
const cacheRoot = process.env.CVE_CACHE ?? path.join(tmpdir(), "graphsast-cve-cache");
const limit = process.env.CVE_LIMIT ? Number(process.env.CVE_LIMIT) : undefined;

if (!existsSync(corpusPath)) {
  process.stderr.write(
    `No existe el manifiesto ${corpusPath}.\n`
    + `Generalo primero con:  npm run cve:fetch\n`,
  );
  process.exit(2);
}

const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as CveCorpus;
const cases = limit ? corpus.cases.slice(0, limit) : corpus.cases;
mkdirSync(cacheRoot, { recursive: true });

process.stderr.write(
  `GraphSAST — validación sobre vulnerabilidades reales\n`
  + `Fuente: ${corpus.source}\n`
  + `Manifiesto congelado: ${corpus.fetchedAt}\n`
  + `Casos: ${cases.length}  ·  caché: ${cacheRoot}\n\n`,
);

const report = await runCveBenchmark(cases, cacheRoot, (done, total, r) => {
  const mark = r.outcome === "detected" ? "✓" : r.outcome === "missed" ? "·" : "!";
  process.stderr.write(
    `[${String(done).padStart(2)}/${total}] ${mark} ${r.package}@${r.vulnerableVersion}`
    + `${r.error ? ` — ${r.error.slice(0, 50)}` : ""}\n`,
  );
});

process.stdout.write(`\n${formatCveReport(report)}\n`);

if (process.env.CVE_JSON) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.CVE_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stderr.write(`\nJSON escrito en ${process.env.CVE_JSON}\n`);
}
