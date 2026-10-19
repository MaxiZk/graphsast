import { Node as TsNode, SyntaxKind, type Node } from "ts-morph";
import { guardFor, type Guard } from "./guards.js";

/**
 * Raíces de flujo de una expresión.
 *
 * `names` son los identificadores raíz que alimentan la expresión
 * (`req.body` → `req`; `` `id=${x}` `` → `x`). El análisis es
 * *insensible a campos*: `o.q` y `o` se tratan como el mismo dato.
 *
 * `calls` son las llamadas cuyo **valor de retorno** alimenta la expresión.
 * El recorrido NO desciende a sus argumentos: así el flujo se enruta a
 * través del nodo Call (`input → sanitize(...) → safe`) en vez de saltearlo,
 * que es lo que permite que un sanitizer intermedio corte el camino.
 *
 * Un uso protegido por una validación (`guards`, ver `guards.ts`) no aporta
 * su raíz sino la llamada que lo validó: el dato llega a través de ella, igual
 * que a través de un sanitizer.
 *
 * `this.campo` es su propia raíz (`this.repo`): el campo de la clase se
 * modela como una variable de la clase, que escribe el constructor y leen los
 * métodos.
 */
export interface ExprFlow {
  names: string[];
  calls: Node[];
}

export function flowSourcesOf(expr: Node | undefined, guards: readonly Guard[] = []): ExprFlow {
  const names: string[] = [];
  const calls: Node[] = [];
  visit(expr, names, calls, guards);
  return { names: [...new Set(names)], calls };
}

/** `this.repo.save` → `this.repo`: el campo de `this` del que sale la expresión. */
export function thisFieldOf(node: Node): string | undefined {
  if (!TsNode.isPropertyAccessExpression(node)) return undefined;
  if (node.getExpression().getKind() !== SyntaxKind.ThisKeyword) return undefined;
  return `this.${node.getName()}`;
}

function visit(node: Node | undefined, names: string[], calls: Node[], guards: readonly Guard[]): void {
  if (!node) return;

  if (
    TsNode.isIdentifier(node)
    || TsNode.isPropertyAccessExpression(node)
    || TsNode.isElementAccessExpression(node)
  ) {
    const guard = guardFor(node, guards);
    if (guard) {
      calls.push(guard.call);
      return;
    }
  }

  if (TsNode.isIdentifier(node)) {
    names.push(node.getText());
    return;
  }

  const field = thisFieldOf(node);
  if (field) {
    names.push(field);
    return;
  }

  // Insensible a campos: `req.body`, `o.q`, `a[0]` colapsan a su raíz.
  if (TsNode.isPropertyAccessExpression(node) || TsNode.isElementAccessExpression(node)) {
    visit(node.getExpression(), names, calls, guards);
    return;
  }

  // Frontera: el retorno de la llamada alimenta la expresión, pero sus
  // argumentos se procesan al construir el nodo Call correspondiente.
  if (TsNode.isCallExpression(node)) {
    calls.push(node);
    return;
  }

  // `new Model(req.body)` es transparente: no genera nodo Call propio.
  if (TsNode.isNewExpression(node)) {
    for (const arg of node.getArguments()) visit(arg, names, calls, guards);
    return;
  }

  if (TsNode.isTemplateExpression(node)) {
    for (const span of node.getTemplateSpans()) visit(span.getExpression(), names, calls, guards);
    return;
  }

  if (TsNode.isTaggedTemplateExpression(node)) {
    visit(node.getTemplate(), names, calls, guards);
    return;
  }

  if (TsNode.isBinaryExpression(node)) {
    visit(node.getLeft(), names, calls, guards);
    visit(node.getRight(), names, calls, guards);
    return;
  }

  if (TsNode.isConditionalExpression(node)) {
    visit(node.getWhenTrue(), names, calls, guards);
    visit(node.getWhenFalse(), names, calls, guards);
    return;
  }

  if (TsNode.isObjectLiteralExpression(node)) {
    for (const prop of node.getProperties()) {
      if (TsNode.isPropertyAssignment(prop)) visit(prop.getInitializer(), names, calls, guards);
      else if (TsNode.isShorthandPropertyAssignment(prop)) names.push(prop.getName());
      else if (TsNode.isSpreadAssignment(prop)) visit(prop.getExpression(), names, calls, guards);
    }
    return;
  }

  if (TsNode.isArrayLiteralExpression(node)) {
    for (const el of node.getElements()) visit(el, names, calls, guards);
    return;
  }

  if (TsNode.isSpreadElement(node)) {
    visit(node.getExpression(), names, calls, guards);
    return;
  }

  if (TsNode.isPrefixUnaryExpression(node) || TsNode.isPostfixUnaryExpression(node)) {
    visit(node.getOperand(), names, calls, guards);
    return;
  }

  if (
    TsNode.isParenthesizedExpression(node)
    || TsNode.isAwaitExpression(node)
    || TsNode.isNonNullExpression(node)
    || TsNode.isAsExpression(node)
  ) {
    visit(node.getExpression(), names, calls, guards);
    return;
  }

  // Literales y todo lo demás: no propagan datos.
}
