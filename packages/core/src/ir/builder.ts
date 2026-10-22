import {
  type SourceFile,
  type Node,
  SyntaxKind,
  Node as TsNode,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type MethodDeclaration,
  type ConstructorDeclaration,
  type ClassDeclaration,
  type ClassExpression,
  type VariableDeclaration,
  type ParameterDeclaration,
  VariableDeclarationKind,
} from "ts-morph";
import type {
  IRModule, IRNode, IRFunction, IRParameter, IRVariable, IRLiteral, IRCall,
  IRAssignment, FlowRef, Loc,
} from "./types.js";
import { EMPTY_FLOW } from "./types.js";
import { EQ_OPERATOR, flowSourcesOf, isEqOperator, thisFieldOf } from "./expressions.js";
import { collectGuards, type Guard } from "./guards.js";

function locOf(node: Node, file: string): Loc {
  const sf = node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
  const end = sf.getLineAndColumnAtPos(node.getEnd());
  return { file, line, col: column, endLine: end.line, endCol: end.column };
}

function idOf(kind: string, loc: Loc): string {
  return `${loc.file}#${kind}@${loc.line}:${loc.col}`;
}

/**
 * Id del nodo Call que le corresponde a una CallExpression del AST.
 *
 * Se ubica en el paréntesis que abre los argumentos, no en el inicio de la
 * expresión: en `db.collection("u").find(q).toArray()` las tres llamadas
 * empiezan en `db`, y con el inicio compartían id y quedaban fusionadas en un
 * solo nodo. La `loc` del nodo sigue siendo el inicio de la llamada.
 */
function callIdOf(call: Node, file: string): string {
  const paren = call.getFirstChildByKind(SyntaxKind.OpenParenToken);
  return idOf("Call", locOf(paren ?? call, file));
}

/**
 * Validaciones del archivo que se está construyendo (ver `guards.ts`). Se
 * fijan al empezar `buildIR` para no pasarlas por cada función que arma un
 * flujo; `buildIR` es sincrónico y las limpia al terminar.
 */
let activeGuards: readonly Guard[] = [];

/** Convierte el resultado del walker en una referencia serializable. */
function flowRefOf(expr: Node | undefined, file: string): FlowRef {
  if (!expr) return { ...EMPTY_FLOW };
  const { names, calls } = flowSourcesOf(expr, activeGuards);
  return { names, callIds: calls.map((c) => callIdOf(c, file)) };
}

export type FunctionLike =
  | FunctionDeclaration
  | ArrowFunction
  | FunctionExpression
  | MethodDeclaration
  | ConstructorDeclaration;

function isFunctionLike(node: Node): node is FunctionLike {
  return (
    TsNode.isFunctionDeclaration(node)
    || TsNode.isArrowFunction(node)
    || TsNode.isFunctionExpression(node)
    || TsNode.isMethodDeclaration(node)
    || TsNode.isConstructorDeclaration(node)
  );
}

type ClassLike = ClassDeclaration | ClassExpression;

