# GraphSAST

Analizador estático que representa el flujo de datos de un programa
JavaScript/TypeScript como un grafo y rastrea el recorrido de las entradas no
confiables hasta los puntos críticos, para detectar vulnerabilidades **antes**
de ejecutar la aplicación.

**Versión web:** https://graph-sast.vercel.app/ (el análisis corre en el navegador;
el código no se sube a ningún servidor).

> Proyecto Final de Ingeniería en Informática, Universidad del Salvador (USAL).
> Autor: Maximo Zuidwijk. Ver [`GraphSAST_Proyecto.md`](GraphSAST_Proyecto.md)
> para el contexto académico completo.

## El código no sale de la máquina

GraphSAST se usa como **página web**, como **CLI** (terminal y CI/CD) o como
**API local**. En ningún caso envía código a un servidor externo:

- La página web analiza en el navegador: los archivos que el usuario sube se
  leen y se analizan en su equipo, y el servidor solo entrega la página.
- La API escucha únicamente en `127.0.0.1`. No hay opción para cambiarlo.
- Neo4j, que es opcional, solo se usa si `NEO4J_URI` apunta a esta máquina. Si
  apunta a otra, se ignora y se usa el motor en memoria.
- El único archivo que puede salir del equipo es el reporte SARIF que el
  usuario decida subir, por ejemplo a GitHub.

## Cómo funciona

```
código fuente → AST (ts-morph) → IR → grafo (CALLS / FLOWS_TO / BINDS_TO / RETURNS)
                                          ↓
                 enlace entre archivos (llamadas a funciones importadas)
                                          ↓
                          taint: ¿hay camino source → sink sin sanitizer?
```

- **Source**: todo parámetro de función (salvo `res`, `next` y `_`) que ninguna
  llamada del código analizado alimenta. Con `--sources catalog`, solo los que
  declara el catálogo (`req`, `request`, `ctx`, `@Body()` de NestJS...).
- **Sink**: dónde ese dato puede causar daño (`db.query`, `execSync`, `innerHTML`).
- **Sanitizer**: función que limpia el dato para una CWE (`escapeHtml` para XSS,
  `parseInt` para cualquiera).
- **Hallazgo**: existe un camino de source a sink que no atraviesa un sanitizer
  de la CWE del sink.

Los sanitizers se **quitan del grafo** antes de buscar el camino, de modo que
todo camino hallado es por construcción no sanitizado. Las familias activas
están en [`catalog/`](catalog/): CWE-89, CWE-78, CWE-79 y CWE-943.

Las llamadas a funciones del propio código se siguen: funciones declaradas,
arrows y function expressions guardadas en una variable, campo o propiedad,
métodos (`this.m()`, `Clase.m()`, `objeto.m()`), imports de ES y de CommonJS.
El dato entra a la función por sus parámetros (`BINDS_TO`) y vuelve al llamador
por lo que la función retorna (`RETURNS`), así que un sanitizer dentro de la
función corta el camino.

### Formato del catálogo

Cada `catalog/cwe-*.json` declara `sources`, `sinks` y `sanitizers`. Un sink es
un patrón de callee (`"db.query"`, `".save"`, `"innerHTML"`) o un objeto con
restricciones:

```json
{ "callee": "db.query", "args": [0] }
{ "callee": "exec", "bare": true, "args": [0] }
{ "callee": "child_process.exec", "args": [0] }
{ "callee": ".find", "receiver": "^[A-Z][A-Za-z0-9_]*$" }
```

- `args`: posiciones de los argumentos peligrosos. `db.query(sql, [id])` solo
  es vulnerable por `sql`: los valores ligados por parámetro son la forma
  segura de escribir la consulta.
- `bare`: solo la llamada suelta, `exec(...)` y no `regex.exec(...)`.
- `receiver`: expresión regular sobre el receptor (`User.find(...)` sí,
  `users.find(...)` no).
- Un patrón `paquete.f` coincide aunque el import tenga otro nombre local
  (`const cp = require("child_process"); cp.exec(x)`).

Una familia puede fijar `"maxDepth": n`, el largo máximo (en aristas) de un
camino hasta sus sinks; sin esto es 15. `--max-depth` lo reemplaza para todas
las familias. Los dos motores lo respetan.

En `sources`, `req.body` aporta la raíz `req`, y `@Body` los parámetros
decorados con `@Body()`. Solo se usan con `--sources catalog`.

## Instalación

