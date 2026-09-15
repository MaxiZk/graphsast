import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogBundle, CatalogManifest, CweCatalogEntry } from "./types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Raíz del monorepo: packages/core/src/catalog → ../../../../ */
export function defaultCatalogDir(): string {
  return path.resolve(MODULE_DIR, "../../../../catalog");
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
