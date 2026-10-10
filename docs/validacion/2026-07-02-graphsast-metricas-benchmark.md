# Validación cuantitativa — benchmark sintético

**Fecha:** 2026-09-01 (revisión del corpus y de la metodología)  
**Estado del core:** Hitos 1–5 + extracción de flujo basada en AST.  
**Objetivo:** medir precisión, recall y tiempo de análisis sobre un banco de pruebas etiquetado, reproducible desde la línea de comandos.

## Cómo reproducir

```bash
npm run benchmark          # desde la raíz del monorepo
# o
npm run benchmark -w @graphsast/core
```

El test de regresión corre con la suite habitual:

```bash
npm test
# incluye packages/core/src/eval/benchmark.test.ts
```

## Metodología

### Unidad de evaluación

Cada **caso** es un snippet JavaScript/TypeScript autocontenido (un “archivo lógico”) con etiqueta ground-truth:

| Etiqueta | Criterio de acierto |
|----------|-------------------|
| `vulnerable` | El analizador reporta al menos un hallazgo |
| `safe` | El analizador reporta cero hallazgos |

> **Corrección metodológica (2026-09-01).** La versión anterior de
> `predictLabel()` recibía la etiqueta real como parámetro y ramificaba sobre
> ella. Eso es fuga de etiqueta (*label leakage*): la "predicción" conocía la
> respuesta, de modo que las métricas no medían al analizador. Ahora el
> predictor recibe **solo** la cantidad de hallazgos. El rango esperado
> (`minFindings`/`maxFindings`) se verifica aparte, en el campo `countOk`, y no
> interviene en la matriz de confusión.

La clasificación binaria por snippet produce la matriz de confusión estándar:

|  | Predicho vulnerable | Predicho seguro |
|--|---------------------|-----------------|
| **Real vulnerable** | TP | FN |
| **Real seguro** | FP | TN |

### Métricas

- **Precisión** = TP / (TP + FP) — de lo que alerta, cuánto es real.
- **Recall (exhaustividad)** = TP / (TP + FN) — de lo vulnerable, cuánto detecta.
- **F1** = media armónica de precisión y recall.
- **Accuracy** = (TP + TN) / total de casos.
- **ms/línea** = tiempo total de análisis / líneas del corpus.

### Corpus

33 casos en `packages/core/src/eval/benchmark/corpus.ts`:

| ID | Título | CWE | Etiqueta |
|----|--------|-----|----------|
| A | SQLi intra-procedural | CWE-89 | vulnerable |
| B | SQLi inter-procedural | CWE-89 | vulnerable |
| C | Sink con literal | CWE-89 | seguro |
| D | Sanitizado en el camino | CWE-89 | seguro |
| E | req.body → SQLi | CWE-89 | vulnerable |
| F | eval / command injection | CWE-78 | vulnerable |
| G1 | Mongoose create | CWE-20 | vulnerable |
| G3 | Finance App (3 handlers) | CWE-20 | vulnerable |
| H-create | Express arrow + create | CWE-20 | vulnerable |
| H-save | Express arrow + new/save | CWE-20 | vulnerable |
| I | XSS document.write | CWE-79 | vulnerable |
| J | Parámetro `res` no es source | — | seguro |
| K | Dos funciones sin cruce espurio | — | seguro |
| L | req.params.id directo al sink | CWE-89 | vulnerable |
| M1 | SQLi por template literal | CWE-89 | vulnerable |
| M2 | SQLi por concatenación de strings | CWE-89 | vulnerable |
| M3 | Asignación posterior a la declaración | CWE-89 | vulnerable |
| M4 | Taint dentro de object literal | CWE-89 | vulnerable |
| M5 | Taint dentro de array literal | CWE-89 | vulnerable |
| M6 | Flujo a través de `await` | CWE-89 | vulnerable |
| M7 | Destructuring de `req.params` | CWE-89 | vulnerable |
| M8 | Llamada anidada como argumento | CWE-89 | vulnerable |
| M9 | Query con dos argumentos | CWE-89 | vulnerable |
| M10 | Source `req.headers` | CWE-89 | vulnerable |
| M11 | Source `req.cookies` | CWE-89 | vulnerable |
| M12 | Handler como método de clase | CWE-89 | vulnerable |
| M13 | Sanitizer en rama paralela no protege | CWE-89 | vulnerable |
| M14 | Nombre con "escape" que no sanitiza | CWE-89 | vulnerable |
| N1 | `evaluatePrice` no es el sink `eval` | — | seguro |
| N2 | `myExecutor` no es el sink `exec` | — | seguro |
| N3 | `spawnConfetti` no es el sink `spawn` | — | seguro |
| N4 | Concatenación solo de literales | — | seguro |
| N5 | Sanitizado con `validator.escape` | CWE-89 | seguro |

