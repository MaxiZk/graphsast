# Reporte de texto, caso A

Salida de `graphsast scan caso-a --verbose`, que se entrega al participante en la condición de texto junto con los archivos del caso.

```text
GraphSAST — análisis estático de flujo de datos

pedidos.js
1. CWE-89 SQL Injection
   en pedidos.js:2:10
   source rutas.js:3  req
          rutas.js:4  estado = req.query.estado
          rutas.js:5  armarFiltro(estado)
          rutas.js:5  filtro = armarFiltro(estado)
          L  1  filtro
   sink   L  2  db.query("SELECT * FROM pedidos WHERE " + filtro)
   regla: cwe-89-sink-db_query

────────────────────────────────────────────────────────────
1 hallazgo(s) en 1/2 archivo(s) · 25 líneas · 19 ms (0.76 ms/línea) · 2 llamada(s) entre archivos
```
