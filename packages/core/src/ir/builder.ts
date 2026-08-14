import {
  type SourceFile,
  type Node,
  SyntaxKind,
  Node as TsNode,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from "ts-morph";
import type {
  IRModule, IRNode, IRFunction, IRParameter, IRVariable, IRLiteral, IRCall, Loc,
} from "./types.js";

function locOf(node: Node, file: string): Loc {
  const sf = node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
  return { file, line, col: column };
}

function idOf(kind: string, loc: Loc): string {
  return `${loc.file}#${kind}@${loc.line}:${loc.col}`;
}

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

function isFunctionLike(node: Node): node is FunctionLike {
  return (
    TsNode.isFunctionDeclaration(node)
    || TsNode.isArrowFunction(node)
    || TsNode.isFunctionExpression(node)
  );
}

function ownerFnIdOf(node: Node, file: string): string | null {
  const fn = node.getFirstAncestor(isFunctionLike);
  if (!fn) return null;
  return idOf("Function", locOf(fn, file));
}

function fnNameOf(fn: FunctionLike): string {
  if (TsNode.isFunctionDeclaration(fn)) return fn.getName() ?? "";
  return "";
}

function returnTextsOf(fn: FunctionLike): string[] {
  if (TsNode.isArrowFunction(fn)) {
    const body = fn.getBody();
    if (TsNode.isBlock(body)) {
      const texts: string[] = [];
      for (const ret of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
        const expr = ret.getExpression();
        if (expr) texts.push(expr.getText());
      }
      return texts;
    }
    return [body.getText()];
  }
  const texts: string[] = [];
  for (const ret of fn.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const expr = ret.getExpression();
    if (expr) texts.push(expr.getText());
  }
  return texts;
}

function emitFunction(fn: FunctionLike, file: string, nodes: IRNode[]): void {
  const fnLoc = locOf(fn, file);
  const fnId = idOf("Function", fnLoc);
  const paramIds: string[] = [];

  fn.getParameters().forEach((p, index) => {
    const pLoc = locOf(p, file);
    const param: IRParameter = {
      id: idOf("Parameter", pLoc),
      kind: "Parameter",
      name: p.getName(),
      code: p.getText(),
      loc: pLoc,
      index,
      ownerFnId: fnId,
    };
    paramIds.push(param.id);
    nodes.push(param);
  });

  const irFn: IRFunction = {
    id: fnId,
    kind: "Function",
    name: fnNameOf(fn),
    code: fn.getText(),
    loc: fnLoc,
    paramIds,
    returnTexts: returnTextsOf(fn),
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
  return out;
}

export function buildIR(sourceFile: SourceFile): IRModule {
  const file = sourceFile.getBaseName();
  const nodes: IRNode[] = [];

  for (const fn of collectFunctionLikes(sourceFile)) {
    emitFunction(fn, file, nodes);
  }

  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const vLoc = locOf(decl, file);
    const init = decl.getInitializer();
    const irVar: IRVariable = {
      id: idOf("Variable", vLoc),
      kind: "Variable",
      name: decl.getName(),
      code: decl.getText(),
      loc: vLoc,
      initText: init ? init.getText() : null,
      ownerFnId: ownerFnIdOf(decl, file),
    };
    nodes.push(irVar);
  }

  for (const lit of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const lLoc = locOf(lit, file);
    const irLit: IRLiteral = {
      id: idOf("Literal", lLoc),
      kind: "Literal",
      name: "",
      code: lit.getText(),
      loc: lLoc,
      value: lit.getLiteralValue(),
      ownerFnId: ownerFnIdOf(lit, file),
    };
    nodes.push(irLit);
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const cLoc = locOf(call, file);
    const irCall: IRCall = {
      id: idOf("Call", cLoc),
      kind: "Call",
      name: call.getExpression().getText(),
      code: call.getText(),
      loc: cLoc,
      callee: call.getExpression().getText(),
      argTexts: call.getArguments().map((a) => a.getText()),
      ownerFnId: ownerFnIdOf(call, file),
    };
    nodes.push(irCall);
  }

  return { file, nodes };
}
