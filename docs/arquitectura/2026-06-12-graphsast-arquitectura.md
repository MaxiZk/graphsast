# GraphSAST — Documento de Arquitectura

**Proyecto Final de Ingeniería en Informática — Universidad del Salvador**
**Alumno:** Maximo Zuidwijk
**Fecha:** 2026-06-12
**Estado:** Diseño aprobado (decisiones de fondo cerradas)

> Este documento define la arquitectura técnica de GraphSAST antes de la implementación.
> Está redactado para ser reutilizado como capítulo *"Diseño de la solución"* de la memoria.

---

## 1. Contexto y objetivo

GraphSAST es un analizador estático de código (SAST) que **compila la lógica de una aplicación TS/JS en un grafo de flujo de datos** y detecta vulnerabilidades de arquitectura mediante **análisis de taint**: rastrea datos no confiables desde su origen (*source*) hasta puntos críticos (*sink*) y verifica si fueron saneados en el camino.

El aporte académico **no** es el análisis de taint en sí (ya existe en herramientas profesionales), sino el **diseño e implementación propios** de: la IR, el algoritmo de construcción del grafo, el motor de consultas y la visualización; todo **validado sobre datos reales** con métricas reproducibles.

Pregunta de investigación: *¿Puede un analizador basado en grafos de flujo de datos detectar vulnerabilidades de arquitectura con mayor precisión y menos falsos positivos que las herramientas por coincidencia de patrones de texto?*

## 2. Decisiones de arquitectura (ADRs resumidas)

| # | Decisión | Elección | Justificación | Alternativas descartadas |
|---|----------|----------|---------------|--------------------------|
| ADR-1 | Estrategia de parsing | **tree-sitter / TS Compiler API** (reuso) | El mérito está en grafo+taint+consultas+viz, no en reescribir un parser de TS/JS. Viable en 10 meses. Mismo criterio que CodeQL/Joern/Semgrep. | Parser propio desde cero (consume meses, arriesga no llegar al núcleo); subconjunto propio (no analiza TS/JS real). |
| ADR-2 | Lenguaje del motor | **TypeScript / Node.js** | Un solo lenguaje de punta a punta; AST tipado y rico; visualización web nativa. | Python (AST de TS/JS menos natural); híbrido (dos runtimes, más complejidad). |
| ADR-3 | Almacenamiento y consultas del grafo | **Neo4j + Cypher** | Las consultas source→sink son búsqueda de caminos declarativa = el marco teórico ("seguridad = accesibilidad sobre grafo dirigido"). Material académico abundante. | Grafo en memoria (motor de consultas casero, no declarativo); Kùzu (menos referencias académicas). |
| ADR-4 | Patrones detectados | **CWE-89 SQLi, CWE-78 Command Injection, CWE-79 XSS** | Tríada canónica de taint, las tres en CWE Top 25, máxima cantidad de casos etiquetados en SARD y OWASP Benchmark. | Path Traversal/SSRF (menos casos listos); secretos hardcodeados (no es taint source→sink, rompe la coherencia). |
| ADR-5 | Profundidad del análisis | **Inter-procedural acotado** | Honra la promesa de "vulnerabilidades de arquitectura" (datos que cruzan funciones/módulos) sin sensibilidad a contexto/camino completa ni profundizar en `node_modules`. Alcanzable en el cronograma. | Solo intra-procedural (debilita la tesis); field-sensitivity completa (alto riesgo de no terminar). |

## 3. Estilo arquitectónico

**Pipeline de compilador + property graph.** GraphSAST opera como un mini-compilador que, en lugar de generar código, produce un **grafo de propiedades** consultable. Cada etapa transforma una representación en la siguiente y es testeable de forma aislada:

