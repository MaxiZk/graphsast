import {
  type SourceFile,
  type Node,
  SyntaxKind,
  Node as TsNode,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type MethodDeclaration,
  type VariableDeclaration,
  type ParameterDeclaration,
  VariableDeclarationKind,
} from "ts-morph";
import type {
  IRModule, IRNode, IRFunction, IRParameter, IRVariable, IRLiteral, IRCall,
  IRAssignment, FlowRef, Loc,
} from "./types.js";
import { EMPTY_FLOW } from "./types.js";
import { flowSourcesOf } from "./expressions.js";

function locOf(node: Node, file: string): Loc {
  const sf = node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
  const end = sf.getLineAndColumnAtPos(node.getEnd());
  return { file, line, col: column, endLine: end.line, endCol: end.column };
}

function idOf(kind: string, loc: Loc): string {
  return `${loc.file}#${kind}@${loc.line}:${loc.col}`;
}

/** Id del nodo Call que le corresponde a una CallExpression del AST. */
function callIdOf(call: Node, file: string): string {
  return idOf("Call", locOf(call, file));
}

/** Convierte el resultado del walker en una referencia serializable. */
function flowRefOf(expr: Node | undefined, file: string): FlowRef {
  if (!expr) return { ...EMPTY_FLOW };
  const { names, calls } = flowSourcesOf(expr);
  return { names, callIds: calls.map((c) => callIdOf(c, file)) };
}

export type FunctionLike =
  | FunctionDeclaration
  | ArrowFunction
  | FunctionExpression
  | MethodDeclaration;

function isFunctionLike(node: Node): node is FunctionLike {
  return (
    TsNode.isFunctionDeclaration(node)
    || TsNode.isArrowFunction(node)
    || TsNode.isFunctionExpression(node)
    || TsNode.isMethodDeclaration(node)
  );
}

/** Id del nodo Function que el IR le asigna a una declaración. */
export function functionIdOf(fn: FunctionLike, file: string): string {
  return idOf("Function", locOf(fn, file));
}

function ownerFnIdOf(node: Node, file: string): string | null {
  const fn = node.getFirstAncestor(isFunctionLike);
  if (!fn) return null;
  return idOf("Function", locOf(fn, file));
}

/**
 * Nodos del AST que abren un ámbito léxico. Las funciones lo abren para sus
 * parámetros; los bloques, para las declaraciones `let`/`const` que contienen.
 * `CaseBlock` cubre el cuerpo del `switch`, que es un único ámbito compartido
 * salvo que cada `case` traiga sus propias llaves (ahí anida un `Block`).
 */
const BLOCK_SCOPE_KINDS = new Set<SyntaxKind>([
  SyntaxKind.Block,
  SyntaxKind.CaseBlock,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.CatchClause,
]);

function isScopeNode(node: Node): boolean {
  return (
    TsNode.isSourceFile(node)
    || isFunctionLike(node)
    || BLOCK_SCOPE_KINDS.has(node.getKind())
  );
}

/** Identificador de ámbito, único por archivo: la posición donde abre. */
function scopeIdOf(node: Node): string {
  return `S${node.getStart()}`;
}

/** Cadena de ámbitos que contienen al nodo, del más externo al más interno. */
function scopePathOf(node: Node): string[] {
  const out: string[] = [];
  for (const anc of node.getAncestors()) {
    if (isScopeNode(anc)) out.push(scopeIdOf(anc));
  }
  return out.reverse();
}

/**
 * Ámbito de la función que contiene al nodo, ignorando los bloques
 * intermedios: es el ámbito real de un `var`, que se iza hasta la función.
 */
function functionScopePathOf(node: Node): string[] {
  const fn = node.getFirstAncestor(
    (a) => isFunctionLike(a) || TsNode.isSourceFile(a),
  );
  if (!fn) return [];
  return [...scopePathOf(fn), scopeIdOf(fn)];
}

/** `var` se iza al ámbito de función; `let`/`const` respetan el bloque. */
function declarationScopePathOf(decl: VariableDeclaration, at: Node): string[] {
  const list = decl.getParent();
  const isVar = TsNode.isVariableDeclarationList(list)
    && list.getDeclarationKind() === VariableDeclarationKind.Var;
  return isVar ? functionScopePathOf(at) : scopePathOf(at);
}

function fnNameOf(fn: FunctionLike): string {
  if (TsNode.isFunctionDeclaration(fn) || TsNode.isMethodDeclaration(fn)) {
    return fn.getName() ?? "";
  }
  return "";
}

/** Expresiones retornadas por la función (cuerpo conciso de arrow incluido). */
function returnExpressionsOf(fn: FunctionLike): Node[] {
  if (TsNode.isArrowFunction(fn)) {
    const body = fn.getBody();
    if (!TsNode.isBlock(body)) return [body];
  }
  const out: Node[] = [];
  for (const ret of fn.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const expr = ret.getExpression();
    if (expr) out.push(expr);
  }
  return out;
}

