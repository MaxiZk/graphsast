import type { IRCall, IRFunction, IRNode } from "../ir/types.js";

/**
 * Nombres de métodos de la biblioteca estándar (Array, String, Map, Promise,
 * EventEmitter, objetos de Express...). Una llamada `algo.m()` con receptor
 * desconocido no se ata a un método propio con uno de estos nombres aunque
 * sea el único del proyecto: `users.find(...)` es casi siempre `Array.find`,
 * no `UserService.find`, y ligarlos inventaría un flujo.
 */
export const BUILTIN_METHOD_NAMES: ReadonlySet<string> = new Set([
  // Array
  "at", "concat", "copyWithin", "entries", "every", "fill", "filter", "find",
  "findIndex", "findLast", "findLastIndex", "flat", "flatMap", "forEach",
  "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "pop", "push",
  "reduce", "reduceRight", "reverse", "shift", "slice", "some", "sort",
  "splice", "unshift", "values", "with", "toSorted", "toReversed", "toSpliced",
  // String
  "charAt", "charCodeAt", "codePointAt", "endsWith", "localeCompare", "match",
  "matchAll", "normalize", "padEnd", "padStart", "repeat", "replace",
  "replaceAll", "search", "split", "startsWith", "substring", "substr",
  "toLowerCase", "toUpperCase", "trim", "trimEnd", "trimStart",
  // Map / Set / WeakMap
  "get", "set", "has", "delete", "add", "clear", "size",
  // Promise
  "then", "catch", "finally",
  // Object / Function
  "toString", "valueOf", "toJSON", "hasOwnProperty", "call", "apply", "bind",
  // RegExp
  "exec", "test",
  // EventEmitter / streams / Express
  "on", "once", "off", "emit", "addListener", "removeListener", "pipe",
  "write", "end", "send", "json", "status", "render", "redirect", "use",
  "listen", "next", "close", "destroy",
  // console
  "log", "info", "warn", "error", "debug", "trace",
]);

/** `a ?. b . c` → `a.b.c`: el texto del callee sin espacios ni `?.`. */
export function normalizeCallee(callee: string): string {
  return callee.replace(/\s+/g, "").replace(/\?\./g, ".");
}

/** Último segmento de un callee miembro (`this.repo.save` → `save`). */
function memberName(callee: string): string | null {
  const dot = callee.lastIndexOf(".");
  return dot === -1 ? null : callee.slice(dot + 1);
}

/**
 * Resultado de resolver una llamada. `exact` distingue lo que se sabe (el
 * nombre o el contenedor coinciden) de lo que se adivina (paso 4): quien
 * construye el grafo conserva el atajo argumento → llamada cuando adivina, para
 * no perder un sink real si la adivinanza es errónea.
 */
export interface Resolution {
  targets: IRFunction[];
  exact: boolean;
}

function exactly(targets: IRFunction[] | undefined): Resolution {
  return { targets: targets ?? [], exact: true };
}

/**
 * Índice de funciones para resolver llamadas por nombre. Se arma con las
 * funciones de un archivo o, para el análisis entre archivos, de varios.
 */
export class FunctionIndex {
  /** Funciones sueltas por nombre (`function f`, `const f = () => {}`). */
  private readonly plain = new Map<string, IRFunction[]>();
  /** Miembros por `contenedor.nombre` (`UserService.find`, `svc.find`). */
  private readonly qualified = new Map<string, IRFunction[]>();
  /** Miembros por nombre, sin contenedor. */
  private readonly members = new Map<string, IRFunction[]>();

  constructor(nodes: Iterable<IRNode>) {
    for (const node of nodes) {
      if (node.kind !== "Function" || !node.name) continue;
      const fn = node as IRFunction;
      if (fn.memberOf) {
        push(this.qualified, `${fn.memberOf}.${fn.name}`, fn);
        push(this.members, fn.name, fn);
      } else {
        push(this.plain, fn.name, fn);
      }
    }
  }

  /**
   * Funciones a las que puede apuntar una llamada, de la más a la menos
   * precisa:
   *
   * 1. `f(...)` → funciones sueltas llamadas `f`.
   * 2. `this.m(...)` → el miembro `m` de la clase u objeto que encierra la
   *    llamada.
   * 3. `X.m(...)` con `X` una clase u objeto con nombre → su miembro `m`.
   * 4. `algo.m(...)` con receptor desconocido (`this.repo.save()`,
   *    `svc.findOne()`) → el miembro `m` solo si es el único con ese nombre y
   *    no es un nombre de la biblioteca estándar. Es una heurística: sin tipos
   *    no se sabe qué hay en `algo`, pero un nombre único en todo el código
   *    analizado casi siempre es ese.
   */
  resolve(call: IRCall): Resolution {
    const callee = normalizeCallee(call.callee);
    const member = memberName(callee);
    if (member === null) return exactly(this.plain.get(callee));

    if (callee === `this.${member}` && call.thisOwner) {
      const own = this.qualified.get(`${call.thisOwner}.${member}`);
      if (own) return exactly(own);
    }

    const qualified = this.qualified.get(callee);
    if (qualified) return exactly(qualified);

    return { targets: this.uniqueMember(member), exact: false };
  }

  /** El único miembro con ese nombre, o ninguno (heurística del paso 4). */
  uniqueMember(name: string): IRFunction[] {
    if (BUILTIN_METHOD_NAMES.has(name)) return [];
    const candidates = this.members.get(name);
    return candidates && candidates.length === 1 ? candidates : [];
  }

  /** ¿Hay algún miembro con ese nombre? (para no duplicar resoluciones). */
  hasMember(name: string): boolean {
    return this.members.has(name);
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
