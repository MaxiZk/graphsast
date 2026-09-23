import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** El cargador del catálogo del core, que lee `catalog/*.json` del disco. */
const CORE_CATALOG_LOADER = /[\\/]core[\\/]dist[\\/]catalog[\\/]load\.js$/;

/**
 * El análisis corre en el navegador (ver `src/analysis.worker.ts`), donde no
 * hay disco: este plugin reemplaza el cargador del catálogo del core por
 * `src/catalog-browser.ts`, que empaqueta los mismos JSON. El resto del core
 * se usa tal cual.
 */
function browserCatalog(): Plugin {
  return {
    name: "graphsast-browser-catalog",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !source.endsWith("/catalog/load.js")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || !CORE_CATALOG_LOADER.test(resolved.id)) return null;
      return path.join(dir, "src/catalog-browser.ts");
    },
  };
}

export default defineConfig({
  root: dir,
  plugins: [browserCatalog()],
  worker: {
    format: "es",
    plugins: () => [browserCatalog()],
  },
});