/**
 * Nombres que un parámetro introduce al ámbito.
 *
 * `function Card({ user })` declara `user`, no un parámetro llamado `{ user }`:
 * sin desarmar el patrón, `user.bio` no resolvía contra ninguna def y el
 * análisis no veía nada. Es la forma habitual de escribir componentes React y
 * handlers de Express, así que sin esto el soporte de JSX quedaba a medias.
 */
function parameterBindings(param: ParameterDeclaration): { name: string; at: Node }[] {
  const nameNode = param.getNameNode();
  if (TsNode.isIdentifier(nameNode)) {
    return [{ name: nameNode.getText(), at: param }];
  }
  const out: { name: string; at: Node }[] = [];
  for (const el of param.getDescendantsOfKind(SyntaxKind.BindingElement)) {
    const elName = el.getNameNode();
    if (TsNode.isIdentifier(elName)) out.push({ name: elName.getText(), at: el });
  }
  // Un patrón sin identificadores igual ocupa una posición de argumento.
  return out.length > 0 ? out : [{ name: nameNode.getText(), at: param }];
}

function emitFunction(fn: FunctionLike, file: string, nodes: IRNode[]): void {
  const fnLoc = locOf(fn, file);
  const fnId = idOf("Function", fnLoc);
  const paramIds: string[] = [];

  fn.getParameters().forEach((p, index) => {
    // `paramIds` queda alineado con la posición del argumento (lo que asume
    // interproc): un id por parámetro declarado, el del primer binding.
    let positionalId: string | null = null;
    for (const { name, at } of parameterBindings(p)) {
      const pLoc = locOf(at, file);
      const param: IRParameter = {
        id: idOf("Parameter", pLoc),
        kind: "Parameter",
        name,
        code: at.getText(),
        loc: pLoc,
        scopePath: scopePathOf(at),
        index,
        ownerFnId: fnId,
      };
      positionalId ??= param.id;
      nodes.push(param);
    }
    if (positionalId) paramIds.push(positionalId);
  });

  const returns = returnExpressionsOf(fn);
  const irFn: IRFunction = {
    id: fnId,
    kind: "Function",
    name: fnNameOf(fn),
    code: fn.getText(),
    loc: fnLoc,
    scopePath: scopePathOf(fn),
    paramIds,
    returnTexts: returns.map((r) => r.getText()),
    returnFlows: returns.map((r) => flowRefOf(r, file)),
  };
  nodes.push(irFn);
}

function collectFunctionLikes(sourceFile: SourceFile): FunctionLike[] {
  const out: FunctionLike[] = [...sourceFile.getFunctions()];
  for (const arrow of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
    out.push(arrow);
  }
  for (const expr of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression)) {
    out.push(expr);
  }
  for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    out.push(method);
  }
  return out;
}

/**
 * Nombres declarados por una VariableDeclaration, con su nodo de ubicación.
 * `const { id } = req.params` produce una entrada por binding element.
 */
function declaredBindings(decl: VariableDeclaration): { name: string; at: Node }[] {
  const nameNode = decl.getNameNode();
  if (TsNode.isIdentifier(nameNode)) {
    return [{ name: nameNode.getText(), at: decl }];
  }
  const out: { name: string; at: Node }[] = [];
  for (const el of decl.getDescendantsOfKind(SyntaxKind.BindingElement)) {
    const elName = el.getNameNode();
    if (TsNode.isIdentifier(elName)) out.push({ name: elName.getText(), at: el });
  }
  return out;
}

function emitVariables(decl: VariableDeclaration, file: string, nodes: IRNode[]): void {
  const init = decl.getInitializer();
  const initFlow = flowRefOf(init, file);
  const initText = init ? init.getText() : null;

  for (const { name, at } of declaredBindings(decl)) {
    const vLoc = locOf(at, file);
    const irVar: IRVariable = {
      id: idOf("Variable", vLoc),
      kind: "Variable",
      name,
      code: at.getText(),
      loc: vLoc,
      scopePath: declarationScopePathOf(decl, at),
      initText,
      initFlow: { names: [...initFlow.names], callIds: [...initFlow.callIds] },
      ownerFnId: ownerFnIdOf(at, file),
    };
    nodes.push(irVar);
  }
}

/** Receptor de una llamada miembro: `finance.save()` → flujo de `finance`. */
function receiverFlowOf(call: Node, file: string): FlowRef {
  if (!TsNode.isCallExpression(call)) return { ...EMPTY_FLOW };
  const callee = call.getExpression();
  if (
    TsNode.isPropertyAccessExpression(callee)
    || TsNode.isElementAccessExpression(callee)
  ) {
    return flowRefOf(callee.getExpression(), file);
  }
  return { ...EMPTY_FLOW };
}

