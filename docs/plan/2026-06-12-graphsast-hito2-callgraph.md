# Hito 2 — Call Graph (`cfg`) — Plan de implementación

> **Para ejecutores:** implementar tarea por tarea con TDD (red → green → commit). Pasos con checkbox `- [ ]`.

**Goal:** Construir el call graph resolviendo `IRCall.callee` → `IRFunction`, produciendo las primeras aristas del property graph (`CALLS`).

**Architecture:** Sobre el IR del Hito 1 (solo nodos), se introduce el modelo de aristas dirigidas (`IREdge`) y un módulo `cfg` que resuelve cada llamada a una función local declarada por nombre. Es el puente a lo inter-procedural (ADR-5, sección 5 del doc de arquitectura).

**Tech Stack:** TypeScript/Node.js, ts-morph (ya provee el IR), Vitest.

---

## Modelo

Se agrega a `packages/core/src/ir/types.ts`:

```typescript
export type IREdgeKind =
  | "CALLS"
  | "FLOWS_TO"
  | "BINDS_TO"
  | "RETURNS"
  | "SANITIZED_BY";

export interface IREdge {
  kind: IREdgeKind;
  from: string; // id de nodo origen
  to: string;   // id de nodo destino
}

export interface IRGraph {
  file: string;
  nodes: IRNode[];
  edges: IREdge[];
}
```

`IRGraph` es el agregado nodos+aristas que las etapas siguientes (`dfg`, `store`) irán enriqueciendo.

## Resolución (acotada, ADR-5)

- Un `IRCall` con `callee === "foo"` genera una arista `CALLS` desde el id del Call al id de cada `IRFunction` con `name === "foo"`.
- Llamadas a miembro (`db.query`, `obj.metodo`) **no** resuelven a funciones locales → sin arista (correcto: suelen ser sinks/librería).
- Llamadas a nombres sin función declarada → sin arista.
- **Límite documentado:** no se resuelven arrow-functions asignadas a `const` (`const f = () => …`) porque el IR del Hito 1 solo captura `function` declarations. Se amplía cuando la validación lo requiera.

## Estructura de archivos

- Crear: `packages/core/src/cfg/callgraph.ts` — `buildCallGraph(mod: IRModule): IREdge[]`
- Crear: `packages/core/src/cfg/callgraph.test.ts`
- Modificar: `packages/core/src/ir/types.ts` — agregar `IREdge*`, `IRGraph`
- Modificar: `packages/core/src/index.ts` — exponer `buildCallGraph` y fachada `analyzeGraph`
- Modificar: `packages/core/src/index.test.ts` — test de la fachada de grafo

---

### Task 1: Modelo de aristas

- [ ] **Step 1:** Agregar `IREdgeKind`, `IREdge`, `IRGraph` a `ir/types.ts`.
- [ ] **Step 2:** Compila (`npm run build`).

### Task 2: `buildCallGraph`

- [ ] **Step 1 (red):** Tests en `cfg/callgraph.test.ts`:
  - llamada a función local → 1 arista `CALLS` (from = id Call, to = id Function)
  - llamada a miembro (`db.query`) → 0 aristas
  - llamada a nombre inexistente → 0 aristas
  - dos llamadas a la misma función → 2 aristas
- [ ] **Step 2:** Correr y ver fallar.
- [ ] **Step 3 (green):** Implementar `buildCallGraph`.
- [ ] **Step 4:** Tests en verde.
- [ ] **Step 5:** Commit.

### Task 3: Fachada de grafo

- [ ] **Step 1 (red):** Test: `analyzeGraph(code, file)` devuelve `IRGraph` con nodos y al menos una arista `CALLS` para código con llamada a función local.
- [ ] **Step 2:** Ver fallar.
- [ ] **Step 3 (green):** `analyzeGraph` = `buildIR` + `buildCallGraph` ensamblados; re-exportar tipos.
- [ ] **Step 4:** Verde + `npm run build`.
- [ ] **Step 5:** Commit.

## Criterios de aceptación

- `npm test` en verde (tests nuevos de `cfg` + fachada).
- `npm run build` sin errores de tipos.
- `analyzeGraph(code, file)` devuelve `{ file, nodes, edges }` con aristas `CALLS` correctas.
- Sin dependencia de Docker/Neo4j.

## Notas para hitos siguientes

- **Hito 3 (`dfg`):** sobre `IRGraph`, agregar aristas `FLOWS_TO` (def-use) y `BINDS_TO`/`RETURNS` para el cruce de función. Inicio del taint. Empezar validación temprana acá.
- **Hito 4 (`store`):** volcar `IRGraph` a Neo4j (requiere Docker instalado).
