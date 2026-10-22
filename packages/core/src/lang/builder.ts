import type { Node as TsNode } from "web-tree-sitter";
import type {
  FlowRef, IRAssignment, IRCall, IRFunction, IRModule, IRNode, IRParameter, IRVariable, Loc,
} from "../ir/types.js";
import { EMPTY_FLOW } from "../ir/types.js";
import type { CallInfo, FunctionInfo, LanguageSpec, SyntheticCall } from "./spec.js";

/**
 * Árbol de tree-sitter → representación intermedia, para cualquier lenguaje
 * con una `LanguageSpec`. Produce los mismos nodos que el builder de
 * JavaScript (funciones, parámetros, variables, llamadas) con la misma forma
 * de ids, ámbitos y flujos, así el grafo y el análisis se reutilizan.
 *
 * Simplificaciones respecto de JavaScript: los ámbitos son las funciones y
 * las clases (no los bloques), cada asignación es una definición nueva y no
 * se siguen llamadas entre archivos.
 */

interface Context {
  fnId: string | null;
  scopes: string[];
  /** Ámbito de la clase que encierra al nodo, para los campos `this.x`. */
  classScopes: string[] | null;
  className: string | null;
  route: boolean;
}

interface PendingFunction {
  id: string;
  node: TsNode;
  info: FunctionInfo;
  scopes: string[];
  returns: TsNode[];
  returnScopes: string[][];
}

