# Resolución de llamadas, retornos, closures y catálogo con restricciones

Fecha: 2026-10-10. Cambios del motor y nueva medición sobre los mismos
corpus que las validaciones anteriores.

## Qué cambió

| Área | Antes | Ahora |
|---|---|---|
| Resolución de llamadas | Solo `function` declaradas por nombre | También arrows y function expressions guardadas en variable, campo o propiedad; `this.m()`, `Clase.m()`, `objeto.m()`; método de nombre único para receptores desconocidos (heurística) |
| Entre archivos | `import` de ES hacia `function` | También `export const f = () => {}` y CommonJS (`require`, `module.exports`, `exports.f`) |
| Valor de retorno | Argumentos → resultado de la llamada, siempre | En llamadas resueltas con certeza: argumento → parámetro (`BINDS_TO`) y valor retornado → llamada (`RETURNS`). Un sanitizer dentro de la función corta el camino |
| Closures | Una def solo era visible en su función | Visibilidad léxica a través de funciones, con sombreado |
| Sinks | Por nombre, cualquier argumento | Con posiciones de argumento (`db.query(sql, [id])` ya no es hallazgo), llamada suelta (`exec` vs `regex.exec`), receptor (`User.find` vs `users.find`) y paquete de origen (`cp.exec`) |
| Sanitizers | Valían para todas las CWE | Valen para su CWE (`String(x)` protege una consulta MongoDB, no una SQL) |
| Sources | Todo parámetro que nadie llama | Igual por defecto; `--sources catalog` restringe a `req`, `request`, `ctx` y decoradores de NestJS |
| Ids de nodo | `a.b().c()` compartía id con `a.b()` | Id único por llamada (paréntesis de argumentos) |

## Benchmark sintético

Sin cambios: 43 casos, 29 TP, 14 TN, 0 FP, 0 FN; los conteos esperados por
caso también coinciden.

## CVEs reales (`eval-cve-corpus.json`)

| Advisory | Antes | Ahora |
|---|---|---|
| GHSA-55q2-fjhq-7xh7 (dompurify) | Detectado, 1 → 1 | Detectado, 7 → 7 |
| Los otros cinco | No detectado | No detectado |

Detección 1/6 en ambos casos. Los seis caminos nuevos de dompurify llegan al
mismo `doc.documentElement.innerHTML` (línea 1477 de `purify.ts`): uno por
arrows que antes no se resolvían (`_createTrustedHTML`,
`_stripTemplateExpressions`) y cinco por variables que comparte toda la
closure de `createDOMPurify` (`trustedTypesPolicy`, `emptyHTML`). Son flujos
de datos reales; muestran el costo de un análisis que no es sensible al orden
(ver Limitaciones en el README).

## El propio repositorio

Escaneo de `packages/` (sin tests ni `eval/`) con la versión anterior y la
nueva, sobre la misma copia del código:

| Versión | Hallazgos | Detalle |
|---|---|---|
| Anterior | 3 | 1 falso positivo: `/regex/.exec(hostHeader)` en `server.ts:81` como CWE-78. 2 caminos a `btn.innerHTML` en `viz/src/main.ts:555` |
| Nueva | 3 | 0 falsos positivos. 3 caminos al mismo `btn.innerHTML` |

El `btn.innerHTML` era un XSS real del modo Ejemplos de la versión web: un
callee como `o["<img src=x onerror=...>"](req.body)` en el código pegado
llegaba al HTML del botón del hallazgo y ejecutaba el `onerror` (verificado
en Chromium). Se corrigió armando el botón con nodos de texto; con el arreglo
el escaneo del repositorio da 0 hallazgos.

Un sink que se agregó y se volvió a quitar: `res.end` / `res.write`. En el
propio servidor, `res.end(JSON.stringify(body))` con `Content-Type` JSON salía
como XSS. Esas APIs de bajo nivel se usan sobre todo para respuestas que no
son HTML.

## Tests

Core: de 218 a 287 tests (más uno omitido), incluidos 12 de punta a punta del
CLI que lanzan el binario real sobre proyectos temporales y validan el SARIF
contra el esquema oficial. Viz: 31.
