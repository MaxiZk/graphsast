import type { IRCall } from "../ir/types.js";
import type { TaintRule } from "../taint/types.js";
import type { CatalogBundle, CatalogLabels, CweCatalogEntry } from "./types.js";

const SOURCE_PARAM_BLOCKLIST = new Set(["res", "next", "_"]);

/** ¿El callee coincide con un patrón del catálogo? */
export function calleeMatchesPattern(callee: string, pattern: string): boolean {
  if (callee === pattern) return true;
  if (pattern.startsWith(".")) return callee.endsWith(pattern);
  if (callee.endsWith(`.${pattern}`)) return true;
  return callee.includes(pattern);
}

function sinkRule(entry: CweCatalogEntry, pattern: string): TaintRule {
  const id = `cwe-${entry.cwe}-sink-${pattern.replace(/[^\w]+/g, "_")}`;
  return {
    id,
    kind: "sink",
    cwe: entry.cwe,
    cweName: entry.name,
    match: (n): n is IRCall =>
      n.kind === "Call" && calleeMatchesPattern(n.callee, pattern),
  };
}

function sanitizerRule(entry: CweCatalogEntry, pattern: string): TaintRule {
  const id = `cwe-${entry.cwe}-sanitizer-${pattern.replace(/[^\w]+/g, "_")}`;
  return {
    id,
    kind: "sanitizer",
    cwe: entry.cwe,
    cweName: entry.name,
    match: (n): n is IRCall =>
      n.kind === "Call" && calleeMatchesPattern(n.callee, pattern),
  };
}

/** Reglas base + catálogo CWE externo (ADR-4). */
export function rulesFromCatalog(bundle: CatalogBundle): TaintRule[] {
  const rules: TaintRule[] = [
    {
      id: "param-any",
      kind: "source",
      match: (n) =>
        n.kind === "Parameter" && !SOURCE_PARAM_BLOCKLIST.has(n.name),
    },
  ];

  for (const entry of bundle.entries) {
    for (const pattern of entry.sinks) {
      rules.push(sinkRule(entry, pattern));
    }
    for (const pattern of entry.sanitizers) {
      rules.push(sanitizerRule(entry, pattern));
    }
  }

  return rules;
}

export function labelsFromCatalog(bundle: CatalogBundle): CatalogLabels {
  const labels: CatalogLabels = {
    "param-any": "Parámetros de función (excepto res/next)",
  };
  for (const entry of bundle.entries) {
    for (const pattern of entry.sinks) {
      const id = `cwe-${entry.cwe}-sink-${pattern.replace(/[^\w]+/g, "_")}`;
      labels[id] = `CWE-${entry.cwe} sink: ${pattern}`;
    }
    for (const pattern of entry.sanitizers) {
      const id = `cwe-${entry.cwe}-sanitizer-${pattern.replace(/[^\w]+/g, "_")}`;
      labels[id] = `CWE-${entry.cwe} sanitizer: ${pattern}`;
    }
  }
  return labels;
}

/** Resuelve CWE del sink a partir de las reglas que lo matchean. */
export function cweForSinkNode(
  rules: TaintRule[],
  node: IRCall,
): { cwe?: number; cweName?: string; ruleId?: string } {
  const hit = rules.find((r) => r.kind === "sink" && r.match(node));
  if (!hit) return {};
  return { cwe: hit.cwe, cweName: hit.cweName, ruleId: hit.id };
}
