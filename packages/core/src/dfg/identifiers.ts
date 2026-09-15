import type { IRNode } from "../ir/types.js";

export function isSimpleIdentifier(text: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
}

/** Patrones de entrada HTTP acotados (Express-style). */
const MEMBER_SOURCE_RE = /^req\.(body|query|params(\.\w+)?)$/;

/** ¿El texto puede propagar taint en el DFG acotado? */
export function isFlowOperand(text: string): boolean {
  return isSimpleIdentifier(text) || MEMBER_SOURCE_RE.test(text);
}

/** Resuelve defs que alimentan un operando (`req.body`, `req.params.id` → `req`). */
export function resolveFlowDefs(
  text: string,
  defsByName: Map<string, IRNode[]>,
): IRNode[] {
  if (isSimpleIdentifier(text)) {
    return defsByName.get(text) ?? [];
  }
  const m = text.match(MEMBER_SOURCE_RE);
  if (m) return defsByName.get("req") ?? [];
  return [];
}

/** `callee(operand)` con un solo argumento flujo-compatible. */
export function parseCallInit(
  init: string,
): { callee: string; arg: string } | null {
  const m = init.match(/^([A-Za-z_$][\w$]*)\(([^)]+)\)$/);
  if (!m) return null;
  const arg = m[2]!.trim();
  if (!isFlowOperand(arg)) return null;
  return { callee: m[1]!, arg };
}

/** `new Model(req.body)` — ctor con un argumento flujo-compatible. */
export function parseNewInit(init: string): string | null {
  const m = init.match(/^new\s+[A-Za-z_$][\w$.]*\(([^)]+)\)\s*$/);
  if (!m) return null;
  const arg = m[1]!.trim();
  if (!isFlowOperand(arg)) return null;
  return arg;
}

/** Receptor de una llamada miembro (`finance.save` → `finance`). */
export function receiverOfCallee(callee: string): string | null {
  const dot = callee.lastIndexOf(".");
  if (dot <= 0) return null;
  const recv = callee.slice(0, dot);
  return isFlowOperand(recv) ? recv : null;
}