```
código TS/JS
   │  parser (tree-sitter)
   ▼
  AST
   │  ir (normalización)
   ▼
  IR estable
   │  cfg (control + call graph)
   ▼
  CFG + Call Graph
   │  dfg (def-use, propagación)
   ▼
  Data-Flow Graph
   │  store (carga batch)
   ▼
  Neo4j (property graph)
   │  engine (Cypher + catálogo)
   ▼
  Hallazgos (caminos source→sink no saneados)
   │  report / viz
   ▼
  JSON + visualización interactiva
```

Se descarta la pasada monolítica sobre el AST: mezcla parsing con análisis e impide testear etapas por separado.

## 4. Componentes

Módulos con responsabilidad única, comunicados por interfaces explícitas:

| Módulo | Responsabilidad única | Depende de |
|--------|----------------------|------------|
| `parser` | Cargar archivos y producir AST con tree-sitter | tree-sitter-typescript |
| `ir` | Normalizar el AST a una IR estable | `parser` |
| `cfg` | Construir grafo de control y call graph del proyecto | `ir` |
| `dfg` | Construir el grafo de flujo de datos (def-use, propagación) | `cfg` |
| `store` | Persistir el grafo en Neo4j (carga batch) | `dfg`, driver Neo4j |
| `catalog` | Catálogo configurable de sources/sinks/sanitizers por CWE (JSON) | — |
| `engine` | Ejecutar consultas Cypher de taint y materializar hallazgos | `store`, `catalog` |
| `report` | Serializar hallazgos (JSON + camino source→sink) | `engine` |
| `viz` | Web app que dibuja el grafo y resalta el camino de riesgo | `report` |
| `eval` | Banco de pruebas, métricas y baseline | `engine` |

Criterio de aislamiento: cada módulo debe poder entenderse, testearse y reemplazarse sin tocar a los demás.

## 5. Modelo de grafo (núcleo del aporte)

### Nodos (etiquetas Neo4j)
`Function`, `Parameter`, `Variable`, `Literal`, `Call`, `Source`, `Sink`.
Propiedades comunes: `id`, `file`, `line`, `col`, `name`, `code`, `cwe?`.

### Relaciones (dirigidas)
| Relación | Semántica | Rol en el análisis |
|----------|-----------|--------------------|
| `(:Source\|Variable\|Call)-[:FLOWS_TO]->(:Variable\|Call\|Sink)` | Flujo de datos | Núcleo del taint |
| `(:Call)-[:CALLS]->(:Function)` | Call graph | Habilita lo inter-procedural |
| `(:Argument)-[:BINDS_TO]->(:Parameter)` | Paso de argumentos | Entrada al cruce de función |
| `(:Function)-[:RETURNS]->(:Variable)` | Valor de retorno | Salida del cruce de función |
| `(:Variable)-[:SANITIZED_BY]->(:Call)` | Saneamiento | Corta el camino de riesgo |

**Detectar una vulnerabilidad = encontrar un camino dirigido `Source ⇝ Sink` que no atraviese un nodo saneado.**

## 6. Modelo Source / Sink / Sanitizer

Catálogo externo en JSON (uno por CWE). Desacopla *qué buscar* de *cómo buscar*; agregar un patrón nuevo es **solo datos**, no código.

```jsonc
// catalog/cwe-89-sqli.json
{
  "cwe": 89,
  "name": "SQL Injection",
  "sources":    ["req.query", "req.body", "req.params"],
  "sinks":      ["db.query", "connection.execute", "sequelize.query"],
  "sanitizers": ["mysql.escape", "parameterized", "validator.escape"]
}
```

Durante la validación, la precisión y los FP se afinan ajustando el catálogo (parámetro experimental).

## 7. Motor de consultas (taint)

Una plantilla Cypher por patrón, parametrizada por el catálogo:

```cypher
MATCH path = (s:Source {cwe:$cwe})
             -[:FLOWS_TO|CALLS|BINDS_TO|RETURNS*1..15]->
             (k:Sink {cwe:$cwe})
WHERE NONE(n IN nodes(path) WHERE (n)-[:SANITIZED_BY]->())
RETURN path
```

