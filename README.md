# GraphSAST

Analizador estático que representa el flujo de datos de un programa
JavaScript/TypeScript como un grafo y rastrea el recorrido de las entradas no
confiables hasta los puntos críticos, para detectar vulnerabilidades **antes**
de ejecutar la aplicación.

> Proyecto Final de Ingeniería en Informática — Universidad del Salvador (USAL).
> Autor: Maximo Zuidwijk. Ver [`GraphSAST_Proyecto.md`](GraphSAST_Proyecto.md)
> para el contexto académico completo.

## Cómo funciona

```
código fuente → AST (ts-morph) → IR → grafo (CALLS / FLOWS_TO / BINDS_TO / RETURNS)
                                          ↓
                          taint: ¿hay camino source → sink sin sanitizer?
```

- **Source**: por dónde entra un dato no confiable (parámetros de handler, `req.*`).
- **Sink**: dónde ese dato puede causar daño (`db.query`, `execSync`, `document.write`).
- **Sanitizer**: función que limpia el dato (`validator.escape`, `sanitize`).
- **Hallazgo**: existe un camino de source a sink que no atraviesa un sanitizer.

Los sanitizers se **quitan del grafo** antes de buscar el camino, de modo que
todo camino hallado es por construcción no sanitizado.

## Instalación

```bash
npm install
npm run build
```

## Uso

### CLI — escanear un proyecto

```bash
npm run scan -- ./src                        # reporte de texto
npm run scan -- ./src --format json          # JSON
npm run scan -- ./src --format sarif --out graphsast.sarif
npm run scan -- app.js --cwe 89              # solo SQL injection
```

Salida:

```
src/routes/users.js
1. CWE-89 SQL Injection
   en src/routes/users.js:6:3
   source L  4  req
         L  5  id = req.params.id
   sink   L  6  db.query(`SELECT * FROM users WHERE id = ${id}`)
   regla: cwe-89-sink-db_query
```

Opciones principales (`--help` para la lista completa):

| Opción | Descripción |
|--------|-------------|
| `--format <text\|json\|sarif>` | Formato de salida (default `text`) |
| `--out <archivo>` | Escribir el reporte a un archivo |
| `--ext <.ts,.js>` | Extensiones a analizar |
| `--ignore <a,b>` | Carpetas a excluir (default: `node_modules`, `dist`, …) |
| `--cwe <89,79>` | Reportar solo estos CWE |
| `--max-depth <n>` | Profundidad máxima del camino (default 15) |
| `--exit-zero` | Salir con 0 aunque haya hallazgos |

**Códigos de salida:** `0` sin hallazgos · `1` con hallazgos · `2` error de uso.
Pensado para usarse como gate de CI.

El formato SARIF emite el camino de taint como `codeFlows`, de modo que GitHub
Code Scanning muestra el recorrido paso a paso y no solo la línea del sink.

### Visualización web

```bash
npm start          # http://localhost:5173
```

Pegar código, analizar, y ver el grafo con el camino de riesgo resaltado.
Incluye ejemplos precargados y exportación del informe a HTML/PDF.

### Benchmark de validación

```bash
npm run benchmark
```

Corre el corpus etiquetado (`packages/core/src/eval/benchmark/corpus.ts`) y
reporta precisión, recall, F1 y ms/línea. Ver
[`docs/validacion/`](docs/validacion/) para la metodología.

### Neo4j (opcional)

```bash
npm run neo4j:up      # docker compose
NEO4J_URI=bolt://localhost:7687 npm start
```

Con `NEO4J_URI` definida, el grafo se persiste y la detección corre como
consulta Cypher en vez del motor en memoria.

## Desarrollo

```bash
npm test          # 94 tests (core + viz)
npm run build     # tsc -b
```

Estructura:

```
packages/core/src/
  parser/      texto fuente → SourceFile (ts-morph)
  ir/          AST → IR; expressions.ts extrae las raíces de flujo
  cfg/         call graph
  dfg/         data-flow intra e inter-procedural
  taint/       reglas, alcanzabilidad y detección
  catalog/     catálogo CWE externo (catalog/*.json)
  store/       persistencia y consultas Neo4j
  scan/        escaneo de archivos/directorios + reporters
  cli/         binario graphsast
  eval/        corpus y métricas
packages/viz/  aplicación web (Vite + Cytoscape.js)
```

## Alcance y limitaciones

Implementado:

- Análisis intra-archivo con flujo intra e inter-procedural.
- Propagación por template literals, concatenación, destructuring, object/array
  literals, `await`, llamadas anidadas, asignaciones y métodos de clase.
- Catálogo CWE externo (CWE-89, CWE-78, CWE-79).
- Escaneo de directorios, reportes texto/JSON/SARIF, visualización web.

**No** implementado todavía:

- **Flujo entre archivos**: el taint no cruza `import`/`require`. El escaneo de
  un directorio analiza cada archivo por separado.
- **Resolución de símbolos**: la propagación indexa por nombre dentro del ámbito
  de función; dos variables homónimas en bloques distintos no se distinguen.
- **Métricas por hallazgo**: hoy se clasifica por snippet, lo que puede inflar
  la precisión.
- El campo `sources` de `catalog/*.json` no se usa: el modelo de source real es
  "todo parámetro de función salvo `res`/`next`/`_`".

Estas limitaciones están documentadas con más detalle en
[`docs/validacion/`](docs/validacion/).
