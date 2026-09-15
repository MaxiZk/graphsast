# Validación temprana — alcanzabilidad `source ⇝ sink` sobre el IRGraph

**Fecha:** 2026-06-12
**Estado del core:** Hitos 1–3b (parser, IR, call graph, data-flow intra e inter-procedural).
**Objetivo:** verificar, *antes* de tener el motor Cypher (Hito 5), que el `IRGraph` que produce `analyzeGraph` ya contiene los caminos dirigidos necesarios para decidir si un dato de usuario (*source*) alcanza una operación peligrosa (*sink*). Si el camino existe → candidato a vulnerabilidad; si no existe → seguro.

## Modelo de la verificación

Un dato está *tainted* en el sink si existe un camino dirigido `source ⇝ sink` recorriendo únicamente aristas que propagan taint:

```
FLOWS_TO | BINDS_TO | RETURNS | CALLS
```

Esto reproduce a mano la plantilla Cypher de la arquitectura (sección 7), acotada a profundidad 15 (`*1..15`). El oráculo de verificación es un BFS dirigido acotado, implementado como helper en `packages/core/src/eval/taint-reachability.test.ts`. **No es el motor de producción** (será Cypher en Hito 5); sirve como verificación temprana y como futuro test diferencial contra el engine.

En esta etapa todavía no hay detección automática de `Source`/`Sink` ni aristas `SANITIZED_BY` (Hito 4). Por eso, en los casos sintéticos:
- *Source* = el parámetro de entrada de usuario, por convención llamado `input`.
- *Sink* = la llamada `db.query(...)` (CWE-89, SQL injection).

## Casos sintéticos y recorrido a mano

### Caso A — Vulnerable, intra-procedural

```js
function handler(input) {
  const q = input;
  db.query(q);
}
```

Aristas relevantes que emite `analyzeGraph`:

| Arista | Regla | Origen | Destino |
| --- | --- | --- | --- |
| `FLOWS_TO` | R2 (inicializador) | `input` (Parameter) | `q` (Variable) |
| `FLOWS_TO` | R1 (argumento) | `q` (Variable) | `db.query` (Call) |

Recorrido:

```
input ──FLOWS_TO──▶ q ──FLOWS_TO──▶ db.query
```

Camino existe (2 saltos) ⇒ **VULNERABLE**. ✔

### Caso B — Vulnerable, inter-procedural

```js
function sink(q) { db.query(q); }
function handler(input) { sink(input); }
```

Aristas relevantes:

| Arista | Regla | Origen | Destino |
| --- | --- | --- | --- |
| `BINDS_TO` | índice posicional | `input` (Parameter de `handler`) | `q` (Parameter de `sink`) |
| `FLOWS_TO` | R1 (argumento) | `q` (Parameter de `sink`) | `db.query` (Call) |

Recorrido (cruza el límite de función vía `BINDS_TO`, la contribución de Hito 3b):

```
input ──BINDS_TO──▶ q ──FLOWS_TO──▶ db.query
```

Camino existe ⇒ **VULNERABLE**. ✔

### Caso C — No vulnerable

```js
function handler(input) {
  db.query("SELECT 1");
}
```

El argumento de `db.query` es un literal; `input` no se usa. No se emite ninguna arista que conecte `input` con la llamada.

Recorrido:

```
input        db.query        (sin arista entre ellos)
```

Tanto el *source* como el *sink* existen como nodos, pero **no hay camino** ⇒ **SEGURO**. ✔

## Resultado

Los tres casos se verifican de forma reproducible (3/3 verde):

```
npx vitest run packages/core/src/eval/taint-reachability.test.ts
```

**Conclusión:** el `IRGraph` actual ya es suficiente para distinguir vulnerable de no-vulnerable mediante alcanzabilidad dirigida, tanto intra como inter-procedural. Esto valida la construcción del grafo (Hitos 1–3b) antes de invertir en la persistencia Neo4j y el motor de consultas Cypher.

## Límites conocidos (a resolver en hitos siguientes)

- **Detección de Source/Sink (Hito 4):** hoy se eligen a mano por convención (`input`, `db.query`). Falta el catálogo de sources/sinks por CWE.
- **Sanitizers / `SANITIZED_BY` (Hito 4):** falta el caso "vulnerable cortado por sanitizador". Requiere marcar nodos saneados y excluirlos del camino.
- **Retorno hacia el llamador:** `RETURNS` modela la relación función→def retornada, pero falta ligar `Call → variable asignada` (`const y = f();`) para reconstruir el flujo de retorno completo.
- **Resolución por nombre:** sin scope/shadowing; nombres duplicados sobre-conectan (heredado de Hitos 2–3).