El límite de profundidad (`*1..15`) acota el costo de cómputo y es un **parámetro medible** (alimenta la tabla de tiempos del anteproyecto).

## 8. Visualización

Web app liviana con **Cytoscape.js** (especializada en grafos, interactiva, soporta resaltado de caminos), servida por un Express mínimo que consulta Neo4j. El camino source→sink se pinta en rojo sobre el grafo del proyecto. Materializa H2 y H3 (la visualización reduce el esfuerzo de interpretación del hallazgo).

## 9. Validación y métricas

- **Banco de pruebas:** casos sintéticos propios (vuln/no-vuln, con/sin sanitizer) + subconjunto de **SARD/Juliet** y **OWASP Benchmark** para JS/Node.
- **Baseline ("herramienta de referencia por patrones"):** detector **regex propio** sobre las mismas reglas del catálogo. Ser propio aísla la variable de estudio (grafo vs patrón) y es más honesto que comparar contra una herramienta con otras capacidades. *Opcional:* Semgrep en modo no-taint como segundo punto de comparación.
- **Métricas:** precisión, recall, F1, FP, FN, y tiempo por cada 1.000 LOC.
- **Reproducibilidad:** banco versionado + scripts de evaluación automatizada (sostiene la sección "Calidad").

### Mapa hipótesis → evidencia
| Hipótesis | Cómo se evalúa |
|-----------|----------------|
| H1 (grafo detecta lo que el patrón no) | FN del baseline regex que GraphSAST sí detecta sobre el banco |
| H2 (taint reduce FP) | Comparación de FP GraphSAST vs baseline sobre los mismos casos |
| H3 (visualización ayuda) | Camino source→sink resaltado vs listado de texto; evaluación cualitativa |

## 10. Estructura del repositorio

```
graphsast/
├─ packages/
│  ├─ core/        # parser, ir, cfg, dfg, store, catalog, engine, report
│  ├─ cli/         # `graphsast analyze <ruta>`
│  └─ viz/         # web app Cytoscape.js
├─ catalog/        # JSON sources/sinks/sanitizers (CWE-89/78/79)
├─ benchmark/      # casos sintéticos + SARD/OWASP + scripts de eval
├─ docs/           # memoria/tesis (capítulos) + este documento
└─ docker-compose.yml  # Neo4j
```

## 11. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Lenguaje | TypeScript / Node.js |
| Parsing | tree-sitter + tree-sitter-typescript (o TS Compiler API) |
| Grafo | Neo4j (vía Docker) + driver oficial `neo4j-driver` |
| Consultas | Cypher |
| Visualización | Cytoscape.js + Express |
| Testing | Vitest (unitario por módulo) |
| Evaluación | Scripts Node + casos SARD/OWASP/sintéticos |

## 12. Riesgos técnicos y mitigación

| Riesgo | Mitigación |
|--------|-----------|
| Complejidad del análisis de TS/JS real | tree-sitter + acotar construcciones soportadas (documentar el subconjunto) |
| El grafo no escala en proyectos grandes | Límite de profundidad en Cypher, índices en Neo4j, acotar `node_modules` |
| Demasiados falsos positivos | Refinar catálogo de sources/sinks/sanitizers con el banco de pruebas |
| Inter-procedural más costoso de lo previsto | Degradar a intra-procedural por módulo como plan B documentado |

## 13. Alcance

**Incluye:** motor para TS/JS, detección de 3 patrones (CWE-89/78/79), persistencia en Neo4j, visualización interactiva, banco de pruebas y evaluación reproducible.
**No incluye:** corrección automática de código, integración nativa como plugin de IDEs comerciales, sensibilidad a contexto/camino completa, field-sensitivity completa.

---

*Próximo paso: plan de implementación incremental (parser → ir → cfg → dfg → store → engine → viz → eval), con criterios de aceptación por etapa.*
