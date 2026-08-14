# Validación cuantitativa — benchmark sintético

**Fecha:** 2026-07-02  
**Estado del core:** Hitos 1–4 (parser, IR, call graph, DFG intra/inter, taint, scoping, arrow callbacks).  
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
| `vulnerable` | Al menos `minFindings` hallazgos de taint (default 1) |
| `safe` | Cero hallazgos |

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

14 casos en `packages/core/src/eval/benchmark/corpus.ts`:

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

Cobertura: SQLi, command injection, XSS, Mongoose/Express, sanitizers, scoping intra-archivo, callbacks arrow.

## Resultados (2026-07-02)

| Métrica | Valor |
|---------|-------|
| Casos | 14 (10 vulnerables, 4 seguros) |
| TP / FP / TN / FN | 10 / 0 / 4 / 0 |
| Precisión | **100%** |
| Recall | **100%** |
| F1 | **100%** |
| Accuracy | **100%** |
| Tiempo total | ~43 ms |
| ms/línea | ~0,68 |

Todos los casos clasifican correctamente en la corrida reproducible del benchmark.

## Límites y trabajo pendiente

Este benchmark es **sintético y de un solo archivo**. Sirve para:

1. Validar el motor de taint contra ground-truth conocido.
2. Regresión automática en CI (`benchmark.test.ts`).
3. Tabla de métricas para el capítulo de validación de la tesis.

**No sustituye** la validación sobre proyectos reales de código abierto (sección 8 de `GraphSAST_Proyecto.md`), que queda como extensión futura:

- Multi-archivo (`require` / `import` entre módulos).
- Proyectos con vulnerabilidades documentadas (CVE/advisories).
- Comparación con baseline regex o herramientas existentes.

### Honestidad académica

Las métricas al 100% reflejan un corpus **diseñado para el alcance actual** del analizador, no la seguridad general de aplicaciones Express en producción. En la defensa conviene presentar:

- Este benchmark como **validación interna del motor** (H1/H2).
- Las limitaciones documentadas (single-file, resolución por nombre, catálogo de sinks acotado).
- Un roadmap hacia validación externa cuando se incorporen proyectos reales.

## Artefactos

| Archivo | Rol |
|---------|-----|
| `eval/benchmark/corpus.ts` | Casos etiquetados |
| `eval/metrics.ts` | Cálculo TP/FP/TN/FN, precisión, recall, F1 |
| `eval/run-benchmark.ts` | Runner programático + tabla |
| `eval/run-benchmark.cli.ts` | Salida CLI + JSON |
| `eval/benchmark.test.ts` | Regresión (exige 100% en corpus actual) |
