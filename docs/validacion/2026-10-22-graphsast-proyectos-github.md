# Evaluación sobre proyectos de GitHub

**Fecha:** 2026-10-22
**Manifiesto:** `eval-github.json` en la raíz del repositorio.
**Reproducción:** `npm run github-eval` (clona cada repositorio en su commit; `GITHUB_EVAL_CACHE` cambia la carpeta de las copias).
**Versiones medidas:** `9261519` (al etiquetar) y `4cf721b` (con las condiciones de destino del catálogo).

## Proyectos

| Unidad | Repositorio | Tipo | Commit | Archivos |
|---|---|---|---|---|
| dvna | appsecco/dvna | Vulnerable a propósito | `9ba473a` | 12 |
| vn-seeds | cr0hn/vulnerable-node, carpeta `sast/seeds` | Banco para analizadores | `d68f2a3` | 14 |
| vn-shop | cr0hn/vulnerable-node, sin `sast/` | Vulnerable a propósito | `d68f2a3` | 21 |
| dvws | snoopysecurity/dvws-node | Vulnerable a propósito | `8e2e9a5` | 42 |
| juice | juice-shop/juice-shop | Vulnerable a propósito | `399fba7` | 300 |
| realworld | gothinkster/node-express-realworld-example-app | Normal | `30b68e1` | 32 |
| boilerplate | hagopj13/node-express-boilerplate | Normal | `179ae84` | 40 |
| hackathon | sahat/hackathon-starter | Normal | `f265523` | 20 |

## Método

1. Antes de correr el analizador se etiquetaron las vulnerabilidades que cada aplicación documenta (guías, soluciones, marcas en el código o la verdad de referencia del banco), solo de las familias del catálogo: 34 en JavaScript o TypeScript y 2 controles limpios. Las 6 que están en plantillas EJS quedan fuera del alcance.
2. Se excluyen pruebas, archivos minificados y los fragmentos de corrección de Juice Shop (`data/static/codefixes/`), que no compilan a propósito.
3. Un hallazgo cuenta para una vulnerabilidad si es de la misma familia, en el mismo archivo y con el destino a 3 líneas o menos.
4. Los demás hallazgos se agrupan por destino (archivo y línea), que es lo que la web muestra como una vulnerabilidad. Se revisaron a mano: los reales figuran en `reviewedReal` del manifiesto y el resto son falsas alarmas.
5. Se mide GraphSAST con los dos modelos de origen (`params`, el de la web, y `catalog`) y la línea de base por expresiones regulares con el mismo catálogo.

## Resultados (`4cf721b`, modo `params`)

| Unidad | GraphSAST | Línea de base | Reales extra | Falsas alarmas antes | Falsas alarmas después | Falsas alarmas línea de base |
|---|---|---|---|---|---|---|
| dvna | 3/3 | 3/3 | 0 | 10 | 1 | 17 |
| vn-seeds | 5/5 | 5/5 | 1 | 0 | 0 | 5 |
| vn-shop | 5/7 | 7/7 | 0 | 1 | 1 | 22 |
| dvws | 5/9 | 7/9 | 8 | 37 | 22 | 67 |
| juice | 3/10 | 6/10 | 5 | 60 | 17 | 156 |
| realworld | - | - | 0 | 3 | 1 | 3 |
| boilerplate | - | - | 0 | 15 | 11 | 25 |
| hackathon | - | - | 0 | 48 | 5 | 75 |
| **Total** | **21/34** | **28/34** | **14** | **174** | **58** | **370** |

| Detector | FP | FN | Precisión | Exhaustividad | F1 |
|---|---|---|---|---|---|
| Línea de base | 370 | 6 | 0,10 | 0,82 | 0,18 |
| GraphSAST `params` | 58 | 13 | 0,38 | 0,62 | 0,47 |
| GraphSAST `catalog` | 37 | 15 | 0,46 | 0,56 | 0,51 |

- La precisión es por destino: aciertos = etiquetadas detectadas + reales sin etiqueta.
- La revisión manual se hizo sobre los hallazgos de GraphSAST. Los destinos que solo marca la línea de base no se revisaron uno por uno, así que su precisión es una cota inferior.
- En modo `catalog`, las falsas alarmas eran 135 antes de las condiciones de destino.

## Omisiones de GraphSAST (13 en modo `params`)

| Causa | Casos |
|---|---|
| La regla de `.find` exige receptor con mayúscula o `.collection(...)` | VN-04, VN-05, DW-03, JS-03, JS-05 |
| Operación fuera del catálogo: `res.download`, `res.write`, `.update`, opciones de `res.render`, `bypassSecurityTrustHtml` | DW-05, DW-09, JS-04, JS-06, JS-09, JS-10 |
| CWE-22 solo acepta orígenes del catálogo; en GraphQL el dato llega como argumento | DW-07 |
| El dato entra a `vm.runInContext` por el objeto de contexto (motor) | JS-07 |

## Límites

- Etiquetas y revisión de una sola persona. Las 7 consultas NoSQL "no documentadas" se clasificaron como reales por el patrón y no se explotaron.
- Cuatro de las cinco unidades con vulnerabilidades son aplicaciones hechas para enseñar.
- Las cifras de Semgrep y njsscan sobre `sast/seeds` que cita la tesis son las publicadas por vulnerable-node y no se volvieron a medir.
