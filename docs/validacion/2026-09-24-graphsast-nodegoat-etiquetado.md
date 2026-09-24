# Etiquetado de OWASP NodeGoat

**Fecha:** 2026-09-24
**Estado:** borrador para revisar **antes** de ejecutar el analizador (riesgo R-02).
**Manifiesto:** `eval-nodegoat.json` en la raíz del repositorio.
**Versión analizada:** commit `c5cb68a7084e4ae7dcc60e6a98768720a81841e8` (Apache-2.0).

## Criterio

Se etiquetan las vulnerabilidades que NodeGoat **documenta** en dos fuentes:

1. los comentarios del código, que marcan cada falla ("Insecure use of eval()") y su corrección ("Fix for A1 - 2 NoSQL Injection");
2. el tutorial incluido en la aplicación (`app/views/tutorial/a1.html` y `a3.html`), que indica el archivo y la función de cada ejemplo.

Entran solo las de familias del catálogo: CWE-89, CWE-79, CWE-78 (que incluye `eval`) y CWE-943. No se agregaron vulnerabilidades encontradas por inspección propia, para que el corpus no dependa del juicio del autor.

## Vulnerabilidades etiquetadas

| ID | Tipo (OWASP 2013) | Familia | Destino | Sink en el catálogo |
|---|---|---|---|---|
| NG-01 | A1-1 inyección de JavaScript en el servidor | CWE-78 (`eval`) | `contributions.js:32` | Sí |
| NG-02 | A1-1 inyección de JavaScript en el servidor | CWE-78 (`eval`) | `contributions.js:33` | Sí |
| NG-03 | A1-1 inyección de JavaScript en el servidor | CWE-78 (`eval`) | `contributions.js:34` | Sí |
| NG-04 | A1-2 inyección NoSQL (`$where`) | CWE-943 | `allocations-dao.js:78-86` | No (`find`) |
| NG-05 | A3 XSS almacenado en el perfil | CWE-79 | `profile.js:33` (plantilla) | No (`res.render`) |
| NG-06 | A3 XSS por codificación en contexto incorrecto | CWE-79 | `profile.js:28-33` (plantilla) | No |

La columna "sink en el catálogo" es un dato del catálogo, no una predicción del resultado. Se registra antes de medir para poder separar después dos causas distintas de omisión: el catálogo no conoce la operación, o el motor no sigue el recorrido.

## Excluidas

Inyección en logs (CWE-117), redirección abierta (CWE-601), ReDoS (CWE-1333), SSRF (CWE-918), y A2 y A4 a A9 (autenticación, control de acceso, configuración, exposición de datos, CSRF y dependencias). Ninguna es un recorrido de un origen a un destino de las familias del catálogo.

## Regla de conteo

- **TP:** un hallazgo en el archivo del destino, con línea dentro del rango etiquetado. Cada vulnerabilidad cuenta una vez.
- **FN:** vulnerabilidad etiquetada sin hallazgo que coincida.
- **Otros hallazgos:** se revisan a mano y se informan aparte. No se suman como TP; se clasifican como falso positivo salvo que correspondan a una vulnerabilidad real no documentada, caso en el que se explica.
- GraphSAST y la línea de base se miden con la misma regla.

## Decisiones para el autor

- [ ] ¿`eval` se cuenta dentro de CWE-78? NodeGoat lo clasifica como inyección de JavaScript (CWE-95), pero el catálogo lo tiene entre los destinos de CWE-78.
- [x] NG-05 y NG-06 quedan (decisión del autor, 24/09). Su destino real es la plantilla HTML, que el analizador no procesa, así que mantenerlas mide esa limitación.
- [ ] ¿Se agrega algún otro caso documentado que falte?

Con estas decisiones tomadas se corren GraphSAST y la línea de base, y los resultados completan las tablas del capítulo 7.
