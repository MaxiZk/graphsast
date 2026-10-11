# @graphsast/core

Análisis estático de flujo de datos (taint) para JavaScript y TypeScript.
Encuentra caminos desde una entrada no confiable hasta una operación peligrosa
sin sanitizador en el medio: inyección SQL (CWE-89), de comandos (CWE-78),
XSS (CWE-79) e inyección NoSQL (CWE-943). Sigue las llamadas entre archivos.

```bash
npm install -g @graphsast/core
graphsast scan .                                  # sale 1 si hay hallazgos
graphsast scan . --format sarif --out graphsast.sarif
```

Desde Node:

```js
import { scanPaths } from "@graphsast/core";

const result = scanPaths(["src"]);
for (const f of result.findings) console.log(`CWE-${f.cwe}`, `${f.file}:${f.sink.line}`, f.sink.code);
```

El código no sale de la máquina. Documentación completa, versión web y
limitaciones: https://github.com/MaxiZk/graphsast

## Licencia

MIT.
