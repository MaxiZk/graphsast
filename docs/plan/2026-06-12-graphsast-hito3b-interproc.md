# Hito 3b — Data-flow inter-procedural (`BINDS_TO` + `RETURNS`)

> Sub-skill para ejecutar: TDD red-green-commit, una tarea por arista. Continúa el Hito 3 (`dfg`, `FLOWS_TO` intra-procedural).

**Goal:** que el taint cruce funciones, agregando las aristas `BINDS_TO` (entrada: argumento → parámetro) y `RETURNS` (salida: función → variable retornada), combinándose con las `CALLS` (Hito 2) y `FLOWS_TO` (Hito 3).

**Architecture:** módulo `dfg/interproc.ts` con `buildInterproc(mod): IREdge[]`. Reutiliza `buildCallGraph` para saber, por cada llamada resuelta, a qué función apunta; mapea argumento de índice `i` con parámetro de índice `i`. `RETURNS` se apoya en un nuevo campo `returnTexts` del `IRFunction`.

**Tech Stack:** TypeScript ESM, ts-morph, Vitest.

---

## Modelo y decisiones

Modelo de grafo de la arquitectura (sección 5):
- `(:Argument)-[:BINDS_TO]->(:Parameter)`
- `(:Function)-[:RETURNS]->(:Variable)`

**Decisión 1 — colapsar `Argument`.** No se introducen nodos `Argument` en el IR. La arista `BINDS_TO` se emite desde la *def* del argumento (la `Variable`/`Parameter` cuyo nombre coincide con el texto del argumento) directamente al `Parameter` destino. Motivo (YAGNI): un nodo `Argument` solo cargaría "qué def y en qué posición", información que `BINDS_TO` ya codifica; además evita tocar las 6 pruebas verdes de Hito 3. Camino de taint resultante (totalmente conectado):

```
name(Parameter de h) --BINDS_TO--> q(Parameter de sink) --FLOWS_TO--> db.query(Call)
```

**Decisión 2 — mapeo por índice posicional.** Argumento en posición `i` liga con `paramIds[i]` de la función resuelta. Sin soporte de defaults, rest/spread, ni argumentos nombrados.

**Decisión 3 — solo identificadores simples.** Igual que Hito 3: argumentos como `x + 1`, `user.id`, literales o llamadas no generan `BINDS_TO`. Idem para la expresión retornada en `RETURNS`.

**Decisión 4 — dirección de `RETURNS`.** Se respeta el modelo de la arquitectura: `Function --RETURNS--> def_retornada`. Modela la relación "esta función retorna esta def". La reconexión completa del valor de retorno hacia la variable del lado del llamador (`const y = f();`) requiere ligar `Call → variable asignada`, que hoy `FLOWS_TO` no produce (R2 solo cubre inicializadores identificador simple, no llamadas). Se deja documentado como límite conocido; `BINDS_TO` ya habilita el caso inter-procedural canónico (sink dentro de la función llamada).

**Límites heredados de Hito 3:** coincidencia por nombre (sin scope/shadowing) → sobre-conexión ante nombres duplicados, aceptada.

## Estructura de archivos

- Modificar: `packages/core/src/ir/types.ts` — agregar `returnTexts: string[]` a `IRFunction`.
- Modificar: `packages/core/src/ir/builder.ts` — poblar `returnTexts` por función (return statements con expresión).
- Crear: `packages/core/src/dfg/interproc.ts` — `buildInterproc(mod): IREdge[]` (`BINDS_TO` + `RETURNS`).
- Crear: `packages/core/src/dfg/interproc.test.ts` — pruebas TDD.
- Modificar: `packages/core/src/index.ts` — `analyzeGraph` ensambla `CALLS + FLOWS_TO + BINDS_TO + RETURNS`; reexportar `buildInterproc`.
- Modificar: `packages/core/src/index.test.ts` — caso fachada con `BINDS_TO`.

## Tareas (TDD)

### Tarea 1 — `BINDS_TO` por índice
- Test: `function sink(q){ db.query(q); } function h(name){ sink(name); }` → existe `{kind:"BINDS_TO", from: param(name).id, to: param(q).id}`; argumento no-identificador (`sink(name + 1)`) → 0 `BINDS_TO`; nombre sin def → 0.
- Impl: recorrer aristas de `buildCallGraph`; por cada una, resolver Call (argTexts) y Function (paramIds); mapear índice; emitir `BINDS_TO` desde cada def del nombre.
- Commit: `feat(dfg): BINDS_TO argument->parameter by positional index`.

### Tarea 2 — `RETURNS` función → def retornada
- Precondición: `IRFunction.returnTexts` poblado en el builder.
- Test: `function src(){ const x = 1; return x; }` → existe `{kind:"RETURNS", from: fn(src).id, to: var(x).id}`; `return 1` (literal) → 0 `RETURNS`; función sin return → 0.
- Impl: por cada `Function`, por cada `returnText` identificador simple, emitir `RETURNS` a cada def del nombre.
- Commit: `feat(dfg): RETURNS function->returned def`.

### Tarea 3 — fachada
- Test (`index.test.ts`): `analyzeGraph` sobre el caso de la Tarea 1 incluye ≥1 arista `BINDS_TO`.
- Impl: `analyzeGraph` concatena `buildInterproc(mod)`; reexportar `buildInterproc` desde `index.ts`.
- Commit: `feat(core): analyzeGraph assembles inter-procedural BINDS_TO + RETURNS`.

## Criterios de aceptación

- Suite verde (las 6 de `dfg` intactas + nuevas de `interproc` + fachada).
- `tsc -b` limpio.
- Camino inter-procedural `source ⇝ sink` cruzando una función queda totalmente conectado vía `BINDS_TO`+`FLOWS_TO`+`CALLS` (insumo para la validación temprana — opción 2).
