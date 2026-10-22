import { loadCatalogBundle } from "../catalog/load.js";
import { labelsFromCatalog, rulesFromCatalog, type SourceMode } from "../catalog/rules.js";
import type { CatalogBundle, CatalogLabels } from "../catalog/types.js";
import type { Language } from "../lang/language.js";
import type { TaintRule } from "./types.js";

let cachedBundle: CatalogBundle | null = null;
const cachedRules = new Map<string, TaintRule[]>();
let cachedLabels: CatalogLabels | null = null;

export function getCatalogBundle(): CatalogBundle {
  if (!cachedBundle) cachedBundle = loadCatalogBundle();
  return cachedBundle;
}

/** Reglas según el modelo de source (ver `SourceMode`) y el lenguaje del código. */
export function taintRulesFor(mode: SourceMode = "params", language: Language = "javascript"): TaintRule[] {
  const key = `${mode}\t${language}`;
  let rules = cachedRules.get(key);
  if (!rules) {
    rules = rulesFromCatalog(getCatalogBundle(), mode, language);
    cachedRules.set(key, rules);
  }
  return rules;
}

/** Reglas de taint desde el catálogo CWE (catalog/*.json), con el modelo de source por defecto. */
export function defaultTaintRules(language: Language = "javascript"): TaintRule[] {
  return taintRulesFor("params", language);
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
