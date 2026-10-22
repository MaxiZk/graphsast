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
export function callMatchesSink(
  call: IRCall,
  spec: SinkSpec,
  receiverPattern: RegExp | null = spec.receiver === undefined ? null : new RegExp(spec.receiver),
): boolean {
  const qualified = call.qualifiedCallee;
  if (qualified && spec.callee.includes(".") && qualified === spec.callee) return true;

  if (!calleeMatchesPattern(call.callee, spec.callee)) return false;
  const receiver = receiverText(call.callee);
  if (spec.bare && receiver !== null) return false;
  if (receiverPattern) {
    if (receiver === null || !receiverPattern.test(receiver)) return false;
  }
  return true;
}

/** Condiciones de un sink sobre el texto de la llamada, ya compiladas. */
export interface SinkConditions {
  unlessFirstArg: RegExp[];
  onlyIf: { receiverInit?: RegExp; firstArg?: RegExp; code?: RegExp } | null;
}

export function sinkConditionsOf(entry: Pick<CweCatalogEntry, "unlessFirstArg">, spec: SinkSpec): SinkConditions {
  const unless = [entry.unlessFirstArg, spec.unlessFirstArg].filter((p): p is string => p !== undefined);
  const only = spec.onlyIf;
  return {
    unlessFirstArg: unless.map((p) => new RegExp(p)),
    onlyIf: only
      ? {
          ...(only.receiverInit !== undefined ? { receiverInit: new RegExp(only.receiverInit) } : {}),
          ...(only.firstArg !== undefined ? { firstArg: new RegExp(only.firstArg) } : {}),
          ...(only.code !== undefined ? { code: new RegExp(only.code) } : {}),
        }
      : null,
  };
}

/** ¿La llamada cumple las condiciones del sink sobre sus argumentos y su receptor? */
export function sinkConditionsHold(call: IRCall, conditions: SinkConditions): boolean {
  const firstArg = call.argTexts[0];
  // El primer argumento o, si es una variable, su inicializador.
  const firstValues = [firstArg, call.firstArgInit].filter((t): t is string => t !== undefined);
  if (conditions.unlessFirstArg.some((re) => firstValues.some((t) => re.test(t)))) return false;
  const only = conditions.onlyIf;
  if (!only) return true;
  return (
    (only.receiverInit !== undefined && call.receiverInit !== undefined && only.receiverInit.test(call.receiverInit))
    || (only.firstArg !== undefined && firstArg !== undefined && only.firstArg.test(firstArg))
    || (only.code !== undefined && only.code.test(call.code))
  );
}

/**
 * Una llamada resuelta con certeza a una función del código analizado no es el
 * sink de biblioteca que su nombre sugiere: `this.save()` sobre un método
 * propio no es el `.save` de Mongoose. El dato entra a la función y el sink,
 * si lo hay, está adentro.
 */
