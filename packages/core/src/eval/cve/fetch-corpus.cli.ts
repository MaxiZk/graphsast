import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCveCorpus, SUPPORTED_CWES } from "./fetch-corpus.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(MODULE_DIR, "../../../../../eval-cve-corpus.json");

const perCwe = Number(process.argv[2] ?? 30);

process.stderr.write(
  `Consultando GitHub Security Advisories (npm, CWE ${SUPPORTED_CWES.join("/")})…\n`,
);

const corpus = await buildCveCorpus(SUPPORTED_CWES, perCwe);

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");

process.stderr.write(`\n${corpus.cases.length} caso(s) con par (vulnerable, corregida).\n`);
for (const c of corpus.cases) {
  process.stderr.write(
    `  ${c.ghsaId}  CWE-${c.cwe}  ${c.package}  ${c.vulnerableVersion} → ${c.fixedVersion}\n`,
  );
}
process.stderr.write(`\nManifiesto escrito en ${OUT}\n`);