function isClassLike(node: Node): node is ClassLike {
  return TsNode.isClassDeclaration(node) || TsNode.isClassExpression(node);
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

/**
 * Las clases también abren un ámbito: el de sus campos (`this.repo`), que ven
 * todos sus métodos y ninguna otra clase.
 */
function isScopeNode(node: Node): boolean {
  return (
    TsNode.isSourceFile(node)
    || isFunctionLike(node)
    || isClassLike(node)
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

/** Nombre de una propiedad sin comillas (`"find"` → `find`). */
function propertyNameText(name: Node): string {
  if (TsNode.isStringLiteral(name) || TsNode.isNoSubstitutionTemplateLiteral(name)) {
    return name.getLiteralValue();
  }
  return TsNode.isIdentifier(name) || TsNode.isPrivateIdentifier(name) ? name.getText() : "";
}

/**
 * Nombre con el que se llama a un objeto literal o una clase: la variable que
 * lo guarda (`const svc = {...}`) o el destino al que se asigna
 * (`module.exports = {...}`). Vacío si es anónimo.
 */
function containerNameOf(node: Node): string {
  if (TsNode.isClassDeclaration(node)) return node.getName() ?? "";
  const parent = node.getParent();
  if (!parent) return "";
  if (TsNode.isVariableDeclaration(parent)) {
    const nameNode = parent.getNameNode();
    return TsNode.isIdentifier(nameNode) ? nameNode.getText() : "";
  }
  if (
    TsNode.isBinaryExpression(parent)
    && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken
    && parent.getRight() === node
  ) {
    return parent.getLeft().getText().replace(/\s+/g, "");
  }
  if (TsNode.isClassExpression(node)) return node.getName() ?? "";
  return "";
}

/**
 * Nombre por el que se invoca la función y el contenedor del que es miembro.
 *
 * Una arrow o function expression no tiene nombre propio, pero se la llama por
 * el de la variable, campo o propiedad que la guarda: `const find = (id) =>
 * ...` se invoca como `find(id)`. Sin esto, solo las `function` declaradas por
 * nombre se resolvían, y el código escrito con arrows (la mayoría de Express
 * moderno) quedaba fuera del call graph.
 */
function fnIdentityOf(fn: FunctionLike): { name: string; memberOf?: string } {
  const parent = fn.getParent();

  if (TsNode.isFunctionDeclaration(fn)) return { name: fn.getName() ?? "" };

  // `new Svc(x)` se resuelve a `Svc.constructor` (ver `FunctionIndex.resolve`).
  if (TsNode.isConstructorDeclaration(fn)) {
    const owner = parent && isClassLike(parent) ? containerNameOf(parent) : "";
    return { name: "constructor", memberOf: owner || undefined };
  }

  if (TsNode.isMethodDeclaration(fn)) {
    const owner = parent && (TsNode.isClassDeclaration(parent)
      || TsNode.isClassExpression(parent)
      || TsNode.isObjectLiteralExpression(parent))
      ? containerNameOf(parent)
      : "";
    return { name: propertyNameText(fn.getNameNode()), memberOf: owner || undefined };
  }

  // Arrow o function expression: el nombre viene de donde se la guarda.
  if (parent && TsNode.isVariableDeclaration(parent)) {
    const nameNode = parent.getNameNode();
    if (TsNode.isIdentifier(nameNode)) return { name: nameNode.getText() };
  }
  if (parent && TsNode.isPropertyDeclaration(parent)) {
    const cls = parent.getParent();
    return {
      name: propertyNameText(parent.getNameNode()),
      memberOf: cls ? containerNameOf(cls) || undefined : undefined,
    };
  }
  if (parent && TsNode.isPropertyAssignment(parent)) {
    const obj = parent.getParent();
    return {
      name: propertyNameText(parent.getNameNode()),
      memberOf: obj ? containerNameOf(obj) || undefined : undefined,
    };
  }
  if (
    parent
    && TsNode.isBinaryExpression(parent)
    && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken
    && parent.getRight() === fn
  ) {
    const left = parent.getLeft();
    if (TsNode.isPropertyAccessExpression(left)) {
      return {
        name: left.getName(),
        memberOf: left.getExpression().getText().replace(/\s+/g, ""),
      };
    }
    if (TsNode.isIdentifier(left)) return { name: left.getText() };
  }
  if (TsNode.isFunctionExpression(fn)) return { name: fn.getName() ?? "" };
  return { name: "" };
}

/**
 * A qué apunta `this` en el lugar de una llamada: la clase o el objeto
 * literal con nombre más cercano que la encierra.
 */
function thisOwnerOf(node: Node): string | undefined {
  for (const anc of node.getAncestors()) {
    if (TsNode.isClassDeclaration(anc) || TsNode.isClassExpression(anc)) {
      return containerNameOf(anc) || undefined;
    }
    if (TsNode.isObjectLiteralExpression(anc)) {
      const name = containerNameOf(anc);
      if (name) return name;
    }
  }
  return undefined;
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
    const decorators = p.getDecorators().map((d) => d.getName());
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
        ...(decorators.length > 0 ? { decorators } : {}),
      };
      positionalId ??= param.id;
      nodes.push(param);
    }
    if (positionalId) paramIds.push(positionalId);
  });

  const returns = returnExpressionsOf(fn);
  const { name, memberOf } = fnIdentityOf(fn);
  const irFn: IRFunction = {
    id: fnId,
    kind: "Function",
    name,
    ...(memberOf ? { memberOf } : {}),
    code: fn.getText(),
    loc: fnLoc,
    scopePath: scopePathOf(fn),
    paramIds,
    returnTexts: returns.map((r) => r.getText()),
    returnFlows: returns.map((r) => flowRefOf(r, file)),
    returnScopePaths: returns.map((r) => scopePathOf(r)),
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
  for (const ctor of sourceFile.getDescendantsOfKind(SyntaxKind.Constructor)) {
    out.push(ctor);
  }
  return out;
}

/** Clase que encierra al nodo, si `this` apunta a ella (no a un objeto literal). */
function enclosingClass(node: Node): ClassLike | undefined {
  return node.getFirstAncestor(isClassLike);
}

