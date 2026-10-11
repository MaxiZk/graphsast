import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogBundle, CatalogManifest, CweCatalogEntry } from "./types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dónde está el catálogo. En el repositorio, `catalog/` de la raíz
 * (dist/catalog → ../../../../); instalado desde npm, la copia que `prepack`
 * mete en el paquete (dist/catalog → ../../catalog). Se prefiere el del
 * repositorio solo si es el monorepo de verdad: una copia vieja que haya
 * quedado en packages/core no puede tapar las ediciones del catálogo.
 */
export function defaultCatalogDir(): string {
  const repoRoot = path.resolve(MODULE_DIR, "../../../..");
  const inRepo = path.join(repoRoot, "catalog");
  if (existsSync(path.join(inRepo, "index.json")) && existsSync(path.join(repoRoot, "packages/core/package.json"))) {
    return inRepo;
  }
  return path.resolve(MODULE_DIR, "../../catalog");
}

export function loadCatalogEntry(filePath: string): CweCatalogEntry {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as CweCatalogEntry;
}

export function loadCatalogBundle(catalogDir = defaultCatalogDir()): CatalogBundle {
  const manifestPath = path.join(catalogDir, "index.json");
  if (!existsSync(manifestPath)) {
    return { dir: catalogDir, entries: [] };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CatalogManifest;
  const entries = manifest.entries.map((name) =>
    loadCatalogEntry(path.join(catalogDir, name)),
  );
  return { dir: catalogDir, entries };
}
