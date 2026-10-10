# Reporte de texto, caso B

Salida de `graphsast scan caso-b --verbose`, que se entrega al participante en la condición de texto junto con los archivos del caso.

```text
GraphSAST — análisis estático de flujo de datos

sistema.js
1. CWE-78 OS Command Injection
   en sistema.js:4:10
   source rutas.js:3  req
          rutas.js:4  carpeta = req.body.carpeta
          rutas.js:5  armarRuta(carpeta)
          rutas.js:5  destino = armarRuta(carpeta)
          L  3  ruta
   sink   L  4  execSync("tar -czf reporte.tgz " + ruta)
   regla: cwe-78-sink-execSync

────────────────────────────────────────────────────────────
1 hallazgo(s) en 1/2 archivo(s) · 27 líneas · 18 ms (0.68 ms/línea) · 2 llamada(s) entre archivos
```
