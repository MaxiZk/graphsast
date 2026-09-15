# GraphSAST — Hito 1: Fundación + Parser + IR — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dado un archivo TypeScript/JavaScript, producir una IR (representación intermedia) normalizada con el inventario de funciones, parámetros, variables, literales y llamadas, cada uno con su ubicación (file/line/col).

**Architecture:** Pipeline de compilador. `parser` carga el código con `ts-morph` (TS Compiler API, JS puro, sin build nativo) y entrega un `SourceFile`. `ir` recorre ese árbol y emite nodos IR tipados y estables que los hitos siguientes (cfg/dfg/store) consumirán. Cada módulo se testea aislado con Vitest (TDD).

**Tech Stack:** TypeScript (ESM), Node v22, ts-morph, Vitest, npm workspaces.

**Prerequisitos:** Node ≥ 22 y npm ≥ 10 (verificados). Docker NO se necesita en este hito (recién en Hito 4 para Neo4j).

---

## Estructura de archivos (este hito)

```
graphsast/
├─ package.json                      # raíz, npm workspaces
├─ tsconfig.base.json                # config TS compartida
├─ .gitignore
└─ packages/
   └─ core/
      ├─ package.json
      ├─ tsconfig.json
      ├─ vitest.config.ts
      └─ src/
         ├─ parser/
         │  ├─ parser.ts             # loadSource(code, file) -> SourceFile
         │  └─ parser.test.ts
         └─ ir/
            ├─ types.ts              # tipos IR (sin lógica)
            ├─ builder.ts            # buildIR(sourceFile) -> IRModule
            └─ builder.test.ts
```

Responsabilidad por archivo:
- `parser/parser.ts`: única responsabilidad = convertir texto en `SourceFile` de ts-morph. No conoce la IR.
- `ir/types.ts`: solo definiciones de tipos. Sin imports de ts-morph.
- `ir/builder.ts`: recorre el `SourceFile` y emite `IRModule`. Es el único que conoce a la vez ts-morph y la IR.

---

## Task 0: Scaffolding del monorepo

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`

- [ ] **Step 1: Crear `.gitignore`**

```gitignore
node_modules/
dist/
coverage/
*.log
~$*
*.txt
.DS_Store
```

- [ ] **Step 2: Crear `package.json` raíz**

```json
{
  "name": "graphsast",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "tsc -b"
  }
}
```

- [ ] **Step 3: Crear `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Crear `packages/core/package.json`**

```json
{
  "name": "@graphsast/core",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "ts-morph": "^23.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 5: Crear `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Crear `packages/core/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: Instalar dependencias**

Run: `npm install`
Expected: crea `node_modules/` y `package-lock.json` sin errores de build nativo.

- [ ] **Step 8: Commit**

```bash
git add .gitignore package.json tsconfig.base.json packages/core/package.json packages/core/tsconfig.json packages/core/vitest.config.ts package-lock.json
git commit -m "chore: scaffold monorepo with core package, ts-morph and vitest"
```

---

## Task 1: Parser — cargar código a SourceFile

**Files:**
- Create: `packages/core/src/parser/parser.ts`
- Test: `packages/core/src/parser/parser.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// packages/core/src/parser/parser.test.ts
import { describe, it, expect } from "vitest";
import { loadSource } from "./parser.js";