/**
 * Un campo de clase se modela como una variable de la clase: `this.x = x` en
 * el constructor la escribe y `this.x` en otro método la lee. Sin esto, el
 * dato se perdía al guardarse en la instancia y el patrón servicio/repositorio
 * (el dato entra por el constructor y se usa en un método) quedaba sin
 * hallazgo.
 *
 * Se crea una variable por campo y por clase, en el ámbito de la clase: la
 * ven todos sus métodos y ninguna otra clase. Las escrituras `this.x = ...`
 * llegan como asignaciones comunes (ver `collectAssignments`); acá se suman
 * los campos declarados con valor (`repo = crearRepo()`) y los parámetros con
 * modificador de TypeScript (`constructor(private repo: Repo)`).
 */
function emitClassFields(
  sourceFile: SourceFile,
  file: string,
  nodes: IRNode[],
  assignments: IRAssignment[],
): void {
  const fields = new Map<ClassLike, Map<string, { at: Node; init?: Node }>>();
  const note = (cls: ClassLike, name: string, at: Node, init?: Node) => {
    let byName = fields.get(cls);
    if (!byName) fields.set(cls, (byName = new Map()));
    if (!byName.has(name)) byName.set(name, { at, init });
  };

  for (const cls of [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassExpression),
  ]) {
    for (const prop of cls.getProperties()) {
      if (prop.isStatic()) continue;
      const name = propertyNameText(prop.getNameNode());
      if (name) note(cls, `this.${name}`, prop, prop.getInitializer());
    }
    for (const ctor of cls.getConstructors()) {
      for (const param of ctor.getParameters()) {
        if (!param.isParameterProperty()) continue;
        const name = param.getName();
        note(cls, `this.${name}`, param);
        assignments.push({
          target: `this.${name}`,
          flow: { names: [name], callIds: [] },
          ownerFnId: idOf("Function", locOf(ctor, file)),
          scopePath: scopePathOf(param),
        });
      }
    }
  }

  for (const bin of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const field = thisFieldOf(bin.getLeft());
    const cls = field ? enclosingClass(bin) : undefined;
    if (field && cls) note(cls, field, bin.getLeft());
  }

  for (const [cls, byName] of fields) {
    const scopePath = [...scopePathOf(cls), scopeIdOf(cls)];
    for (const [name, { at, init }] of byName) {
      const loc = locOf(at, file);
      const initFlow = flowRefOf(init, file);
      nodes.push({
        id: idOf("Variable", loc),
        kind: "Variable",
        name,
        code: at.getText(),
        loc,
        scopePath,
        initText: init ? init.getText() : null,
        initFlow: { names: [...initFlow.names], callIds: [...initFlow.callIds] },
        ownerFnId: null,
      } satisfies IRVariable);
    }
  }
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

/** Nombre local → de qué paquete y con qué nombre se importó. */
type PackageBindings = Map<string, { module: string; imported: string }>;

/** `node:child_process` → `child_process`. Las rutas relativas no son paquetes. */
function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  return specifier.replace(/^node:/, "");
}

/** `require("x")` → `"x"`. */
function requireTarget(node: Node | undefined): string | null {
  if (!node || !TsNode.isCallExpression(node)) return null;
  if (node.getExpression().getText() !== "require") return null;
  const [arg] = node.getArguments();
  return arg && TsNode.isStringLiteral(arg) ? arg.getLiteralValue() : null;
}

/**
 * Nombres locales que vienen de un paquete, por `import` o `require`:
 * `import { exec } from "child_process"`, `import * as cp from "node:child_process"`,
 * `const { execSync: run } = require("child_process")`.
 */
function packageBindingsOf(sourceFile: SourceFile): PackageBindings {
  const out: PackageBindings = new Map();
  for (const decl of sourceFile.getImportDeclarations()) {
    const module = packageNameOf(decl.getModuleSpecifierValue());
    if (!module) continue;
    const def = decl.getDefaultImport();
    if (def) out.set(def.getText(), { module, imported: "*" });
    const ns = decl.getNamespaceImport();
    if (ns) out.set(ns.getText(), { module, imported: "*" });
    for (const spec of decl.getNamedImports()) {
      const local = spec.getAliasNode()?.getText() ?? spec.getName();
      out.set(local, { module, imported: spec.getName() });
    }
  }
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const target = requireTarget(decl.getInitializer());
    const module = target ? packageNameOf(target) : null;
    if (!module) continue;
    const nameNode = decl.getNameNode();
    if (TsNode.isIdentifier(nameNode)) {
      out.set(nameNode.getText(), { module, imported: "*" });
    } else if (TsNode.isObjectBindingPattern(nameNode)) {
      for (const el of nameNode.getElements()) {
        const local = el.getNameNode();
        if (!TsNode.isIdentifier(local)) continue;
        out.set(local.getText(), {
          module,
          imported: el.getPropertyNameNode()?.getText() ?? local.getText(),
        });
      }
    }
  }
  return out;
}

