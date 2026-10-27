# Prueba de punta a punta de la versión web

Fecha: 26/10/2026. Versión: `main` en `1659bb3` más los cambios de esta rama.

## Método

- `npm run viz:build` y `vite preview` sirven la compilación de producción en local.
- Un script de Playwright (Chromium sin interfaz) abre la página, carga cada carpeta con el
  botón «Analizar carpeta» (`#folder-input`) y lee el estado (`#status`), las métricas
  (`#stats`) y los errores de la consola.
- La misma carpeta se analiza con `graphsast scan --format json`.

La importación por URL de GitHub no se pudo probar: la red del entorno no alcanza
`api.github.com`. Su lógica está cubierta por `packages/viz/src/github.test.ts`.

## Resultados

| Proyecto | Commit | Archivos | Web | CLI | Tiempo web |
|---|---|---|---|---|---|
| Demo, código malo (`npm run demo`) | - | 5 | 10 | 10 | 0,6 s |
| Demo, código bueno | - | 5 | 0 | 0 | 0,5 s |
| vulpy `bad/` | `5249cc8` | 20 | 8 | 8 | 0,6 s |
| vulpy `good/` | `5249cc8` | 19 | 3 | 3 | 0,6 s |
| govwa | `4058f79` | 20 | 7 | 7 | 0,7 s |
| DVWA `vulnerabilities/` | `a1978a2` | 162 | 56 | 56 | 1,2 s |
| DVNA | `9ba473a` | 12 | 4 | 4 | 0,7 s |
| dvws-node | `8e2e9a5` | 50 | 52 | 52 | 1,5 s |
| realworld | `30b68e1` | 39 | 1 | 1 | 0,7 s |
| boilerplate | `179ae84` | 50 | 28 | 28 | 1,2 s |
| NodeGoat (sin `test/` ni `app/assets/vendor/`) | `c5cb68a` | 27 | 11 | 11 | 0,7 s |

En todos los casos, mismos hallazgos que la CLI y ningún error en la consola. govwa se volvió
a medir después de saltear `bootstrap.js`, que viene junto a `bootstrap.min.js` (antes: 21 archivos
y 8 hallazgos, uno de ellos en esa biblioteca).

NodeGoat, cinco ejecuciones:
- Análisis: 253, 258, 259, 267 y 271 ms (mediana 259 ms).
- Hasta el resultado en pantalla: 681 a 720 ms (mediana 696 ms).

Esta prueba verifica la interfaz. No reemplaza la validación con usuarios: no mide si una
persona entiende lo que ve.
