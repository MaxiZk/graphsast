# Gramáticas de tree-sitter

Analizadores sintácticos compilados a WebAssembly para los lenguajes que no son
JavaScript/TypeScript. Los carga `web-tree-sitter` (ver `src/lang/`), en Node
desde esta carpeta y en el navegador como recursos del bundle.

| Archivo | Paquete de origen | Versión | Licencia |
|---|---|---|---|
| `python.wasm` | `tree-sitter-python` | 0.25.0 | MIT (`LICENSE-tree-sitter-python`) |
| `java.wasm` | `tree-sitter-java` | 0.23.5 | MIT (`LICENSE-tree-sitter-java`) |
| `php.wasm` | `tree-sitter-php` (`tree-sitter-php.wasm`, con HTML) | 0.24.2 | MIT (`LICENSE-tree-sitter-php`) |
| `go.wasm` | `tree-sitter-go` | 0.25.0 | MIT (`LICENSE-tree-sitter-go`) |

Se copian del paquete publicado en npm en lugar de depender de él porque esos
paquetes compilan un binding nativo al instalarse, que GraphSAST no usa. Para
actualizar una gramática: `npm pack tree-sitter-<lenguaje>@<versión>`, copiar
el `.wasm` y su `LICENSE`, y correr las pruebas de pares de ese lenguaje.
