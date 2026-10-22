import { Node as TsNode, SyntaxKind, type Node, type SourceFile } from "ts-morph";

/**
 * Validaciones que protegen un dato antes de usarlo:
 *
 *     if (!/^[a-z]+$/.test(req.query.q)) return res.end();
 *     exec("ls " + req.query.q);           // protegido
 *
 *     if (ALLOWED.includes(host)) {
 *       exec("ping " + host);              // protegido
 *     }
 *
 * Sin esto, el único corte que el motor entendía era una llamada de
 * saneamiento en el camino (`escapeHtml(x)`); «validar y salir» quedaba como
 * vulnerable y era el falso positivo más común en código bien escrito.
 *
 * Se reconoce solo lo que acota el dato de verdad, para no inventar cortes:
 * una regex anclada en los dos extremos (sin `|` suelto ni flag `m`, que
 * permitirían un salto de línea con cualquier cosa), los validadores de tipo
 * numérico, los de formato de `validator` que no admiten caracteres
 * especiales, y la pertenencia a una lista (`LISTA.includes(x)`).
 */
export interface Guard {
  /** Texto normalizado de la expresión validada (`req.query.q`, `host`). */
  key: string;
  /** Zona protegida: los usos de `key` entre estas posiciones están validados. */
  from: number;
  to: number;
  /** La llamada que valida: los usos protegidos pasan por su nodo. */
  call: Node;
  /** Familia a la que se limita la protección; sin valor, a todas. */
  cwe?: number;
}

/**
 * `ruta.startsWith(BASE)` sobre una ruta ya resuelta (`path.resolve`,
 * `path.join`, `path.normalize`, `realpath`): la ruta no sale de `BASE`. Sin
 * resolverla antes, `BASE/../secreto` pasaría la verificación. Acota solo la
 * ruta: el mismo dato puede seguir inyectando HTML o SQL.
 */
const RESOLVED_PATH = /^\s*(?:await\s+)?(?:path\.)?(?:resolve|join|normalize|realpathSync|realpath)\(/;
const PATH_TRAVERSAL_CWE = 22;

/** `validator.isX(x)`: formatos que no admiten metacaracteres. */
const VALIDATOR_FORMATS = new Set([
  "isInt", "isNumeric", "isFloat", "isDecimal", "isAlpha", "isAlphanumeric",
  "isHexadecimal", "isUUID", "isMongoId", "isBoolean", "isPort", "isISO8601",
]);

/** `Number.isInteger(x)`: el dato es un número. */
const NUMBER_CHECKS = new Set(["Number.isInteger", "Number.isSafeInteger", "Number.isFinite"]);

export function normalizeExpr(text: string): string {
  return text.replace(/\s+/g, "").replace(/\?\./g, ".");
}

/**
 * ¿La regex acepta solo cadenas enteras de su forma? `^` al principio, `$` al
 * final, sin una alternativa `|` fuera de un grupo (`/^a|b$/` es «empieza
 * con a» o «termina en b») y sin `m` (con `m`, `^`/`$` son por línea).
 */
export function isAnchoredRegex(literal: string): boolean {
  const end = literal.lastIndexOf("/");
  if (!literal.startsWith("/") || end <= 0) return false;
  const pattern = literal.slice(1, end);
  const flags = literal.slice(end + 1);
  if (flags.includes("m")) return false;
  if (!pattern.startsWith("^") || !pattern.endsWith("$") || pattern.endsWith("\\$")) return false;
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "|" && depth === 0) return false;
  }
  return true;
}

/** Regex de `R.test(x)`: literal, o una constante del archivo que la guarda. */
function anchoredRegexReceiver(receiver: Node, consts: ReadonlyMap<string, string>): boolean {
  if (TsNode.isRegularExpressionLiteral(receiver)) return isAnchoredRegex(receiver.getText());
  if (TsNode.isIdentifier(receiver)) {
    const literal = consts.get(receiver.getText());
    return literal !== undefined && isAnchoredRegex(literal);
  }
  return false;
}

/** `const SAFE = /^[a-z]+$/` del archivo, por nombre. */
function regexConstants(sourceFile: SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    const name = decl.getNameNode();
    if (init && TsNode.isRegularExpressionLiteral(init) && TsNode.isIdentifier(name)) {
      out.set(name.getText(), init.getText());
    }
  }
  return out;
}

/** Inicializador de cada variable simple del archivo, por nombre. */
function initializersOf(sourceFile: SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (init && TsNode.isIdentifier(decl.getNameNode()) && !out.has(decl.getName())) {
      out.set(decl.getName(), init.getText());
    }
  }
  return out;
}

