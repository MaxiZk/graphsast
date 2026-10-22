import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { formatGithubReport, runGithub, type GithubManifest } from "./run-github.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = process.env.GITHUB_EVAL_MANIFEST
  ?? path.resolve(MODULE_DIR, "../../../../../eval-github.json");
const cacheRoot = process.env.GITHUB_EVAL_CACHE ?? path.join(tmpdir(), "graphsast-github");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GithubManifest;

process.stderr.write(
  `GraphSAST — evaluación sobre proyectos de GitHub\n`
  + `Proyectos: ${manifest.projects.length}\nCopias: ${cacheRoot}\n\n`,
);

const results = runGithub(manifest, cacheRoot, ["params", "catalog", "baseline"]);
process.stdout.write(`${formatGithubReport(results)}\n`);

if (process.env.GITHUB_EVAL_JSON) {
  writeFileSync(process.env.GITHUB_EVAL_JSON, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  process.stderr.write(`JSON escrito en ${process.env.GITHUB_EVAL_JSON}\n`);
}
