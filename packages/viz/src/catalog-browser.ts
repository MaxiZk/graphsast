/// <reference types="vite/client" />
import type { CatalogBundle, CweCatalogEntry } from "@graphsast/core/browser";

/**
 * Reemplazo de `@graphsast/core/dist/catalog/load.js` para el navegador (lo
 * inyecta `vite.config.ts`). El original lee `catalog/*.json` del disco; acá
 * los mismos archivos entran en el bundle, así que la web y el CLI analizan
 * con el mismo catálogo sin copiarlo.
 */
const ENTRIES = import.meta.glob<CweCatalogEntry>("../../../catalog/cwe-*.json", {
  eager: true,
  import: "default",
});

const MANIFEST = import.meta.glob<{ entries: string[] }>("../../../catalog/index.json", {
  eager: true,
  import: "default",
})["../../../catalog/index.json"]!;

const CATALOG_DIR = "catalog";

export function defaultCatalogDir(): string {
  return CATALOG_DIR;
}

export function loadCatalogEntry(filePath: string): CweCatalogEntry {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  const entry = ENTRIES[`../../../catalog/${name}`];
  if (!entry) throw new Error(`Entrada de catálogo inexistente: ${name}`);
  return entry;
}

/** Mismo orden que el manifiesto, como `loadCatalogBundle` del core. */
export function loadCatalogBundle(): CatalogBundle {
  return {
    dir: CATALOG_DIR,
    entries: MANIFEST.entries.map((name) => loadCatalogEntry(name)),
  };
}
