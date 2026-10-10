# Validación sobre vulnerabilidades reales (advisories de npm)

**Fecha:** 2026-09-23  
**Corpus:** `eval-cve-corpus.json`, congelado el 2026-09-01 (GitHub Security Advisories, ecosistema npm).  
**Objetivo:** contrastar el analizador con vulnerabilidades documentadas, más allá del banco sintético.

## Cómo reproducir

```bash
npm run cve:run                          # usa el manifiesto congelado
CVE_JSON=resultado.json npm run cve:run  # además escribe el informe en JSON
```

El manifiesto se regenera con `npm run cve:fetch`, lo que cambia el corpus: para
comparar resultados hay que usar el mismo manifiesto.

## Metodología

Para cada advisory se descargan del registro de npm la versión vulnerable y la
que corrige la falla, y se analizan ambas contando solo los hallazgos del CWE del
advisory. Se excluyen las carpetas de código generado (`dist`, `build`, `esm`,
`cjs`, `umd`, `min`, `bundles`), los archivos minificados y los mayores a 300 KB.

| Resultado | Criterio |
|---|---|
| Detectado | La versión vulnerable tiene al menos un hallazgo del CWE |
| Discriminado | Además, la versión corregida tiene menos hallazgos |

La discriminación es la evidencia fuerte: indica que el hallazgo se relaciona con
la vulnerabilidad y no con un patrón presente en todo el paquete.

## Resultados

| Advisory | Paquete (vulnerable → corregida) | CWE | Archivos | Hallazgos | Resultado |
|---|---|---|---|---|---|
| GHSA-6wcc-39rp-hh9p | @hypequery/clickhouse 2.5.0 → 2.5.1 | 89 | 0 | — | Sin código fuente publicado |
| GHSA-7835-87q9-rgvv | @anthropic-ai/claude-code 2.1.162 → 2.1.163 | 78 | 3 | 0 → 0 | No detectado |
| GHSA-vccv-cmxp-4j9h | sanitize-html 2.17.4 → 2.17.5 | 79 | 1 | 0 → 0 | No detectado |
| GHSA-g8qq-57p8-ggw5 | sanitize-html 2.17.6 → 2.17.7 | 79 | 1 | 0 → 0 | No detectado |
| GHSA-jg4p-g6xj-4qmf | defuddle 0.19.0 → 0.19.1 | 79 | 0 | — | Sin código fuente publicado |
| GHSA-55q2-fjhq-7xh7 | dompurify 3.4.12 → 3.4.13 | 79 | 7 | 1 → 1 | Detectado, sin discriminación |

Detección: 1/6 (16,7 %). Discriminación: 0/1.

## Lectura

- **Sin código fuente.** `@hypequery/clickhouse` y `defuddle` publican solo `dist/`.
  Analizando también `dist/` (verificación aparte, sin cambiar el evaluador):
  0 hallazgos en el primero (unas 6.700 líneas) y 3 hallazgos de `innerHTML`
  idénticos en ambas versiones del segundo. La conclusión no cambia.
- **Envoltorio.** `@anthropic-ai/claude-code` publica un instalador de 3 archivos.
- **Fuera del modelo de amenaza.** Las fallas de `sanitize-html` y `DOMPurify`
  están en la lógica de sus propias reglas de filtrado; la de `@hypequery/clickhouse`
  en su función de escapado; la de `defuddle` en interpolar atributos sin escapar
  al armar HTML como texto; la de inyección de comandos en una confusión de rutas.
  Ninguna es un camino source → sink del catálogo.

El resultado no permite afirmar ni refutar la efectividad sobre código real: el
corpus está formado por bibliotecas cuyas fallas no son flujos de contaminación.
La validación pendiente debe tomar aplicaciones que reciben entradas de usuario y
las llevan a bases de datos, procesos del sistema o el DOM, y ampliar la cantidad
de casos.