/** Asignaciones `x = expr` (no declaraciones) que alimentan una def existente. */
function collectAssignments(sourceFile: SourceFile, file: string): IRAssignment[] {
  const out: IRAssignment[] = [];
  for (const bin of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = bin.getLeft();
    // Insensible a campos: `o.q = tainted` marca `o`.
    const target = TsNode.isIdentifier(left)
      ? left.getText()
      : (TsNode.isPropertyAccessExpression(left) || TsNode.isElementAccessExpression(left))
        ? flowSourcesOf(left).names[0]
        : undefined;
    if (!target) continue;
    out.push({
      target,
      flow: flowRefOf(bin.getRight(), file),
      ownerFnId: ownerFnIdOf(bin, file),
      scopePath: scopePathOf(bin),
    });
  }
  return out;
}

/**
 * Escrituras de propiedad peligrosas, modeladas como llamadas.
 *
 * `el.innerHTML = x` es, en JavaScript, la invocación del setter `innerHTML`
 * con `x` de argumento; `<div dangerouslySetInnerHTML={{__html: x}} />` es lo
 * mismo en React. Emitirlas como nodos `Call` no es un atajo: es su semántica
 * real, y permite que el catálogo las empareje con el mismo mecanismo que
 * `document.write`. Sin esto, los sinks `innerHTML` y `outerHTML` figuraban en
 * el catálogo pero no podían disparar nunca, porque no existía ningún nodo
 * contra el cual comparar.
 *
 * Se ubica en el nodo del nombre de la propiedad, no en el de la expresión
 * completa: `document.getElementById("a").innerHTML = x` comparte posición
 * inicial con la llamada a `getElementById`, y usar esa posición colisionaría
 * los ids de ambos nodos.
 */
function emitPropertyWriteSinks(
  sourceFile: SourceFile,
  file: string,
  nodes: IRNode[],
): void {
  for (const bin of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = bin.getLeft();
    if (!TsNode.isPropertyAccessExpression(left)) continue;

    const nameNode = left.getNameNode();
    const loc = locOf(nameNode, file);
    nodes.push({
      id: idOf("Call", loc),
      kind: "Call",
      name: left.getText(),
      code: bin.getText(),
      loc,
      scopePath: scopePathOf(bin),
      callee: left.getText(),
      argTexts: [bin.getRight().getText()],
      argFlows: [flowRefOf(bin.getRight(), file)],
      receiverFlow: { ...EMPTY_FLOW },
      ownerFnId: ownerFnIdOf(bin, file),
    } satisfies IRCall);
  }

  for (const attr of sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const nameNode = attr.getNameNode();
    const initializer = attr.getInitializer();
    if (!initializer || !TsNode.isJsxExpression(initializer)) continue;
    const expr = initializer.getExpression();
    if (!expr) continue;

    // `{{__html: valor}}` — el flujo peligroso es el de `__html`, no el objeto.
    let payload: Node = expr;
    if (TsNode.isObjectLiteralExpression(expr)) {
      const html = expr.getProperty("__html");
      if (html && TsNode.isPropertyAssignment(html)) {
        payload = html.getInitializerOrThrow();
      }
    }

    const loc = locOf(nameNode, file);
    nodes.push({
      id: idOf("Call", loc),
      kind: "Call",
      name: nameNode.getText(),
      code: attr.getText(),
      loc,
      scopePath: scopePathOf(attr),
      callee: nameNode.getText(),
      argTexts: [payload.getText()],
      argFlows: [flowRefOf(payload, file)],
      receiverFlow: { ...EMPTY_FLOW },
      ownerFnId: ownerFnIdOf(attr, file),
    } satisfies IRCall);
  }
}

/**
 * `fileName` permite conservar la ruta relativa al escanear un proyecto
 * (`src/routes/users.ts` en vez de `users.ts`), de modo que los ids de nodo
 * sean únicos entre archivos y los hallazgos apunten al lugar correcto.
 */
export function buildIR(sourceFile: SourceFile, fileName?: string): IRModule {
  const file = fileName ?? sourceFile.getBaseName();
  const nodes: IRNode[] = [];

  for (const fn of collectFunctionLikes(sourceFile)) {
    emitFunction(fn, file, nodes);
  }

  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    emitVariables(decl, file, nodes);
  }

  for (const lit of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const lLoc = locOf(lit, file);
    const irLit: IRLiteral = {
      id: idOf("Literal", lLoc),
      kind: "Literal",
      name: "",
      code: lit.getText(),
      loc: lLoc,
      scopePath: scopePathOf(lit),
      value: lit.getLiteralValue(),
      ownerFnId: ownerFnIdOf(lit, file),
    };
    nodes.push(irLit);
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const cLoc = locOf(call, file);
    const args = call.getArguments();
    const irCall: IRCall = {
      id: idOf("Call", cLoc),
      kind: "Call",
      name: call.getExpression().getText(),
      code: call.getText(),
      loc: cLoc,
      scopePath: scopePathOf(call),
      callee: call.getExpression().getText(),
      argTexts: args.map((a) => a.getText()),
      argFlows: args.map((a) => flowRefOf(a, file)),
      receiverFlow: receiverFlowOf(call, file),
      ownerFnId: ownerFnIdOf(call, file),
    };
    nodes.push(irCall);
  }

  emitPropertyWriteSinks(sourceFile, file, nodes);

  return { file, nodes, assignments: collectAssignments(sourceFile, file) };
}
