import { Node as TsNode, type Node } from "ts-morph";

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
 */
export interface ExprFlow {
  names: string[];
  calls: Node[];
}

export function flowSourcesOf(expr: Node | undefined): ExprFlow {
  const names: string[] = [];
  const calls: Node[] = [];
  visit(expr, names, calls);
  return { names: [...new Set(names)], calls };
}

function visit(node: Node | undefined, names: string[], calls: Node[]): void {
  if (!node) return;

  if (TsNode.isIdentifier(node)) {
    names.push(node.getText());
    return;
  }

  // Insensible a campos: `req.body`, `o.q`, `a[0]` colapsan a su raíz.
  if (TsNode.isPropertyAccessExpression(node) || TsNode.isElementAccessExpression(node)) {
    visit(node.getExpression(), names, calls);
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
    for (const arg of node.getArguments()) visit(arg, names, calls);
    return;
  }

  if (TsNode.isTemplateExpression(node)) {
    for (const span of node.getTemplateSpans()) visit(span.getExpression(), names, calls);
    return;
  }

  if (TsNode.isTaggedTemplateExpression(node)) {
    visit(node.getTemplate(), names, calls);
    return;
  }

  if (TsNode.isBinaryExpression(node)) {
    visit(node.getLeft(), names, calls);
    visit(node.getRight(), names, calls);
    return;
  }

  if (TsNode.isConditionalExpression(node)) {
    visit(node.getWhenTrue(), names, calls);
    visit(node.getWhenFalse(), names, calls);
    return;
  }

  if (TsNode.isObjectLiteralExpression(node)) {
    for (const prop of node.getProperties()) {
      if (TsNode.isPropertyAssignment(prop)) visit(prop.getInitializer(), names, calls);
      else if (TsNode.isShorthandPropertyAssignment(prop)) names.push(prop.getName());
      else if (TsNode.isSpreadAssignment(prop)) visit(prop.getExpression(), names, calls);
    }
    return;
  }

  if (TsNode.isArrayLiteralExpression(node)) {
    for (const el of node.getElements()) visit(el, names, calls);
    return;
  }

  if (TsNode.isSpreadElement(node)) {
    visit(node.getExpression(), names, calls);
    return;
  }

  if (TsNode.isPrefixUnaryExpression(node) || TsNode.isPostfixUnaryExpression(node)) {
    visit(node.getOperand(), names, calls);
    return;
  }

  if (
    TsNode.isParenthesizedExpression(node)
    || TsNode.isAwaitExpression(node)
    || TsNode.isNonNullExpression(node)
    || TsNode.isAsExpression(node)
  ) {
    visit(node.getExpression(), names, calls);
    return;
  }

  // Literales y todo lo demás: no propagan datos.
}
