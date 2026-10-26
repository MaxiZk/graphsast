# Verificación de falsos positivos y negativos en Python, Java, PHP y Go

Fecha: 26/10/2026. Versión inicial: `42fc32d` (merge de la PR #43). Versión
final: la de este documento.

## Objetivo

Comprobar sobre proyectos públicos, escritos por otros, que el análisis de
Python, Java, PHP y Go marca el código vulnerable y no marca el corregido. Los
48 pares de `docs/validacion/pares/` los escribió el autor; esta verificación
usa aplicaciones vulnerables a propósito que traen las dos versiones del mismo
código y el OWASP Benchmark, que etiqueta cada caso.

## Proyectos

| Proyecto | Lenguaje | Commit | Qué trae |
|---|---|---|---|
| [DVWA](https://github.com/digininja/DVWA) | PHP | `a1978a2` | Cada módulo en cuatro niveles: `low`, `medium` y `high` vulnerables; `impossible`, corregido |
| [vulpy](https://github.com/fportantier/vulpy) | Python (Flask) | `5249cc8` | La misma aplicación en `bad/` y en `good/` |
| [govwa](https://github.com/0c34/govwa) | Go | `4058f79` | Funciones vulnerables y seguras lado a lado (`UnsafeQueryGetData` / `SafeQueryGetData`) |
| [OWASP Benchmark](https://github.com/OWASP-Benchmark/BenchmarkJava) | Java | `c3379bd` | 2.740 servlets etiquetados en `expectedresults-1.2.csv`; se usan los 1.478 de comandos, SQL, XSS y rutas |

Cada archivo se analizó solo, como en la versión web, con el modelo de origen
por defecto. El Benchmark se reproduce con `npm run owasp-benchmark`.

## DVWA (PHP)

Se analizó `vulnerabilities/<módulo>/source/<nivel>.php` de los módulos con una
familia del catálogo. Esperado: hallazgo en `low`, `medium` y `high`; ninguno en
`impossible`.

| Módulo | Familia | low | medium | high | impossible |
|---|---|---|---|---|---|
| sqli | CWE-89 | sí | sí (antes: sí, por otra razón) | no (fuera de alcance) | no |
| sqli_blind | CWE-89 | sí | sí | sí | no |
| exec | CWE-78 | sí | sí | sí | **antes sí (FP), ahora no** |
| xss_s | CWE-89 | **antes sí (FP), ahora no** | **antes sí (FP), ahora no** | **antes sí (FP), ahora no** | no |
| upload | CWE-22 | no (fuera de alcance) | no | no | sí (FP) |

- **exec impossible.** Valida cada octeto de la IP con `is_numeric` antes de
  armar el comando. Antes se marcaba porque las validaciones de PHP no cortaban
  el camino.
- **xss_s.** El código del módulo guarda el comentario con
  `mysqli_real_escape_string` y entre comillas: la consulta es segura. Antes se
  marcaba como inyección SQL. El XSS almacenado del módulo se muestra en otro
  archivo, por lo que no se cuenta.
- **sqli medium.** Escapa el dato con `mysqli_real_escape_string`, pero lo usa
  sin comillas (`WHERE user_id = $id`): sigue siendo inyectable con
  `1 OR 1=1`. Antes se detectaba solo porque el análisis no veía que la
  variable se había reasignado con el escape. Con las asignaciones que pisan
  se dejó de detectar, y se agregó la regla de escape sin comillas, que lo
  vuelve a detectar por la razón correcta.
- **sqli high.** El dato llega de `$_SESSION`, que otra página llena con la
  entrada del usuario (inyección de segundo orden): no se ve en el archivo.
- **upload.** `low`, `medium` y `high` no tienen inyección sino una subida sin
  control de tipo, que no es una familia del catálogo. En `impossible`, el
  nombre del archivo se arma con una extensión que sale de `$_FILES` y que se
  compara con una lista antes de usarla, pero la comparación se hace sobre la
  extensión y el uso es sobre el nombre derivado antes: queda como falso
  positivo.
- Los módulos `xss_r`, `fi` y `open_redirect` escriben en `$html`, que el marco
  de DVWA muestra desde otro archivo, o incluyen el archivo desde `index.php`:
  sin hallazgos en ninguna versión, fuera de alcance.

## vulpy (Python)

| Hallazgo | `bad/` | `good/` | Clasificación |
|---|---|---|---|
| `libuser.py` login: `format` en el `SELECT` | sí | no (usa parámetros) | correcto |
| `libuser.py` alta de usuario: `format`/`%` en el `INSERT` | sí | sí | real en las dos: la versión `good/` conserva el `%` |
| `libuser.py` cambio de clave: `format` en el `UPDATE` | sí | no (usa parámetros) | correcto |
| `mod_user.py` `return response` | sí | sí | falso positivo |

El falso positivo de `mod_user.py`: la vista devuelve el objeto que arma
`libsession.create(...)`, una función de otro módulo; sin seguir llamadas entre
archivos, su valor se aproxima por sus argumentos, que incluyen datos del
pedido. Igual en las dos versiones, antes y después.

## govwa (Go)

| Hallazgo | Antes | Después | Clasificación |
|---|---|---|---|
| `sqli/function.go:41` `DB.Query(getProfileSql)` armada con `fmt.Sprintf` | sí | sí | real |
| `sqli/function.go:75`, `idor/function.go:49,70`, `user/user.go:154`: `stmt.QueryRow`/`Exec` sobre `db.Prepare` | sí (4) | no | falsos positivos corregidos |
| `xss/xss.go:58-63,100` `template.HTML(...)` con el término buscado | sí (5) | sí (5) | reales |
| `util/template.go:35` `w.Write(b)` con `b` de `json.Marshal` | sí | no | falso positivo corregido |
| `util/template.go:45` `ToHTML(text)` → `template.HTML(text)` | sí | sí | función auxiliar insegura: no es explotable sola |
| `public/js/jquery-3.2.1-min.js` (369 hallazgos en 3 destinos) | sí | no | biblioteca de terceros minificada: ahora se saltea al recorrer una carpeta |

## OWASP Benchmark (Java)

| Categoría | Casos | TPR antes | FPR antes | TPR final | FPR final | Score final |
|---|---|---|---|---|---|---|
| Comandos (cmdi) | 251 | 0,365 | 0,400 | 1,000 | 0,288 | 0,712 |
| SQL (sqli) | 504 | 0,868 | 0,681 | 1,000 | 0,302 | 0,698 |
| XSS (xss) | 455 | 0,809 | 0,589 | 1,000 | 0,206 | 0,794 |
| Rutas (pathtraver) | 268 | 0,857 | 0,681 | 1,000 | 0,259 | 0,741 |
| **Total** | **1.478** | **0,766** | **0,603** | **1,000** | **0,262** | **0,738** |

El score del Benchmark es TPR − FPR: pasó de 0,163 a 0,738. El modo con
orígenes del catálogo da las mismas cifras, porque todos los casos leen el
`request` del servlet.

Los 184 falsos positivos que quedan son de dos tipos:

- **87, clase de otro archivo.** El dato pasa por
  `SeparateClassRequest.getTheValue`, que devuelve una constante; está en otro
  archivo del Benchmark, y para Java no se siguen llamadas entre archivos.
- **97, lista por índice.** `lista.add("a"); lista.add(dato); lista.add("b");
  lista.remove(0); lista.get(1)` devuelve `"b"`. La lista se trata entera.

Los casos no vulnerables del Benchmark están armados para engañar a un
análisis que no sigue el valor; las correcciones de abajo surgieron, en parte,
de revisarlos. La cifra final no es una medición independiente.

## Correcciones

Del motor, para los cuatro lenguajes salvo donde se indica:

1. **Validaciones que cortan** (`lang/guards.ts`, `lang/validators.ts`):
   regex que acepta la cadena entera, chequeos de tipo, listas permitidas y
   comparación con literales, con `&&`, `||` y `!`; protegen la rama en la que
   se cumplen y, si la otra corta siempre, lo que sigue al `if`.
2. **Asignaciones que pisan** (`reachingFrom`): la última asignación que corre
   siempre antes de un uso descarta las anteriores.
3. **Colecciones**: `add`, `put`, `push`, `append`, `extend` y `array_push`
   contaminan el objeto; un mapa con claves literales se sigue por clave (también
   JavaScript).
4. **Ramas constantes** (Java): `if`, ternario y `switch` con condición
   calculable.
5. **`new Clase().m(x)`** (Java) se resuelve al método de la clase del archivo.
6. **Profundidad máxima** de un camino: de 15 a 30 aristas. Las asignaciones
   que pisan alargan los caminos (el dato pasa por cada reasignación).

7. **Bibliotecas minificadas** (`*.min.js`, `*-min.js`): al recorrer una
   carpeta (CLI, carga en la web, importación desde GitHub) se saltean; nombradas
   directamente, se analizan.

Del catálogo:

- Go: `Query`, `QueryRow` y `Exec` sobre una variable que sale de `Prepare` no
  son destinos (`unlessReceiverInit`); `json.Marshal` sanea XSS.
- Java: `Runtime.exec` también por las variables de entorno (segundo argumento);
  `ProcessBuilder.command(lista)`; `out.format(...)`; `StringEscapeUtils.escapeHtml`
  y `escapeHtml3`.
- PHP: un escape de comillas (`mysqli_real_escape_string`, `addslashes`...) no
  sanea si su resultado se interpola sin comillas en una consulta.

## Efecto sobre las otras mediciones

| Medición | Antes | Después |
|---|---|---|
| Pruebas automatizadas (core / web) | 513 / 97 | 540 / 98 |
| Banco sintético | 43/43 | 43/43 |
| Pares vulnerable/corregido | 102/102 | 102/102 |
| Proyectos de GitHub, origen por defecto | 28/34, 60 falsas alarmas, 14 reales extra, precisión 0,41 | 28/34, 63, 15, 0,41 |
| Proyectos de GitHub, origen del catálogo | 26/34, 32, 13, 0,55 | 26/34, 34, 14, 0,54 |
| Proyectos de GitHub, línea de base | 30/34, 421 falsas alarmas, precisión 0,09 | 30/34, 420, 0,10 (por la reclasificación de abajo) |
| NodeGoat | 3/6, 7 sin etiqueta | 3/6, 8 sin etiqueta |

En los proyectos de GitHub, los cambios vienen de seguir lo que se agrega a una
colección: una inyección real más en vulnerable-node (`updateProfile` arma las
columnas del `UPDATE` con las claves de `req.body`; agregada a `reviewedReal`)
y tres falsas alarmas más por modelo (resultados de XPath y registros de
acceso que se juntan en un arreglo y se responden, y una dirección del
frontend de Juice Shop). En NodeGoat, el hallazgo nuevo sin etiqueta es
un `insertMany` de un script de carga de datos que recibe un arreglo armado con
`push`.

## Alcance

- Los proyectos vulnerables a propósito tienen fallas más directas que un
  proyecto habitual.
- DVWA y el Benchmark guiaron parte de las correcciones; vulpy y govwa solo
  se midieron.
- Se analizó cada archivo por separado; la inyección de segundo orden y los
  datos que cruzan archivos (DVWA `sqli/high`, el `$html` de DVWA,
  `SeparateClassRequest`) quedan fuera.