/** `ruta.startsWith(BASE)` con `ruta` resuelta: la expresión validada. */
function prefixCheckedPath(call: Node, inits: ReadonlyMap<string, string>): Node | undefined {
  if (!TsNode.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  if (!TsNode.isPropertyAccessExpression(callee) || callee.getName() !== "startsWith") return undefined;
  const receiver = callee.getExpression();
  if (!TsNode.isIdentifier(receiver) || call.getArguments().length === 0) return undefined;
  const init = inits.get(receiver.getText());
  return init !== undefined && RESOLVED_PATH.test(init) ? receiver : undefined;
}

/** Si la llamada valida un dato, la expresión validada. */
function validatedExpr(call: Node, consts: ReadonlyMap<string, string>): Node | undefined {
  if (!TsNode.isCallExpression(call)) return undefined;
  const [arg] = call.getArguments();
  if (!arg) return undefined;
  const callee = call.getExpression();
  const calleeText = normalizeExpr(callee.getText());

  if (NUMBER_CHECKS.has(calleeText)) return arg;
  if (!TsNode.isPropertyAccessExpression(callee)) return undefined;

  const method = callee.getName();
  const receiver = callee.getExpression();
  if (method === "test" && anchoredRegexReceiver(receiver, consts)) return arg;
  if (normalizeExpr(receiver.getText()) === "validator" && VALIDATOR_FORMATS.has(method)) return arg;
  // Lista permitida: el dato tiene que ser uno de sus elementos.
  if (
    (method === "includes" || method === "has")
    && (TsNode.isIdentifier(receiver) || TsNode.isArrayLiteralExpression(receiver))
    && normalizeExpr(receiver.getText()) !== normalizeExpr(arg.getText())
  ) {
    return arg;
  }
  return undefined;
}

function unwrapParens(node: Node): Node {
  let current = node;
  while (TsNode.isParenthesizedExpression(current)) current = current.getExpression();
  return current;
}

/** ¿La sentencia sale siempre del bloque? (`return`, `throw`, o un bloque que termina así). */
function alwaysExits(stmt: Node): boolean {
  if (
    TsNode.isReturnStatement(stmt)
    || TsNode.isThrowStatement(stmt)
    || TsNode.isBreakStatement(stmt)
    || TsNode.isContinueStatement(stmt)
  ) {
    return true;
  }
  if (TsNode.isBlock(stmt)) {
    const last = stmt.getStatements().at(-1);
    return last !== undefined && alwaysExits(last);
  }
  return false;
}

/** Validaciones del archivo y la zona que protege cada una. */
export function collectGuards(sourceFile: SourceFile): Guard[] {
  const consts = regexConstants(sourceFile);
  const inits = initializersOf(sourceFile);
  const guards: Guard[] = [];
  for (const stmt of sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    let condition = unwrapParens(stmt.getExpression());
    const negated = TsNode.isPrefixUnaryExpression(condition)
      && condition.getOperatorToken() === SyntaxKind.ExclamationToken;
    if (TsNode.isPrefixUnaryExpression(condition) && negated) {
      condition = unwrapParens(condition.getOperand());
    }
    const prefixed = prefixCheckedPath(condition, inits);
    const expr = prefixed ?? validatedExpr(condition, consts);
    if (!expr) continue;
    const key = normalizeExpr(expr.getText());
    const scope = prefixed ? { cwe: PATH_TRAVERSAL_CWE } : {};

    if (negated) {
      // `if (!valido(x)) return;` → protege lo que sigue en el mismo bloque.
      if (!alwaysExits(stmt.getThenStatement())) continue;
      const container = stmt.getParent();
      if (!container) continue;
      guards.push({ key, from: stmt.getEnd(), to: container.getEnd(), call: condition, ...scope });
    } else {
      // `if (valido(x)) { ... }` → protege el bloque del `if`.
      const then = stmt.getThenStatement();
      guards.push({ key, from: then.getStart(), to: then.getEnd(), call: condition, ...scope });
    }
  }
  return guards;
}

/** La validación que protege a este uso, si hay una. */
export function guardFor(node: Node, guards: readonly Guard[]): Guard | undefined {
  if (guards.length === 0) return undefined;
  const start = node.getStart();
  const end = node.getEnd();
  const key = normalizeExpr(node.getText());
  return guards.find((g) => g.key === key && start >= g.from && end <= g.to);
}
