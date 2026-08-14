# Hito 3 — Data-Flow Graph (`dfg`) — Plan de implementación

> **Para ejecutores:** implementar tarea por tarea con TDD (red → green → commit). Pasos con checkbox `- [ ]`.

**Goal:** Construir las aristas `FLOWS_TO` (def-use) del property graph: conectar cada definición (`Variable`/`Parameter`) con los usos que la consumen (`Call` que la recibe como argumento, o `Variable` que la usa como inicializador). Es el núcleo del taint.

**Architecture:** Sobre el `IRModule` del Hito 1 y las aristas `CALLS` del Hito 2, se agrega el módulo `dfg` que resuelve def-use **por nombre, dentro del módulo**. `analyzeGraph` pasa a ensamblar nodos + `CALLS` + `FLOWS_TO`.

**Tech Stack:** TypeScript/Node.js, ts-morph (provee el IR), Vitest.

---

## Modelo de `FLOWS_TO`

De la sección 5 de la arquitectura: `(:Source|Variable|Call)-[:FLOWS_TO]->(:Variable|Call|Sink)`. Flujo de datos = núcleo del taint.

En Hito 3 se implementan dos reglas de def-use (ambas por **identificador simple**):

- **R1 — uso en llamada:** una def `x` (Variable o Parameter) usada como argumento bare-identifier de un `Call` → `x FLOWS_TO Call`.
  - Ej: `function f(name){ db.query(name); }` → `Parameter(name) FLOWS_TO Call(db.query)`.
- **R2 — uso en inicializador:** una def `x` usada como inicializador bare-identifier de una `Variable v` → `x FLOWS_TO v`.
  - Ej: `const q = name;` → `Parameter/Variable(name) FLOWS_TO Variable(q)`.

Encadenadas dan el camino: `param name ⇝ const q = name ⇝ db.query(q)`.

## Resolución (acotada)

- Coincidencia **por nombre, a nivel de módulo** (sin resolución de scope/shadowing). Suficiente para los casos sintéticos; límite documentado.
- Solo **identificadores simples**. No se analizan sub-expresiones (`x + 1`), accesos a miembro (`user.id`), spreads ni literales como argumentos → sin arista.
- Una def puede tener varios nodos con el mismo nombre (p. ej. dos `const x`); se emite arista desde cada uno (sobre-conexión aceptada y documentada).
- `BINDS_TO`/`RETURNS` (cruce inter-procedural) **fuera de alcance** de Hito 3; van a Hito 3b cuando el IR tenga nodos `Argument` y la validación lo requiera.

## Estructura de archivos

- Crear: `packages/core/src/dfg/dataflow.ts` — `buildDataFlow(mod: IRModule): IREdge[]`
- Crear: `packages/core/src/dfg/dataflow.test.ts`
- Modificar: `packages/core/src/index.ts` — exponer `buildDataFlow`; `analyzeGraph` ensambla `CALLS` + `FLOWS_TO`
- Modificar: `packages/core/src/index.test.ts` — la fachada incluye aristas `FLOWS_TO`

---

### Task 1: `buildDataFlow` — regla R1 (uso en llamada)

**Files:**
- Create: `packages/core/src/dfg/dataflow.test.ts`
- Create: `packages/core/src/dfg/dataflow.ts`

- [ ] **Step 1 (red):** Tests:
  - `function f(name){ db.query(name); }` → 1 arista `FLOWS_TO` de `Parameter(name)` al `Call(db.query)`.
  - `const q = 1; db.query(q);` → 1 arista de `Variable(q)` al `Call`.
  - `db.query(otro);` (sin def) → 0 aristas.
  - `db.query(x + 1);` (no es identificador simple) → 0 aristas.
- [ ] **Step 2:** Correr y ver fallar (módulo inexistente).
- [ ] **Step 3 (green):** Implementar `buildDataFlow` con R1.
- [ ] **Step 4:** Tests en verde.
- [ ] **Step 5:** Commit.

### Task 2: regla R2 (uso en inicializador) + encadenado

**Files:**
- Modify: `packages/core/src/dfg/dataflow.ts`
- Modify: `packages/core/src/dfg/dataflow.test.ts`

- [ ] **Step 1 (red):** Tests:
  - `function f(name){ const q = name; db.query(q); }` → 2 aristas `FLOWS_TO`: `name→Variable(q)` y `Variable(q)→Call`.
  - `const a = 1;` (init literal, no identificador) → la regla R2 no aporta arista.
- [ ] **Step 2:** Ver fallar.
- [ ] **Step 3 (green):** Agregar R2 a `buildDataFlow`.
- [ ] **Step 4:** Verde.
- [ ] **Step 5:** Commit.

### Task 3: fachada `analyzeGraph` ensambla CALLS + FLOWS_TO

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`

- [ ] **Step 1 (red):** Test: `analyzeGraph('function f(name){ db.query(name); }')` devuelve `IRGraph` con ≥1 arista `FLOWS_TO`.
- [ ] **Step 2:** Ver fallar.
- [ ] **Step 3 (green):** En `analyzeGraph`, concatenar `buildCallGraph(mod)` + `buildDataFlow(mod)`; re-exportar `buildDataFlow`.
- [ ] **Step 4:** Verde + `npm run build`.
- [ ] **Step 5:** Commit.

## Criterios de aceptación

- `npm test` en verde (tests nuevos de `dfg` + fachada actualizada).
- `npm run build` sin errores de tipos.
- `analyzeGraph(code, file)` devuelve `{ file, nodes, edges }` con aristas `CALLS` **y** `FLOWS_TO`.
- Sin dependencia de Docker/Neo4j.

## Notas para hitos siguientes

- **Hito 3b (`dfg` inter-procedural):** introducir nodos `Argument` en el IR; agregar `BINDS_TO` (argumento→parámetro vía `CALLS`) y `RETURNS` (función→variable de retorno). Completa el cruce de función.
- **Validación temprana:** con `CALLS`+`FLOWS_TO` ya se puede armar un primer caso sintético vuln/no-vuln y verificar el camino `source ⇝ sink` a mano antes de tener el motor Cypher (Hito 5).
