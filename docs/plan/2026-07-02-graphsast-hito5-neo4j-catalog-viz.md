# Hito 5 — Neo4j, catálogo CWE e informes

**Fecha:** 2026-07-02  
**Estado:** Implementado (motor en memoria + Neo4j opcional).

## C — Persistencia Neo4j

```bash
npm run neo4j:up          # docker compose (puertos 7474 / 7687)
export NEO4J_URI=bolt://localhost:7687
export NEO4J_PASSWORD=graphsast-dev
npm run neo4j:probe       # paridad memory vs Cypher
```

| Módulo | Rol |
|--------|-----|
| `packages/core/src/store/neo4j.ts` | Carga batch del IRGraph |
| `packages/core/src/store/cypher.ts` | Plantilla Cypher de taint (§7 arquitectura) |
| `packages/core/src/engine/analyze.ts` | `analyzeWithEngine()` — memoria o Neo4j |

Sin Neo4j activo, la viz y el API usan **memoria** (badge «Memoria» en el header).

## D — Catálogo CWE (JSON)

```
catalog/
├── index.json
├── cwe-89-sqli.json
├── cwe-78-cmdi.json
└── cwe-79-xss.json
```

Las reglas de taint se generan desde el catálogo (`catalog/rules.ts`). Los hallazgos incluyen `cwe`, `cweName` y `ruleId`.

## E — Viz e informes

- **JSON** — portapapeles (informe completo con `report`)
- **HTML** — descarga para adjuntar a la memoria
- **PDF** — impresión del informe HTML (Guardar como PDF)
- Panel **Catálogo CWE** y badge de motor en la UI
- Ejemplos **I** (XSS) y **G+** (Finance completa)

## API `/api/analyze`

Devuelve además: `engine`, `report`, `catalog` (resumen CWE).