Cobertura: SQLi, command injection, XSS, Mongoose/Express, sanitizers, scoping
intra-archivo, callbacks arrow, template literals, concatenación, asignaciones,
destructuring, object/array literals, `await`, métodos de clase y negativos por
similitud de nombre.

Los casos **M** y **N** se incorporaron el 2026-09-01: los M eran falsos
negativos y los N falsos positivos de la implementación anterior. Se agregaron
*antes* de corregir el motor, como criterio de aceptación de la corrección.

## Resultados (2026-07-02)

| Métrica | Valor |
|---------|-------|
| Casos | 33 (24 vulnerables, 9 seguros) |
| TP / FP / TN / FN | 24 / 0 / 9 / 0 |
| Precisión | **100%** |
| Recall | **100%** |
| F1 | **100%** |
| Accuracy | **100%** |
| Tiempo total | ~212 ms |
| ms/línea | ~1,55 |

### Antes y después de la extracción por AST

Medición sobre los 19 casos M/N (patrones realistas), con el motor anterior
—basado en coincidencia de texto— y con el actual:

| Motor | Detectados (de 14 M) | Falsos positivos (de 5 N) |
|-------|----------------------|---------------------------|
| Textual / regex (previo) | 1 | 2 |
| Extracción por AST (actual) | 14 | 0 |

El motor previo declaraba 100% sobre su propio corpus de 14 casos, pero perdía
12 de 13 patrones realistas de inyección —incluidos template literal y
concatenación, que son la forma habitual de una SQLi—. La métrica no era falsa:
medía un corpus que no contenía esos patrones. De ahí que el corpus se haya
ampliado antes de tocar el motor.

## Límites y trabajo pendiente

Este benchmark es **sintético y de un solo archivo**. Sirve para:

1. Validar el motor de taint contra ground-truth conocido.
2. Regresión automática en CI (`benchmark.test.ts`).
3. Tabla de métricas para el capítulo de validación de la tesis.

**No sustituye** la validación sobre proyectos reales de código abierto (sección 8 de `GraphSAST_Proyecto.md`), que queda como extensión futura:

- Multi-archivo (`require` / `import` entre módulos) — **no implementado**.
- Proyectos con vulnerabilidades documentadas (CVE/advisories).
- Comparación con baseline regex o herramientas existentes.
- Métricas **por hallazgo**, no por snippet: hoy un caso con 1 hallazgo correcto
  y 5 espurios puntúa como TP limpio, lo que infla la precisión. Es la métrica
  que realmente sostiene H2.
- Resolución de símbolos con el type checker de TypeScript. La propagación
  actual indexa por **nombre** dentro del ámbito de función: no distingue dos
  variables homónimas en bloques distintos.

### Honestidad académica

Las métricas al 100% reflejan un corpus **diseñado para el alcance actual** del analizador, no la seguridad general de aplicaciones Express en producción. En la defensa conviene presentar:

- Este benchmark como **validación interna del motor** (H1/H2).
- Las limitaciones documentadas (single-file, resolución por nombre, catálogo de sinks acotado, métricas por snippet).
- La tabla "antes y después" como evidencia de que el corpus **puede** exponer
  fallas del motor: es el argumento más fuerte contra la objeción "el corpus
  está hecho para aprobar".
- Un roadmap hacia validación externa cuando se incorporen proyectos reales.

El test de regresión ya **no exige 100%**: verifica umbrales (precisión y recall
≥ 0,85). Exigir perfección obligaba a que el corpus solo contuviera casos que ya
pasaban, es decir, lo volvía estructuralmente incapaz de detectar un retroceso.

## Artefactos

| Archivo | Rol |
|---------|-----|
| `eval/benchmark/corpus.ts` | Casos etiquetados |
| `eval/metrics.ts` | Cálculo TP/FP/TN/FN, precisión, recall, F1 |
| `eval/run-benchmark.ts` | Runner programático + tabla |
| `eval/run-benchmark.cli.ts` | Salida CLI + JSON |
| `eval/benchmark.test.ts` | Regresión (exige 100% en corpus actual) |
