import { loadCatalogBundle } from "../catalog/load.js";
import { labelsFromCatalog, rulesFromCatalog } from "../catalog/rules.js";
import type { CatalogBundle, CatalogLabels } from "../catalog/types.js";
import type { TaintRule } from "./types.js";

let cachedBundle: CatalogBundle | null = null;
let cachedRules: TaintRule[] | null = null;
let cachedLabels: CatalogLabels | null = null;

export function getCatalogBundle(): CatalogBundle {
  if (!cachedBundle) cachedBundle = loadCatalogBundle();
  return cachedBundle;
}

/** Reglas de taint desde el catálogo CWE (catalog/*.json). */
export function defaultTaintRules(): TaintRule[] {
  if (!cachedRules) cachedRules = rulesFromCatalog(getCatalogBundle());
  return cachedRules;
}

/** Etiquetas legibles por id de regla (para UI e informes). */
export function getRuleLabels(): CatalogLabels {
  if (!cachedLabels) cachedLabels = labelsFromCatalog(getCatalogBundle());
  return cachedLabels;
}

/** @deprecated usar getRuleLabels() */
export const RULE_LABELS: CatalogLabels = new Proxy({} as CatalogLabels, {
  get(_t, prop: string) {
    return getRuleLabels()[prop];
  },
  ownKeys() {
    return Reflect.ownKeys(getRuleLabels());
  },
  getOwnPropertyDescriptor(_t, prop) {
    const labels = getRuleLabels();
    if (prop in labels) {
      return { configurable: true, enumerable: true, value: labels[prop as string] };
    }
    return undefined;
  },
});
