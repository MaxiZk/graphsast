import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { discoverFiles } from "../../scan/files.js";
import {
  ensureCheckout,
  formatNodeGoatReport,
  runNodeGoat,
  type NodeGoatManifest,
} from "./run-nodegoat.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = process.env.NODEGOAT_MANIFEST
  ?? path.resolve(MODULE_DIR, "../../../../../eval-nodegoat.json");
const cacheRoot = process.env.NODEGOAT_CACHE ?? path.join(tmpdir(), "graphsast-nodegoat");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as NodeGoatManifest;
const root = ensureCheckout(manifest, cacheRoot);

const lines = discoverFiles(root, { exclude: manifest.scan.exclude, gitignore: false })
  .reduce((n, f) => n + readFileSync(f, "utf8").split("\n").length, 0);

process.stderr.write(
  `GraphSAST — validación sobre OWASP NodeGoat\n`
  + `Commit: ${manifest.commit}\nCopia: ${root}\n`
  + `Vulnerabilidades etiquetadas: ${manifest.vulnerabilities.length}\n\n`,
);

const results = runNodeGoat(manifest, root);
process.stdout.write(`${formatNodeGoatReport(results, lines)}\n`);

if (process.env.NODEGOAT_JSON) {
  writeFileSync(process.env.NODEGOAT_JSON, `${JSON.stringify({ commit: manifest.commit, lines, results }, null, 2)}\n`, "utf8");
  process.stderr.write(`\nJSON escrito en ${process.env.NODEGOAT_JSON}\n`);
}
