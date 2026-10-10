import type { IRCall } from "../ir/types.js";
import type { TaintRule } from "../taint/types.js";
import type { CatalogBundle, CatalogLabels, CweCatalogEntry, SinkSpec } from "./types.js";

const SOURCE_PARAM_BLOCKLIST = new Set(["res", "next", "_"]);

/** ¿El callee coincide con un patrón del catálogo? */
/**
 * Coincidencia de callee contra un patrón del catálogo.
 *
 * Solo exacta o por sufijo de miembro (`.save` / `create` → `Finance.create`).
 * NO se usa `includes`: hacerlo daba falsos positivos (`evaluatePrice` contra
 * el sink `eval`, `spawnConfetti` contra `spawn`) y falsos negativos
 * (`escapeNothing` pasaba por sanitizer `escape`, suprimiendo un hallazgo real).
 */
export function calleeMatchesPattern(callee: string, pattern: string): boolean {
  if (callee === pattern) return true;
  if (pattern.startsWith(".")) return callee.endsWith(pattern);
  return callee.endsWith(`.${pattern}`);
}

/** Normaliza un sink del catálogo a su forma objeto. */
export function sinkSpecOf(sink: string | SinkSpec): SinkSpec {
  return typeof sink === "string" ? { callee: sink } : sink;
}

/** Id de regla estable por patrón (los ids salen en SARIF y en la UI). */
function ruleIdOf(entry: CweCatalogEntry, kind: "sink" | "sanitizer", pattern: string): string {
  return `cwe-${entry.cwe}-${kind}-${pattern.replace(/[^\w]+/g, "_")}`;
}

/** Texto del receptor de un callee miembro: `User` en `User.find`. */
function receiverText(callee: string): string | null {
  const normalized = callee.replace(/\s+/g, "").replace(/\?\./g, ".");
  const dot = normalized.lastIndexOf(".");
  return dot === -1 ? null : normalized.slice(0, dot);
}

/** ¿La llamada coincide con el sink, con sus restricciones? */
export function callMatchesSink(call: IRCall, spec: SinkSpec): boolean {
  const qualified = call.qualifiedCallee;
  if (qualified && spec.callee.includes(".") && qualified === spec.callee) return true;

  if (!calleeMatchesPattern(call.callee, spec.callee)) return false;
  const receiver = receiverText(call.callee);
  if (spec.bare && receiver !== null) return false;
  if (spec.receiver !== undefined) {
    if (receiver === null || !new RegExp(spec.receiver).test(receiver)) return false;
  }
  return true;
}

/**
 * Una llamada resuelta con certeza a una función del código analizado no es el
 * sink de biblioteca que su nombre sugiere: `this.save()` sobre un método
 * propio no es el `.save` de Mongoose. El dato entra a la función y el sink,
 * si lo hay, está adentro.
 */
function sinkRule(entry: CweCatalogEntry, sink: string | SinkSpec): TaintRule {
  const spec = sinkSpecOf(sink);
  return {
    id: ruleIdOf(entry, "sink", spec.callee),
    kind: "sink",
    cwe: entry.cwe,
    cweName: entry.name,
    ...(spec.args ? { args: spec.args } : {}),
    match: (n): n is IRCall =>
      n.kind === "Call"
      && n.resolution !== "exact"
      && callMatchesSink(n, spec),
  };
}

function sanitizerRule(entry: CweCatalogEntry, pattern: string): TaintRule {
  return {
    id: ruleIdOf(entry, "sanitizer", pattern),
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
    for (const sink of entry.sinks) {
      rules.push(sinkRule(entry, sink));
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
    for (const sink of entry.sinks) {
      const { callee } = sinkSpecOf(sink);
      labels[ruleIdOf(entry, "sink", callee)] = `CWE-${entry.cwe} sink: ${callee}`;
    }
    for (const pattern of entry.sanitizers) {
      labels[ruleIdOf(entry, "sanitizer", pattern)] = `CWE-${entry.cwe} sanitizer: ${pattern}`;
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