/** `cp.exec` con `cp` = `child_process` → `child_process.exec`. */
function qualifiedCalleeOf(callee: string, bindings: PackageBindings): string | undefined {
  const normalized = callee.replace(/\s+/g, "").replace(/\?\./g, ".");
  const dot = normalized.indexOf(".");
  const head = dot === -1 ? normalized : normalized.slice(0, dot);
  const rest = dot === -1 ? "" : normalized.slice(dot);
  const binding = bindings.get(head);
  if (!binding) return undefined;
  const base = binding.imported === "*" ? binding.module : `${binding.module}.${binding.imported}`;
  return base + rest;
}

/**
 * `fileName` permite conservar la ruta relativa al escanear un proyecto
 * (`src/routes/users.ts` en vez de `users.ts`), de modo que los ids de nodo
 * sean únicos entre archivos y los hallazgos apunten al lugar correcto.
 */
export function buildIR(sourceFile: SourceFile, fileName?: string): IRModule {
  const guards = collectGuards(sourceFile);
  activeGuards = guards;
  try {
    return buildModule(sourceFile, fileName ?? sourceFile.getBaseName(), guards);
  } finally {
    activeGuards = [];
  }
}

function buildModule(sourceFile: SourceFile, file: string, guards: readonly Guard[]): IRModule {
  const nodes: IRNode[] = [];
  const validators = new Set(guards.map((g) => g.call));

  for (const fn of collectFunctionLikes(sourceFile)) {
    emitFunction(fn, file, nodes);
  }

  // Inicializador de cada variable simple, por función: `finance.save()`
  // necesita saber si `finance` salió de `new Finance(req.body)`.
  const initializers = new Map<string, string>();
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    emitVariables(decl, file, nodes);
    const init = decl.getInitializer();
    if (!init || !TsNode.isIdentifier(decl.getNameNode())) continue;
    const key = `${ownerFnIdOf(decl, file)}\t${decl.getName()}`;
    if (!initializers.has(key)) initializers.set(key, init.getText());
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

  const packages = packageBindingsOf(sourceFile);
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const cLoc = locOf(call, file);
    const args = call.getArguments();
    const irCall: IRCall = {
      id: callIdOf(call, file),
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
    const owner = thisOwnerOf(call);
    if (owner) irCall.thisOwner = owner;
    const qualified = qualifiedCalleeOf(irCall.callee, packages);
    if (qualified) irCall.qualifiedCallee = qualified;
    if (validators.has(call)) irCall.validates = true;
    const callee = call.getExpression();
    if (TsNode.isPropertyAccessExpression(callee) && TsNode.isIdentifier(callee.getExpression())) {
      const init = initializers.get(`${irCall.ownerFnId}\t${callee.getExpression().getText()}`);
      if (init !== undefined) irCall.receiverInit = init;
    }
    nodes.push(irCall);
  }

  // `{ $eq: x }`: MongoDB compara `x` como valor y no interpreta operadores
  // adentro. Un nodo Call `$eq` en el medio deja que el catálogo lo trate
  // como sanitizer de NoSQL sin cortar el dato para otras familias.
  for (const prop of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (!isEqOperator(prop)) continue;
    const value = prop.getInitializer();
    nodes.push({
      id: callIdOf(prop, file),
      kind: "Call",
      name: EQ_OPERATOR,
      code: prop.getText(),
      loc: locOf(prop, file),
      scopePath: scopePathOf(prop),
      callee: EQ_OPERATOR,
      argTexts: value ? [value.getText()] : [],
      argFlows: [flowRefOf(value, file)],
      receiverFlow: { ...EMPTY_FLOW },
      ownerFnId: ownerFnIdOf(prop, file),
    });
  }

  // `new X(args)`: un nodo Call para ligar los argumentos con el constructor
  // de `X` (y para sinks como `new Function(code)`). El valor de la expresión
  // sigue siendo transparente (ver `flowSourcesOf`).
  for (const expr of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const args = expr.getArguments() ?? [];
    const callee = expr.getExpression().getText();
    const irCall: IRCall = {
      id: callIdOf(expr, file),
      kind: "Call",
      name: `new ${callee}`,
      code: expr.getText(),
      loc: locOf(expr, file),
      scopePath: scopePathOf(expr),
      callee,
      argTexts: args.map((a) => a.getText()),
      argFlows: args.map((a) => flowRefOf(a, file)),
      receiverFlow: { ...EMPTY_FLOW },
      ownerFnId: ownerFnIdOf(expr, file),
      isNew: true,
    };
    const qualified = qualifiedCalleeOf(callee, packages);
    if (qualified) irCall.qualifiedCallee = qualified;
    nodes.push(irCall);
  }

  emitPropertyWriteSinks(sourceFile, file, nodes);

  const assignments = collectAssignments(sourceFile, file);
  emitClassFields(sourceFile, file, nodes, assignments);
  return { file, nodes, assignments };
}