Requiere Node.js 22 o superior (el CI usa 22) y npm.

```bash
git clone https://github.com/MaxiZk/graphsast.git
cd graphsast
npm install
npm run build
```

El CLI queda disponible como `npx graphsast` dentro del repositorio, o como
`node packages/core/dist/cli/graphsast.cli.js` desde cualquier lugar. Busca el
catálogo CWE en `catalog/` del propio repositorio; si no lo encuentra, termina
con código 2 en vez de reportar «sin hallazgos».

### Como paquete

`@graphsast/core` todavía no está en npm. Cada release de GitHub trae el
paquete (`graphsast-core-<versión>.tgz`), que se instala igual:

```bash
npm install -g ./graphsast-core-0.1.0.tgz   # o la URL del asset del release
graphsast scan .
```

El paquete lleva su copia del catálogo y la API de Node (`scanPaths`,
`analyzeGraph`...). Para armarlo desde el repositorio: `npm pack -w @graphsast/core`.

### Con Docker

```bash
docker build -t graphsast .
docker run --rm -v "$PWD:/src:ro" graphsast scan .
docker run --rm -v "$PWD:/src:ro" graphsast scan . --format sarif > graphsast.sarif
```

La imagen trae solo el CLI y el catálogo, sobre `distroless` y con un usuario
sin privilegios. El proyecto se monta en `/src` de solo lectura, así que el
reporte se saca redirigiendo la salida en vez de con `--out`. `graphsast serve`
no sirve desde un contenedor: la API solo acepta conexiones de `127.0.0.1`.

## CLI

### Archivo o carpeta

```bash
npx graphsast scan src/controllers/finance.ts   # un archivo
npx graphsast scan ./src                        # una carpeta, recursiva
npx graphsast scan src lib                      # varias rutas
```

En una carpeta se analizan `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` y `.cjs`.
Siempre se excluyen `node_modules/`, `dist/`, `build/`, `coverage/` y `.git/`,
y se respetan los `.gitignore` del proyecto analizado, incluidos los de las
carpetas superiores hasta la raíz del repositorio. Para excluir algo más:

```bash
npx graphsast scan . --exclude "**/*.test.ts" --exclude fixtures/
```

`--exclude` usa la sintaxis de `.gitignore`, relativa a la carpeta escaneada.
Un archivo pasado explícitamente se analiza aunque un `.gitignore` lo excluya.

### Formatos de salida

```bash
npx graphsast scan ./src                                    # texto (default)
npx graphsast scan ./src --format json --output out.json    # resultado completo
npx graphsast scan . --format sarif --output graphsast.sarif
```

**Texto.** Agrupa por archivo, con una línea por hallazgo: línea del sink,
familia CWE y el camino del dato. Si el camino cruza archivos, cada cambio de
archivo se marca con `(archivo:línea)`:

```
src/repository.ts
  L2  CWE-89  req (src/controller.ts:2) → id (src/service.ts:2) → userId (src/repository.ts:1) → db.query

────────────────────────────────────────────────────────────
1 hallazgo(s) en 1/3 archivo(s) · 15 líneas · 91 ms (6.09 ms/línea) · 2 llamada(s) entre archivos
```

`--verbose` muestra un bloque por hallazgo con la línea y el código de cada
paso; `--no-path` muestra solo source y sink.

**JSON.** El resultado completo: archivos, hallazgos con cada paso (archivo,
línea, columna, código), errores y totales.

**SARIF 2.1.0.** El formato que GitHub muestra en la pestaña *Security*:

- `ruleId` es la familia CWE (`cwe-89`), con una regla por familia activa.
- La ubicación del resultado es el sink: archivo, línea y rango.
- El camino completo va en `codeFlows`, con cada paso en su archivo.
- Las rutas son relativas al directorio desde el que se corre el comando, que
  en CI tiene que ser la raíz del repositorio.
- Si algún archivo no se pudo analizar, `invocations` lo marca como ejecución
  no exitosa y lista esos archivos.

Los tests validan la salida contra el esquema oficial OASIS SARIF 2.1.0.

### Códigos de salida

| Código | Significado |
|---|---|
| `0` | Análisis completo, sin hallazgos |
| `1` | Análisis completo, con hallazgos |
| `2` | Error: uso incorrecto, ruta inexistente o ilegible, ningún archivo analizable, algún archivo que el parser no entendió, o catálogo CWE ausente |

Un análisis incompleto da `2` aunque también haya hallazgos: un pipeline no
queda en verde sin haber mirado todo el código.

