export interface CweCatalogEntry {
  cwe: number;
  name: string;
  sources: string[];
  sinks: string[];
  sanitizers: string[];
}

export interface CatalogManifest {
  version: number;
  entries: string[];
}

export interface CatalogBundle {
  dir: string;
  entries: CweCatalogEntry[];
}

export interface CatalogLabels {
  [ruleId: string]: string;
}