describe("loadSource", () => {
  it("crea un SourceFile con el nombre de archivo dado", () => {
    const sf = loadSource("const x = 1;", "demo.ts");
    expect(sf.getBaseName()).toBe("demo.ts");
  });

  it("parsea declaraciones reconocibles por la API de ts-morph", () => {
    const sf = loadSource("function f() {}", "demo.ts");
    expect(sf.getFunctions()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -w @graphsast/core`
Expected: FAIL — `Cannot find module './parser.js'`.

- [ ] **Step 3: Implementación mínima**

```typescript
// packages/core/src/parser/parser.ts
import { Project, type SourceFile } from "ts-morph";

/**
 * Convierte texto fuente en un SourceFile de ts-morph en un FS en memoria.
 * Única responsabilidad: parsing. No conoce la IR.
 */
export function loadSource(code: string, file = "input.ts"): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true },
  });
  return project.createSourceFile(file, code, { overwrite: true });
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -w @graphsast/core`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parser/
git commit -m "feat(parser): load source code into ts-morph SourceFile"
```

---

## Task 2: Tipos de la IR

**Files:**
- Create: `packages/core/src/ir/types.ts`

- [ ] **Step 1: Definir los tipos IR (sin lógica, no requiere test propio)**

```typescript
// packages/core/src/ir/types.ts

export type IRNodeKind =
  | "Function"
  | "Parameter"
  | "Variable"
  | "Literal"
  | "Call";

export interface Loc {
  file: string;
  line: number;
  col: number;
}

export interface IRNodeBase {
  id: string;        // identificador estable: `${file}#${kind}@${line}:${col}`
  kind: IRNodeKind;
  name: string;      // nombre legible (nombre de var/función/callee; "" si no aplica)
  code: string;      // texto fuente del nodo
  loc: Loc;
}

export interface IRFunction extends IRNodeBase {
  kind: "Function";
  paramIds: string[];
}

export interface IRParameter extends IRNodeBase {
  kind: "Parameter";
  index: number;
  ownerFnId: string;
}

export interface IRVariable extends IRNodeBase {
  kind: "Variable";
  initText: string | null; // texto del inicializador, o null si no tiene
}

export interface IRLiteral extends IRNodeBase {
  kind: "Literal";
  value: string;
}

export interface IRCall extends IRNodeBase {
  kind: "Call";
  callee: string;     // texto de la expresión llamada, ej. "db.query"
  argTexts: string[]; // texto de cada argumento
}

export type IRNode =
  | IRFunction
  | IRParameter
  | IRVariable
  | IRLiteral
  | IRCall;

export interface IRModule {
  file: string;
  nodes: IRNode[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/ir/types.ts
git commit -m "feat(ir): define IR node and module types"
```

---

## Task 3: Builder — funciones y parámetros

**Files:**
- Create: `packages/core/src/ir/builder.ts`
- Test: `packages/core/src/ir/builder.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// packages/core/src/ir/builder.test.ts
import { describe, it, expect } from "vitest";
import { loadSource } from "../parser/parser.js";
import { buildIR } from "./builder.js";
import type { IRFunction, IRParameter } from "./types.js";

describe("buildIR — funciones y parámetros", () => {
  it("extrae una función con su nombre y ubicación", () => {
    const ir = buildIR(loadSource("function greet(name) { return name; }", "a.ts"));
    const fns = ir.nodes.filter((n): n is IRFunction => n.kind === "Function");
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe("greet");
    expect(fns[0].loc.file).toBe("a.ts");
    expect(fns[0].loc.line).toBe(1);
  });

  it("extrae los parámetros y los vincula a su función", () => {
    const ir = buildIR(loadSource("function add(a, b) { return a; }", "a.ts"));
    const fn = ir.nodes.find((n): n is IRFunction => n.kind === "Function")!;
    const params = ir.nodes.filter((n): n is IRParameter => n.kind === "Parameter");
    expect(params.map((p) => p.name)).toEqual(["a", "b"]);
    expect(params.map((p) => p.index)).toEqual([0, 1]);
    expect(params.every((p) => p.ownerFnId === fn.id)).toBe(true);
    expect(fn.paramIds).toEqual(params.map((p) => p.id));
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -w @graphsast/core`
Expected: FAIL — `Cannot find module './builder.js'`.

- [ ] **Step 3: Implementación mínima**

```typescript
// packages/core/src/ir/builder.ts
import { type SourceFile, type Node } from "ts-morph";
import type { IRModule, IRNode, IRFunction, IRParameter, Loc } from "./types.js";

function locOf(node: Node, file: string): Loc {
  const sf = node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
  return { file, line, col: column };
}

function idOf(kind: string, loc: Loc): string {
  return `${loc.file}#${kind}@${loc.line}:${loc.col}`;
}

export function buildIR(sourceFile: SourceFile): IRModule {
  const file = sourceFile.getBaseName();
  const nodes: IRNode[] = [];

  for (const fn of sourceFile.getFunctions()) {
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
      name: fn.getName() ?? "",
      code: fn.getText(),
      loc: fnLoc,
      paramIds,
    };
    nodes.push(irFn);
  }

  return { file, nodes };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -w @graphsast/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ir/builder.ts packages/core/src/ir/builder.test.ts
git commit -m "feat(ir): extract functions and parameters into IR"
```

---

## Task 4: Builder — variables y literales

**Files:**
- Modify: `packages/core/src/ir/builder.ts`
- Modify: `packages/core/src/ir/builder.test.ts`

- [ ] **Step 1: Agregar el test que falla**

```typescript
// añadir en packages/core/src/ir/builder.test.ts
import type { IRVariable, IRLiteral } from "./types.js";

describe("buildIR — variables y literales", () => {
  it("extrae una variable con el texto de su inicializador", () => {
    const ir = buildIR(loadSource('const user = req.body;', "a.ts"));
    const vars = ir.nodes.filter((n): n is IRVariable => n.kind === "Variable");
    expect(vars).toHaveLength(1);
    expect(vars[0].name).toBe("user");
    expect(vars[0].initText).toBe("req.body");
  });

  it("marca initText null cuando la variable no tiene inicializador", () => {
    const ir = buildIR(loadSource("let x;", "a.ts"));
    const v = ir.nodes.find((n): n is IRVariable => n.kind === "Variable")!;
    expect(v.initText).toBeNull();
  });

  it("extrae literales de cadena con su valor", () => {
    const ir = buildIR(loadSource('const s = "hola";', "a.ts"));
    const lits = ir.nodes.filter((n): n is IRLiteral => n.kind === "Literal");
    expect(lits.map((l) => l.value)).toContain("hola");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -w @graphsast/core`
Expected: FAIL — no se extraen Variable/Literal todavía.

- [ ] **Step 3: Extender el builder**

Agregar los imports y el bloque de extracción. En `builder.ts`, ampliar el import de tipos y de ts-morph:

```typescript
import { type SourceFile, type Node, SyntaxKind } from "ts-morph";
import type {
  IRModule, IRNode, IRFunction, IRParameter, IRVariable, IRLiteral, Loc,
} from "./types.js";
```

Y antes del `return { file, nodes };`, agregar:

```typescript
  for (const decl of sourceFile.getVariableDeclarations()) {
    const vLoc = locOf(decl, file);
    const init = decl.getInitializer();
    const irVar: IRVariable = {
      id: idOf("Variable", vLoc),
      kind: "Variable",
      name: decl.getName(),
      code: decl.getText(),
      loc: vLoc,
      initText: init ? init.getText() : null,
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
    };
    nodes.push(irLit);
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -w @graphsast/core`
Expected: PASS (todos los tests previos + los 3 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ir/builder.ts packages/core/src/ir/builder.test.ts
git commit -m "feat(ir): extract variables and string literals into IR"
```

---

## Task 5: Builder — llamadas y argumentos

**Files:**
- Modify: `packages/core/src/ir/builder.ts`
- Modify: `packages/core/src/ir/builder.test.ts`

- [ ] **Step 1: Agregar el test que falla**

```typescript
// añadir en packages/core/src/ir/builder.test.ts
import type { IRCall } from "./types.js";

describe("buildIR — llamadas", () => {
  it("extrae una llamada con su callee y argumentos", () => {
    const ir = buildIR(loadSource('db.query("SELECT " + user);', "a.ts"));
    const calls = ir.nodes.filter((n): n is IRCall => n.kind === "Call");
    expect(calls).toHaveLength(1);
    expect(calls[0].callee).toBe("db.query");
    expect(calls[0].argTexts).toEqual(['"SELECT " + user']);
  });

  it("extrae múltiples llamadas en el mismo archivo", () => {
    const ir = buildIR(loadSource("f(); g(1, 2);", "a.ts"));
    const calls = ir.nodes.filter((n): n is IRCall => n.kind === "Call");
    expect(calls.map((c) => c.callee)).toEqual(["f", "g"]);
    expect(calls[1].argTexts).toEqual(["1", "2"]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -w @graphsast/core`
Expected: FAIL — no se extraen Call todavía.

- [ ] **Step 3: Extender el builder**

Ampliar el import de tipos para incluir `IRCall`:

```typescript
import type {
  IRModule, IRNode, IRFunction, IRParameter, IRVariable, IRLiteral, IRCall, Loc,
} from "./types.js";
```

Y antes del `return { file, nodes };`, agregar:

```typescript
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
    };
    nodes.push(irCall);
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -w @graphsast/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ir/builder.ts packages/core/src/ir/builder.test.ts
git commit -m "feat(ir): extract call expressions and arguments into IR"
```

---

## Task 6: Fachada pública del core

**Files:**
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// packages/core/src/index.test.ts
import { describe, it, expect } from "vitest";
import { analyze } from "./index.js";

describe("analyze (fachada)", () => {
  it("dado código fuente, devuelve un IRModule poblado", () => {
    const ir = analyze('function h(name){ db.query(name); }', "svc.ts");
    expect(ir.file).toBe("svc.ts");
    const kinds = ir.nodes.map((n) => n.kind).sort();
    expect(kinds).toContain("Function");
    expect(kinds).toContain("Parameter");
    expect(kinds).toContain("Call");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -w @graphsast/core`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Implementación mínima**

```typescript
// packages/core/src/index.ts
import { loadSource } from "./parser/parser.js";
import { buildIR } from "./ir/builder.js";
import type { IRModule } from "./ir/types.js";

export * from "./ir/types.js";

/** Punto de entrada del core: texto fuente -> IRModule. */
export function analyze(code: string, file = "input.ts"): IRModule {
  return buildIR(loadSource(code, file));
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -w @graphsast/core`
Expected: PASS (toda la suite).

- [ ] **Step 5: Verificar el build de tipos**

Run: `npm run build`
Expected: compila sin errores; genera `packages/core/dist/`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index.test.ts
git commit -m "feat(core): public analyze() facade returning IRModule"
```

---

## Criterios de aceptación del Hito 1

- [ ] `npm test` pasa en verde con cobertura de: funciones, parámetros, variables, literales, llamadas y fachada.
- [ ] `npm run build` compila el paquete `@graphsast/core` sin errores de tipos.
- [ ] `analyze(code, file)` devuelve un `IRModule` con `id`/`loc` estables para cada nodo.
- [ ] Ningún paso depende de Docker ni de Neo4j.
- [ ] Todo el código está en `packages/core/src/` con tests colocados junto a su módulo.

## Notas para hitos siguientes

- **Hito 2 (cfg):** sobre esta IR, construir el call graph resolviendo `IRCall.callee` → `IRFunction` por nombre/scope.
- **Hito 3 (dfg):** crear aristas `FLOWS_TO` (def-use) usando `initText`/`argTexts`; aquí empieza el taint intra→inter-procedural.
- **Hito 4 (store):** requiere Docker/Neo4j. Resolver instalación antes de empezar.
- **Validación temprana:** en cuanto exista el primer `FLOWS_TO` source→sink (Hito 3), arrancar el banco sintético mínimo para medir precisión desde el inicio.
