import { readFileSync } from "node:fs";
import path from "node:path";
import { discoverFiles, commonRoot } from "./files.js";
import { scanFiles, type ScanInput } from "./scan-files.js";
import type { ScanOptions, ScanResult } from "./types.js";

export { scanSource, toScanFindings } from "./scan-files.js";

/**
 * Escanea archivos y/o directorios del disco: descubre los archivos, los lee
 * y delega el análisis en `scanFiles` (ver ahí las fases y el alcance del
 * cruce entre archivos). Cada archivo se identifica por su ruta relativa a la
 * raíz común, con `/` en cualquier sistema operativo.
 */
export function scanPaths(
  targets: string[],
  options: ScanOptions = {},
): ScanResult {
  const root = commonRoot(targets);
  const seen = new Set<string>();
  const inputs: ScanInput[] = [];
  for (const target of targets) {
    for (const abs of discoverFiles(target, options)) {
      if (seen.has(abs)) continue;
      seen.add(abs);
      const rel = (path.relative(root, abs) || path.basename(abs)).split(path.sep).join("/");
      try {
        inputs.push({ path: rel, content: readFileSync(abs, "utf8") });
      } catch (err) {
        inputs.push({ path: rel, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return scanFiles(inputs, options, root);
}