function sinkRule(
  entry: CweCatalogEntry,
  sink: string | SinkSpec,
  catalogSource: TaintRule,
): TaintRule {
  const spec = sinkSpecOf(sink);
  const receiverPattern = spec.receiver === undefined ? null : new RegExp(spec.receiver);
  const conditions = sinkConditionsOf(entry, spec);
  return {
    id: ruleIdOf(entry, "sink", spec.callee),
    kind: "sink",
    cwe: entry.cwe,
    cweName: entry.name,
    ...(spec.args ? { args: spec.args } : {}),
    ...(entry.maxDepth !== undefined ? { maxDepth: entry.maxDepth } : {}),
    ...(entry.requireCatalogSource ? { sourceFilter: catalogSource.match } : {}),
    match: (n): n is IRCall =>
      n.kind === "Call"
      && n.resolution !== "exact"
      && callMatchesSink(n, spec, receiverPattern)
      && sinkConditionsHold(n, conditions),
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

/**
 * Qué parámetros son entradas no confiables.
 *
 * - `params` (default): cualquier parámetro que el código analizado no liga
 *   con una llamada. Sobre-aproxima: una función exportada de una librería
 *   que nadie llama en el escaneo también cuenta.
 * - `catalog`: solo los que el catálogo declara en `sources`. `req.body`
 *   aporta la raíz `req`; `@Body` aporta los parámetros decorados con
 *   `@Body()` (NestJS).
 */
export type SourceMode = "params" | "catalog";

/** Raíces y decoradores que el catálogo declara como sources. */
export function catalogSourceMatchers(bundle: CatalogBundle): { roots: Set<string>; decorators: Set<string> } {
  const roots = new Set<string>();
  const decorators = new Set<string>();
  for (const entry of bundle.entries) {
    for (const source of entry.sources) {
      if (source.startsWith("@")) decorators.add(source.slice(1));
      else roots.add(source.split(".")[0]!);
    }
  }
  return { roots, decorators };
}

/**
 * Entradas del navegador (`location.hash`, `input.value`, `$("#q").val()`):
 * las marca el builder y son origen con los dos modelos.
 */
const BROWSER_INPUT_RULE: TaintRule = {
  id: "browser-input",
  kind: "source",
  match: (n) => n.kind === "Call" && (n as IRCall).input === true,
};

function sourceRule(bundle: CatalogBundle, mode: SourceMode): TaintRule {
  if (mode === "params") {
    return {
      id: "param-any",
      kind: "source",
      match: (n) =>
        n.kind === "Parameter" && !SOURCE_PARAM_BLOCKLIST.has(n.name),
    };
  }
  const { roots, decorators } = catalogSourceMatchers(bundle);
  return {
    id: "param-catalog",
    kind: "source",
    match: (n) =>
      n.kind === "Parameter"
      && (roots.has(n.name) || (n.decorators ?? []).some((d) => decorators.has(d))),
  };
}

/**
 * Una validación que corta antes de usar el dato (ver `ir/guards.ts`) protege
 * contra todas las familias: lo que pasa la regex anclada o la lista
 * permitida no trae los caracteres que hacen falta para inyectar.
 */
const GUARD_RULE: TaintRule = {
  id: "guard-validation",
  kind: "sanitizer",
  match: (n) => n.kind === "Call" && (n as IRCall).validates === true && (n as IRCall).validatesCwe === undefined,
};

/** Una validación que acota el dato solo para una familia (`ruta.startsWith(BASE)`). */
function familyGuardRule(entry: CweCatalogEntry): TaintRule {
  return {
    id: `guard-validation-cwe-${entry.cwe}`,
    kind: "sanitizer",
    cwe: entry.cwe,
    cweName: entry.name,
    match: (n) => n.kind === "Call" && (n as IRCall).validates === true && (n as IRCall).validatesCwe === entry.cwe,
  };
}

/** Reglas base + catálogo CWE externo (ADR-4). */
export function rulesFromCatalog(
  bundle: CatalogBundle,
  sourceMode: SourceMode = "params",
): TaintRule[] {
  const rules: TaintRule[] = [sourceRule(bundle, sourceMode), BROWSER_INPUT_RULE, GUARD_RULE];
  const catalogSource = sourceRule(bundle, "catalog");

  for (const entry of bundle.entries) {
    rules.push(familyGuardRule(entry));
    for (const sink of entry.sinks) {
      rules.push(sinkRule(entry, sink, catalogSource));
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
    "param-catalog": "Parámetros declarados como source en el catálogo",
    "guard-validation": "Validación antes del uso (regex anclada, lista permitida, Number.isInteger, validator.isX)",
    "browser-input": "Entrada del navegador (location, document.cookie, input.value, $(...).val())",
  };
  for (const entry of bundle.entries) {
    labels[`guard-validation-cwe-${entry.cwe}`] = `Validación que acota el dato para CWE-${entry.cwe} (ruta resuelta con startsWith)`;
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