```bash
npx graphsast scan ./src --fail-on cwe-89,cwe-78
```

`--fail-on` limita qué familias provocan el `1`; el reporte las sigue
mostrando todas. Una familia que no está activa en el catálogo es un error
(`2`), para que un error de tipeo no deje el pipeline en verde.
`--exit-zero` devuelve `0` aunque haya hallazgos, pero no oculta el `2`.

### Opciones

| Opción | Descripción |
|---|---|
| `--format <text\|json\|sarif>` | Formato de salida (default `text`) |
| `--output`, `--out <archivo>` | Escribir el reporte a un archivo |
| `--exclude <patrón>` | Exclusión adicional, sintaxis `.gitignore`; repetible |
| `--ignore <a,b>` | Nombres de carpeta a excluir, además de los obligatorios |
| `--ext <.ts,.js>` | Extensiones a analizar |
| `--cwe <89,79>` | Reportar solo estos CWE |
| `--fail-on <cwe-89,…>` | Solo estas familias provocan el código `1` |
| `--no-cross-file` | Analizar cada archivo por separado |
| `--sources <params\|catalog>` | Qué parámetros son entrada no confiable: todos los que nadie llama (default) o solo los del catálogo |
| `--max-depth <n>` | Profundidad máxima del camino (default 15) |
| `--max-file-bytes <n>` | Omitir archivos más grandes (default 1 MB) |
| `--verbose`, `--no-path` | Nivel de detalle del reporte de texto |
| `--exit-zero` | Salir con `0` aunque haya hallazgos |

`npx graphsast --help` muestra la lista completa.

## API local

```bash
npx graphsast serve --port 5174 --root .
```

Levanta un servidor HTTP en `127.0.0.1:5174`. `--root` es la única carpeta que
se puede analizar por ruta (default: el directorio actual).

| Endpoint | Descripción |
|---|---|
| `GET /api/health` | Estado del servicio, versión, motor (`memory` o `neo4j`) y estado de Neo4j en ese momento (`connected`, `unreachable` o `disabled`) |
| `GET /api/catalog` | Familias CWE activas con la cantidad de sinks y sanitizers de cada una |
| `POST /api/analyze` | Cuerpo JSON `{"code": "...", "file": "a.ts"}` o `{"path": "src"}` |

```bash
curl -s http://127.0.0.1:5174/api/catalog

curl -s -X POST http://127.0.0.1:5174/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"code": "function h(req){ db.query(req.body); }"}'

curl -s -X POST http://127.0.0.1:5174/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"path": "src"}'
```

Con `code` responde el grafo, los hallazgos, el veredicto y el informe que usa
la interfaz. Con `path` responde el mismo resultado que `scan --format json`.

Protecciones:

- **Rutas:** se resuelven contra `--root`. Se rechaza con `400` todo lo que
  salga de ahí: `../`, rutas absolutas externas y enlaces simbólicos que apunten
  afuera. Una ruta inexistente dentro de la raíz da `404`.
- **Cuerpo:** limitado a 2 MiB (`413`). `POST` exige
  `Content-Type: application/json` (`415`). Esto obliga al navegador a hacer un
  preflight CORS que la API no responde, así que una página web ajena no puede
  disparar análisis.
- **Host:** el header `Host` tiene que ser `127.0.0.1`, `localhost` o `[::1]`
  (`403`), como defensa contra DNS rebinding.

## Versión web

Publicada en https://graph-sast.vercel.app/. Para correrla en local:

```bash
npm start          # http://localhost:5173
```

El usuario elige o arrastra una carpeta (o archivos sueltos) de su proyecto y,
al terminar el análisis, ve las vulnerabilidades encontradas: cada hallazgo con
su familia CWE, el archivo y la línea del sink, el camino completo del dato
(aunque cruce archivos), el código con las líneas del camino resaltadas y el
grafo. La pestaña «Ejemplos» permite pegar código y trae dos casos que difieren
en una línea: una consulta SQL vulnerable y la misma consulta con `sanitize()`.

El análisis corre en el navegador, en un Web Worker, con el mismo motor que el
CLI (`@graphsast/core/browser`, sin Neo4j): se analizan los mismos archivos
(`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx` de hasta 1 MB, fuera de
`node_modules`, `dist`, `build` y demás carpetas excluidas, respetando los
`.gitignore` subidos) y se siguen las llamadas entre archivos igual que en
`scan`, con los alias de los `tsconfig.json`/`jsconfig.json` subidos.

