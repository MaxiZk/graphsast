# GraphSAST

Analizador estático que representa el flujo de datos de un programa
JavaScript/TypeScript como un grafo y rastrea el recorrido de las entradas no
confiables hasta los puntos críticos, para detectar vulnerabilidades **antes**
de ejecutar la aplicación.

> Proyecto Final de Ingeniería en Informática, Universidad del Salvador (USAL).
> Autor: Maximo Zuidwijk. Ver [`GraphSAST_Proyecto.md`](GraphSAST_Proyecto.md)
> para el contexto académico completo.

## El código no sale de la máquina

GraphSAST se usa como **CLI** (terminal y CI/CD) o como **API local** que
consume la interfaz de visualización. En ningún caso envía código a un
servidor externo:

- La API escucha únicamente en `127.0.0.1`. No hay opción para cambiarlo, y la
  interfaz se niega a arrancar si Vite se configura para escuchar en la red.
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
  llamada del código analizado alimenta.
- **Sink**: dónde ese dato puede causar daño (`db.query`, `execSync`, `innerHTML`).
- **Sanitizer**: función que limpia el dato (`validator.escape`, `sanitize`).
- **Hallazgo**: existe un camino de source a sink que no atraviesa un sanitizer.

Los sanitizers se **quitan del grafo** antes de buscar el camino, de modo que
todo camino hallado es por construcción no sanitizado. Las familias activas
están en [`catalog/`](catalog/): CWE-89, CWE-78, CWE-79 y CWE-943.

## Instalación

Requiere Node.js (probado con 24 y 26) y npm.

```bash
git clone https://github.com/MaxiZk/graphsast.git
cd graphsast
npm install
npm run build
```

El paquete no está publicado en npm. El CLI queda disponible como
`npx graphsast` dentro del repositorio, o como
`node packages/core/dist/cli/graphsast.cli.js` desde cualquier lugar. Busca el
catálogo CWE en `catalog/` del propio repositorio; si no lo encuentra, termina
con código 2 en vez de reportar «sin hallazgos».

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
| `GET /api/health` | Estado del servicio, versión y motor (`memory` o `neo4j`) |
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

## Visualización web

```bash
npm start          # http://127.0.0.1:5173
```

Pegar código, analizar, y ver el grafo con el camino de riesgo resaltado.
Incluye ejemplos precargados y exportación del informe a HTML/PDF. La
interfaz consume la API local a través del proxy de Vite: si ya hay un
`graphsast serve` en el puerto 5174 lo reutiliza, y si no lo levanta. El
puerto se cambia con `GRAPHSAST_API_PORT`.

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
reporta precisión, recall, F1 y ms/línea. Ver
[`docs/validacion/`](docs/validacion/) para la metodología.

## Neo4j (opcional)

```bash
npm run neo4j:up      # docker compose
NEO4J_URI=bolt://localhost:7687 npm start
```

Con `NEO4J_URI` definida y apuntando a esta máquina, la interfaz y
`graphsast serve` persisten el grafo y ejecutan la detección como consulta
Cypher en vez del motor en memoria. El CLI `scan` usa siempre el motor en
memoria.

## Desarrollo

```bash
npm test          # tests de core y viz
npm run build     # tsc -b
```

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
packages/viz/  aplicación web (Vite + Cytoscape.js)
```

## Limitaciones

**Análisis entre archivos.** GraphSAST sigue el dato de un archivo a otro
cuando un archivo llama a una `function` declarada en otro archivo del mismo
escaneo, importada con `import` de ES y ruta relativa (nombrada, con alias,
default o namespace, directa o a través de re-exports y `export *`). **No** lo
sigue a través de `require`/`module.exports`, arrow functions o `const`
exportadas, métodos de clase, alias de `tsconfig` (`@/x`), paquetes de
`node_modules` ni `import()` dinámico. En esos casos cada archivo se analiza
por separado, y el hallazgo, si lo hay, arranca en el parámetro de la función
que contiene el sink en vez de en el controlador.

**Resolución de llamadas.** Tanto dentro de un archivo como entre archivos,
una llamada solo se resuelve si apunta a una `function` declarada por nombre.
Las arrow functions, las funciones asignadas a variables y las llamadas sobre
objetos (`service.find()`, `this.repo.save()`) no se resuelven. En una
aplicación Express o NestJS escrita con clases o arrow functions, el camino
desde el handler hasta el sink no se reconstruye.

**Modelo de source.** Toda función cuyo parámetro no está ligado por una
llamada del código analizado se trata como punto de entrada. Una función
exportada que nadie llama dentro del escaneo, o que solo recibe literales,
produce hallazgos aunque en la práctica reciba datos internos. El campo
`sources` de `catalog/*.json` (`req.body`, etc.) no se usa.

**Sanitizer dentro de la función llamada.** Si `f(x)` sanea `x` adentro y
retorna el resultado, el camino desde el argumento hasta lo que `f` retorna no
pasa por el sanitizer (aristas `CALLS` + `RETURNS`) y el hallazgo se reporta
igual. Un sanitizer en el llamador sí corta el camino. Pasa igual dentro de un
archivo y entre archivos.

**Closures.** Una función anidada que usa una variable de la función que la
envuelve (`run(() => db.query(q))`) no queda conectada a esa variable: el
flujo se pierde.

**Sinks por nombre.** Un sink se reconoce por el nombre de la llamada, sin el
tipo del objeto: `regex.exec(x)` coincide con el sink `exec` de CWE-78 y
produce un falso positivo.

**Precisión general.** El análisis no es sensible al contexto de llamada ni
al camino de ejecución, y la profundidad máxima de un camino es 15 pasos. Solo
se analiza JavaScript y TypeScript; un archivo que el parser no entiende es un
error, no un archivo limpio. Las métricas del benchmark clasifican por
snippet, lo que puede inflar la precisión.

**API local.** Pensada para una sola persona en su máquina: no tiene
autenticación (la protegen el bind a `127.0.0.1` y el chequeo de `Host`) y
analiza de forma sincrónica, una petición por vez.

Más detalle en [`docs/validacion/`](docs/validacion/).
