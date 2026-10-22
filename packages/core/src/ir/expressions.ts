import { Node as TsNode, SyntaxKind, type Node, type SourceFile } from "ts-morph";
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

/** Operador `$eq` de MongoDB: compara su valor tal cual, sin interpretar operadores. */
export const EQ_OPERATOR = "$eq";

/** `{ $eq: x }`: el builder le da un nodo Call propio (ver `buildModule`). */
export function isEqOperator(prop: Node): boolean {
  if (!TsNode.isPropertyAssignment(prop)) return false;
  const name = prop.getNameNode();
  return (TsNode.isStringLiteral(name) ? name.getLiteralValue() : name.getText()) === EQ_OPERATOR;
}

/**
 * Lecturas del navegador que controla quien arma la URL o la página:
 * `location.hash`, `document.cookie`, `window.name`... El prefijo `window.`
 * o `self.` es opcional.
 */
const BROWSER_INPUT = /^(?:(?:document\.)?location(?:\.(?:hash|search|href|pathname))?|document\.(?:URL|documentURI|baseURI|referrer|cookie)|name)$/;

/** Métodos del DOM que devuelven un elemento cuyo `.value` escribe el usuario. */
const DOM_QUERY = /\.(?:getElementById|querySelector|getElementsByName|getElementsByClassName|getElementsByTagName)\(/;

/**
 * Nombres declarados en el archivo (variables, parámetros, funciones,
 * clases, imports) con el inicializador de cada variable simple. Es una
 * búsqueda léxica: pedirle el símbolo al compilador obliga a construir el
 * programa entero, que multiplica el tiempo de análisis.
 */
interface FileNames {
  declared: Set<string>;
  inits: Map<string, string>;
}

const namesCache = new WeakMap<SourceFile, FileNames>();

function namesOf(sourceFile: SourceFile): FileNames {
  const cached = namesCache.get(sourceFile);
  if (cached) return cached;
  const declared = new Set<string>();
  const inits = new Map<string, string>();
  for (const node of sourceFile.getDescendants()) {
    if (TsNode.isVariableDeclaration(node)) {
      for (const id of [node.getNameNode(), ...node.getNameNode().getDescendantsOfKind(SyntaxKind.Identifier)]) {
        if (TsNode.isIdentifier(id)) declared.add(id.getText());
      }
      const init = node.getInitializer();
      if (init && TsNode.isIdentifier(node.getNameNode()) && !inits.has(node.getName())) {
        inits.set(node.getName(), init.getText());
      }
    } else if (TsNode.isParameterDeclaration(node) || TsNode.isBindingElement(node)) {
      const name = node.getNameNode();
      if (TsNode.isIdentifier(name)) declared.add(name.getText());
    } else if (TsNode.isFunctionDeclaration(node) || TsNode.isClassDeclaration(node)) {
      const name = node.getNameNode();
      if (name) declared.add(name.getText());
    } else if (TsNode.isImportDeclaration(node)) {
      for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) declared.add(id.getText());
    }
  }
  const names = { declared, inits };
  namesCache.set(sourceFile, names);
  return names;
}

function isDomQuery(node: Node): boolean {
  let current = node;
  while (TsNode.isElementAccessExpression(current)) current = current.getExpression();
  if (TsNode.isCallExpression(current)) return DOM_QUERY.test(`${current.getExpression().getText()}(`);
  if (!TsNode.isIdentifier(current)) return false;
  const init = namesOf(current.getSourceFile()).inits.get(current.getText());
  return init !== undefined && DOM_QUERY.test(init);
}

/** ¿El identificador raíz está declarado en el archivo (y no es el global)? */
function declaredLocally(id: Node): boolean {
  return namesOf(id.getSourceFile()).declared.has(id.getText());
}

/**
 * Entrada del navegador leída en esta expresión, normalizada
 * (`window.location.hash` → `location.hash`), o el texto de la lectura de
 * `.value` sobre un elemento del DOM. El builder le da un nodo Call propio
 * que el catálogo trata como origen, igual que un parámetro.
 */
export function browserInputOf(node: Node): string | undefined {
  if (!TsNode.isPropertyAccessExpression(node)) return undefined;
  const parent = node.getParent();
  if (TsNode.isBinaryExpression(parent) && parent.getLeft() === node
    && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    return undefined; // `location.href = x` es una escritura
  }
  const text = node.getText().replace(/\s+/g, "").replace(/\?\./g, ".");
  if (node.getName() === "value") return isDomQuery(node.getExpression()) ? text : undefined;
  const bare = text.replace(/^(?:window|self)\./, "");
  if (!BROWSER_INPUT.test(bare) || (bare === "name" && bare === text)) return undefined;
  const root = node.getFirstDescendantByKind(SyntaxKind.Identifier);
  return root && !declaredLocally(root) ? bare : undefined;
}

/**
 * La lectura más externa: en `window.location.hash` es `location.hash` y no
 * `window.location`. El builder emite un nodo solo para esa, así no quedan
 * nodos sueltos en el grafo.
 */
export function isOutermostBrowserInput(node: Node): boolean {
  if (browserInputOf(node) === undefined) return false;
  const parent = node.getParent();
  return !(TsNode.isPropertyAccessExpression(parent) && parent.getExpression() === node && browserInputOf(parent) !== undefined);
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

  // `location.hash`, `input.value`: entradas del navegador con nodo propio.
  if (browserInputOf(node) !== undefined) {
    calls.push(node);
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
      if (isEqOperator(prop)) calls.push(prop);
      else if (TsNode.isPropertyAssignment(prop)) visit(prop.getInitializer(), names, calls, guards);
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