export function buildForeignModule(root: TsNode, file: string, spec: LanguageSpec): IRModule {
  // web-tree-sitter parsea el texto como UTF-16: las columnas ya están en
  // caracteres de JavaScript, como las de ts-morph.
  const locOf = (node: TsNode): Loc => {
    const start = node.startPosition;
    const end = node.endPosition;
    return { file, line: start.row + 1, col: start.column + 1, endLine: end.row + 1, endCol: end.column + 1 };
  };
  const idOf = (kind: string, node: TsNode): string => {
    const loc = locOf(node);
    return `${file}#${kind}@${loc.line}:${loc.col}`;
  };

  // Las consultas a la spec se repiten (flujos, ids): una vez por nodo.
  const callCache = new Map<number, CallInfo | null>();
  const callOf = (node: TsNode) => {
    if (!callCache.has(node.id)) callCache.set(node.id, spec.callOf(node));
    return callCache.get(node.id)!;
  };
  const inputCache = new Map<number, string | null>();
  const inputOf = (node: TsNode) => {
    if (!spec.inputOf) return null;
    if (!inputCache.has(node.id)) inputCache.set(node.id, spec.inputOf(node));
    return inputCache.get(node.id)!;
  };
  const syntheticCache = new Map<number, SyntheticCall | null>();
  const syntheticOf = (node: TsNode) => {
    if (!spec.syntheticOf) return null;
    if (!syntheticCache.has(node.id)) syntheticCache.set(node.id, spec.syntheticOf(node));
    return syntheticCache.get(node.id)!;
  };
  /** Id del nodo Call de una expresión: el paréntesis si es una llamada. */
  const callIdFor = (node: TsNode): string => {
    const call = callOf(node);
    return idOf("Call", call ? call.idAt : node);
  };

  const skipFields = spec.nonExpressionFields ?? new Set<string>();
  const opaque = spec.opaqueTypes ?? new Set<string>();

  /** Raíces de flujo de una expresión: mismo contrato que `flowSourcesOf` de JS. */
  const flowOf = (expr: TsNode | null | undefined): FlowRef => {
    if (!expr) return { ...EMPTY_FLOW };
    const names: string[] = [];
    const callIds: string[] = [];
    const visit = (node: TsNode): void => {
      if (inputOf(node) !== null || syntheticOf(node) || callOf(node)) {
        callIds.push(callIdFor(node));
        return;
      }
      const field = spec.thisFieldOf?.(node);
      if (field) {
        names.push(field);
        return;
      }
      const name = spec.identifierOf(node);
      if (name !== null) {
        names.push(name);
        return;
      }
      const object = spec.memberObjectOf(node);
      if (object) {
        visit(object);
        return;
      }
      if (opaque.has(node.type) || spec.functionOf(node)) return;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child || !child.isNamed) continue;
        const fieldName = node.fieldNameForChild(i);
        if (fieldName && skipFields.has(fieldName)) continue;
        visit(child);
      }
    };
    visit(expr);
    return { names: [...new Set(names)], callIds };
  };

  spec.prepare?.(root);

  const nodes: IRNode[] = [];
  const assignments: IRAssignment[] = [];
  const functions: PendingFunction[] = [];
  const functionsById = new Map<string, PendingFunction>();
  const calls: { node: TsNode; info: CallInfo; ctx: Context }[] = [];
  const extras: { node: TsNode; callee: string; args: TsNode[]; ctx: Context; input?: boolean; idAt?: TsNode }[] = [];
  /** Campos `this.x` ya declarados, por clase. */
  const fieldDefs = new Set<string>();
  /** Inicializador de cada variable por función, para `receiverInit`/`firstArgInit`. */
  const initializers = new Map<string, string>();

  const stack: { node: TsNode; ctx: Context }[] = [{
    node: root,
    ctx: { fnId: null, scopes: [`S${root.startIndex}`], classScopes: null, className: null, route: false },
  }];

  while (stack.length > 0) {
    const { node, ctx } = stack.pop()!;
    const fn = spec.functionOf(node);
    const cls = fn ? null : spec.classNameOf(node);
    let childCtx = ctx;

    if (fn) {
      const id = idOf("Function", node);
      const scopes = [...ctx.scopes, `S${node.startIndex}`];
      const pending: PendingFunction = { id, node, info: fn, scopes, returns: [], returnScopes: [] };
      functions.push(pending);
      functionsById.set(id, pending);
      childCtx = { ...ctx, fnId: id, scopes, route: fn.routeHandler === true };
    } else if (cls !== null) {
      const scopes = [...ctx.scopes, `S${node.startIndex}`];
      childCtx = { ...ctx, scopes, classScopes: scopes, className: cls || null };
    }

    const call = callOf(node);
    const input = inputOf(node);
    if (call) {
      calls.push({ node, info: call, ctx });
    } else if (input !== null) {
      const parent = node.parent;
      const outer = parent !== null && inputOf(parent) !== null && spec.memberObjectOf(parent)?.id === node.id;
      if (!outer) extras.push({ node, callee: input, args: [], ctx, input: true });
    } else {
      const synthetic = syntheticOf(node);
      if (synthetic) extras.push({ node, callee: synthetic.callee, args: synthetic.args, ctx });
    }

    for (const binding of spec.bindingsOf(node)) {
      // `self.x = valor` en un método: el campo es una variable de la clase
      // (la ven todos sus métodos) y esta escritura, una asignación desde el
      // método, donde se resuelven los nombres del valor. Igual que en JS.
      if (binding.name.startsWith("this.") && ctx.classScopes) {
        const key = `${ctx.classScopes.join("/")}\t${binding.name}`;
        if (!fieldDefs.has(key)) {
          fieldDefs.add(key);
          nodes.push({
            id: idOf("Variable", binding.at),
            kind: "Variable",
            name: binding.name,
            code: binding.at.text,
            loc: locOf(binding.at),
            scopePath: ctx.classScopes,
            initText: null,
            initFlow: { ...EMPTY_FLOW },
            ownerFnId: null,
          } satisfies IRVariable);
        }
        if (binding.value) {
          assignments.push({ target: binding.name, flow: flowOf(binding.value), ownerFnId: ctx.fnId, scopePath: ctx.scopes });
        }
        continue;
      }
      const scopes = ctx.scopes;
      const variable: IRVariable = {
        id: idOf("Variable", binding.at),
        kind: "Variable",
        name: binding.name,
        code: (binding.value ? node : binding.at).text,
        loc: locOf(binding.at),
        scopePath: scopes,
        initText: binding.value?.text ?? null,
        initFlow: flowOf(binding.value),
        ownerFnId: ctx.fnId,
      };
      nodes.push(variable);
      if (binding.value) {
        const key = `${ctx.fnId}\t${binding.name}`;
        if (!initializers.has(key)) initializers.set(key, binding.value.text);
      }
    }

    const returned = spec.returnValueOf(node);
    if (returned !== undefined && ctx.fnId) {
      const owner = functionsById.get(ctx.fnId);
      if (owner && returned) {
        owner.returns.push(returned);
        owner.returnScopes.push(ctx.scopes);
        if (ctx.route) extras.push({ node, callee: "@route.return", args: [returned], ctx });
      }
    }

    // Hijos en orden inverso: la pila los procesa en el orden del código.
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i);
      if (child) stack.push({ node: child, ctx: childCtx });
    }
  }

  for (const { id, node, info, scopes, returns, returnScopes } of functions) {
    const paramIds: string[] = [];
    info.params.forEach((param, index) => {
      const p: IRParameter = {
        id: idOf("Parameter", param.at),
        kind: "Parameter",
        name: param.name,
        code: param.at.text,
        loc: locOf(param.at),
        scopePath: scopes,
        index,
        ownerFnId: id,
        ...(param.decorators?.length ? { decorators: param.decorators } : {}),
      };
      paramIds.push(p.id);
      nodes.push(p);
    });
    const irFn: IRFunction = {
      id,
      kind: "Function",
      name: info.name,
      ...(info.memberOf ? { memberOf: info.memberOf } : {}),
      code: node.text,
      loc: locOf(node),
      scopePath: scopes.slice(0, -1),
      paramIds,
      returnTexts: returns.map((r) => r.text),
      returnFlows: returns.map((r) => flowOf(r)),
      returnScopePaths: returnScopes,
    };
    nodes.push(irFn);
  }

  for (const { node, info, ctx } of calls) {
    const irCall: IRCall = {
      id: idOf("Call", info.idAt),
      kind: "Call",
      name: info.isNew && spec.newKeyword ? `new ${info.callee}` : info.callee,
      code: node.text,
      loc: locOf(node),
      scopePath: ctx.scopes,
      callee: info.callee,
      argTexts: info.args.map((a) => a.text),
      argFlows: info.args.map((a) => flowOf(a)),
      receiverFlow: flowOf(info.receiver),
      ownerFnId: ctx.fnId,
      ...(info.isNew ? { isNew: true as const } : {}),
      ...(ctx.className ? { thisOwner: ctx.className } : {}),
    };
    const qualified = spec.qualify?.(info.callee);
    if (qualified) irCall.qualifiedCallee = qualified;
    if (inputOf(node) !== null) irCall.input = true;
    // La variable de la función o, si no la define, la del módulo
    // (`coleccion = MongoClient()["db"]["c"]` arriba de todo).
    const initOf = (name: string | null) =>
      name ? initializers.get(`${ctx.fnId}\t${name}`) ?? initializers.get(`null\t${name}`) : undefined;
    const receiverInit = initOf(info.receiver ? spec.identifierOf(info.receiver) : null);
    if (receiverInit !== undefined) irCall.receiverInit = receiverInit;
    const firstArgInit = initOf(info.args[0] ? spec.identifierOf(info.args[0]) : null);
    if (firstArgInit !== undefined) irCall.firstArgInit = firstArgInit;
    nodes.push(irCall);
  }

  for (const { node, callee, args, ctx, input } of extras) {
    nodes.push({
      id: idOf("Call", node),
      kind: "Call",
      name: callee,
      code: node.text,
      loc: locOf(node),
      scopePath: ctx.scopes,
      callee,
      argTexts: args.map((a) => a.text),
      argFlows: args.map((a) => flowOf(a)),
      receiverFlow: { ...EMPTY_FLOW },
      ownerFnId: ctx.fnId,
      ...(input ? { input: true as const } : {}),
    } satisfies IRCall);
  }

  return { file, nodes, assignments };
}