Sobre el grafo: búsqueda de nodos por nombre, código o `archivo:línea` (Enter
encuadra la primera coincidencia), y exportación a PNG (lo dibujado) y a JSON
(el grafo completo con los hallazgos). Al pasar el puntero por un nodo se ve
su código completo. En un proyecto, el grafo dibujado se recorta alrededor del
hallazgo elegido; el selector «Nodos» fija cuántos se dibujan (de 100 a todos).

Tema claro u oscuro (por defecto, el del sistema) y atajos de teclado: `n`/`p`
hallazgo siguiente o anterior, `f` centrar, `/` buscar, `h` atenuar lo que no
está en el camino y `t` cambiar el tema. El tema y el límite de nodos se
guardan en el navegador.

Como el sitio es estático, se despliega en Vercel sin funciones de servidor:
`vercel.json` compila el core y la página (`npm run viz:build`) y publica
`packages/viz/dist`. En Vercel, el **Root Directory** del proyecto tiene que ser
la raíz del repositorio: si apunta a `packages/viz`, el build no ve el core.

Para probar el build de producción en local:

```bash
npm run viz:preview   # compila core y página, y sirve el resultado
```

## GitHub Actions

Ejemplo de workflow que analiza el repositorio, sube el SARIF a Code Scanning
y hace fallar el job si hay hallazgos de las familias indicadas:

```yaml
name: GraphSAST

on:
  push:
  pull_request:

jobs:
  graphsast:
    runs-on: ubuntu-latest
    permissions:
      security-events: write   # subir el SARIF
      actions: read            # solo en repositorios privados
      contents: read
    steps:
      - uses: actions/checkout@v7

      - name: Obtener GraphSAST
        uses: actions/checkout@v7
        with:
          repository: MaxiZk/graphsast
          path: .graphsast

      - uses: actions/setup-node@v7
        with:
          node-version: 24

      - name: Compilar GraphSAST
        working-directory: .graphsast
        run: npm ci && npm run build

      - name: Analizar
        run: >
          node .graphsast/packages/core/dist/cli/graphsast.cli.js scan .
          --exclude .graphsast/
          --format sarif --output graphsast.sarif
          --fail-on cwe-89,cwe-78

      - name: Subir SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: graphsast.sarif
          category: graphsast
```

El análisis corre desde la raíz del repositorio, así que las rutas del SARIF
quedan como GitHub las espera. `if: always()` sube el reporte aunque el paso
anterior termine con `1`; el job igual queda en rojo. Si el repositorio de
GraphSAST es privado, el segundo `checkout` necesita un `token` con acceso.

Este workflow no se ejecutó todavía en GitHub Actions. Sus pasos sí se
reprodujeron localmente desde un clon limpio (`npm ci`, build, análisis con
`--exclude .graphsast/`), y el SARIF resultante valida contra el esquema
oficial. El CLI está probado con Node 24 y 26.

## Benchmark de validación

```bash
npm run benchmark
```

Corre el corpus etiquetado (`packages/core/src/eval/benchmark/corpus.ts`) y
reporta precisión, recall, F1 y ms/línea; sale con `1` si algún caso se
clasifica mal. `npm run cve:run` corre el corpus de vulnerabilidades reales
(`eval-cve-corpus.json`, baja los paquetes de npm). Ver
[`docs/validacion/`](docs/validacion/) para la metodología.

El workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) corre build,
tests (incluidos los del CLI de punta a punta), benchmark y build de la web en
cada push a `main` y en cada PR; el benchmark de CVEs, una vez por semana o a
mano.

## Neo4j (opcional)

```bash
npm run neo4j:up      # docker compose
NEO4J_URI=bolt://localhost:7687 npm start
```

Con `NEO4J_URI` definida y apuntando a esta máquina, `graphsast serve`
persiste el grafo y ejecuta la detección como consulta Cypher en vez del motor
en memoria. El CLI `scan` y la versión web usan siempre el motor en memoria.

Cada análisis se guarda con su propio id (`run`) y se borra al terminar la
consulta, así que dos peticiones simultáneas no se pisan. La primera crea el
índice `gsnode_run_id` sobre `(run, id)`.

Los tests del motor Neo4j (`packages/core/src/store/neo4j.integration.test.ts`)
corren contra una base real solo si `NEO4J_URI` está definida. Comparan los
hallazgos con los del motor en memoria en todo el benchmark:

```bash
npm run neo4j:up
NEO4J_URI=bolt://localhost:7687 npm test -w @graphsast/core
```

## Desarrollo

```bash
npm test          # tests de core y viz
npm run build     # tsc -b
```

Cómo está armado: [`ARCHITECTURE.md`](ARCHITECTURE.md). Cómo agregar sinks,
familias CWE o casos al benchmark, y el flujo de PRs: [`CONTRIBUTING.md`](CONTRIBUTING.md).

Estructura:

```
packages/core/src/
  parser/      texto fuente → SourceFile (ts-morph)
  ir/          AST → IR; expressions.ts extrae las raíces de flujo
  cfg/         call graph
  dfg/         data-flow intra e inter-procedural
  project/     imports/exports y llamadas entre archivos
  taint/       reglas, alcanzabilidad y detección
  catalog/     catálogo CWE externo (catalog/*.json)
  store/       persistencia y consultas Neo4j
  scan/        escaneo de archivos/directorios + reporters
  server/      API local (graphsast serve)
  cli/         binario graphsast
  eval/        corpus y métricas
packages/viz/  versión web (Vite + Cytoscape.js); el análisis corre en un Web Worker
```

## Limitaciones

**Análisis entre archivos.** GraphSAST sigue el dato de un archivo a otro
cuando una llamada apunta a una función de otro archivo del mismo escaneo:
importada con `import` de ES (nombrada, con alias, default o namespace, directa
o a través de re-exports y `export *`), con `require` (`module.exports`,
`exports.f`) o con `import()` asignado a una variable; por ruta relativa o por
un alias de `tsconfig`/`jsconfig` (`paths`, `baseUrl`, con `extends` relativo);
declarada como `function` o como `const` con una arrow. **No** lo sigue hacia
paquetes de `node_modules`, ni a través de `extends` hacia un paquete
(`@tsconfig/...`), `import()` con una ruta calculada o `import("./x").then(...)`.
En esos casos el hallazgo, si lo hay, arranca en el parámetro de la función que
contiene el sink en vez de en el controlador.

**Métodos sobre receptores desconocidos.** Sin tipos, `this.repo.save()` o
`svc.findOne()` no dicen qué clase hay detrás. Se resuelven al único método
con ese nombre en todo el código analizado; si hay dos, o el nombre es de la
biblioteca estándar (`find`, `get`, `then`, `exec`...), no se resuelven. Es
una heurística: en esas llamadas se conserva además el atajo argumento →
resultado, para no perder un sink de biblioteca homónimo.

**Modelo de source.** Por defecto, toda función cuyo parámetro no está ligado
por una llamada del código analizado se trata como punto de entrada: una
función exportada que nadie llama dentro del escaneo produce hallazgos aunque
en la práctica reciba datos internos. `--sources catalog` lo restringe a los
sources del catálogo, a costa de perder entradas con otros nombres.

**Estado compartido.** El análisis no es sensible al orden: una variable de
módulo o de una closure que varias funciones escriben acumula todo lo que se
escribe en ella, y aparece en los caminos de todas las que la leen.

**Sinks por nombre.** Un sink se reconoce por el callee, no por el tipo del
objeto. Las restricciones del catálogo (`bare`, `receiver`, paquete de origen)
evitan los casos conocidos (`regex.exec`, `users.find`), pero un nombre de
receptor convencional (`db.query`, `conn.query`) puede no ser lo que parece.
`new Modelo(x)` es transparente: `new ObjectId(id)` no sanea.

**Validación no es sanitización.** `zod`, `joi` o `class-validator` validan la
forma del dato, no su contenido: un `z.string()` acepta `' OR 1=1 --`. Por eso
no están en el catálogo como sanitizers. Las conversiones numéricas
(`parseInt`, `Number`) sí, porque un número no puede llevar la inyección.

**Precisión general.** El análisis no es sensible al contexto de llamada ni
al camino de ejecución, y la profundidad máxima de un camino es 15 pasos. Solo
se analiza JavaScript y TypeScript; un archivo que el parser no entiende es un
error, no un archivo limpio. Las métricas del benchmark clasifican por
snippet, lo que puede inflar la precisión.

**API local.** Pensada para una sola persona en su máquina: no tiene
autenticación (la protegen el bind a `127.0.0.1` y el chequeo de `Host`) y
analiza de forma sincrónica, una petición por vez.

Más detalle en [`docs/validacion/`](docs/validacion/).

## Licencia

[MIT](LICENSE).
