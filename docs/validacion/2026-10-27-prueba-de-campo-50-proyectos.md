# Prueba de campo: 50 proyectos de GitHub en la versión web

Fecha: 27/10/2026. Versión: `main` en `a18094c` (PR #48) más los cambios de esta rama.

## Objetivo

Comprobar que la versión web funciona sobre proyectos reales de terceros, de distintos tamaños y
en los seis lenguajes: que el análisis termina, cuánto tarda y que da lo mismo que la línea de
comandos. No es una medición de precisión: los hallazgos de los proyectos que no son vulnerables
a propósito no se revisaron uno por uno. Tampoco reemplaza la validación con usuarios (H3): no mide
si una persona entiende lo que la página muestra.

## Método

- **Proyectos.** 52 repositorios públicos de GitHub elegidos antes de correr el analizador; dos no
  existían y quedaron 50:
  - 20 de JavaScript/TypeScript, 8 de Python, 7 de Java, 7 de PHP y 8 de Go;
  - 18 son vulnerables a propósito (DVWA, WebGoat, NodeGoat, vulpy...) y 32 son aplicaciones,
    plantillas o bibliotecas comunes (Laravel, Spring PetClinic, Express, Gitea, Bagisto...).
- **Clonado.** Cada uno con `git clone --depth 1`, en el commit que figura en la tabla.
- **CLI.** `graphsast scan <carpeta> --format json`, con el modelo de origen por defecto.
- **Web.** La compilación de producción servida en local (`vite preview`) y abierta con Playwright
  (Chromium sin interfaz). Cada carpeta se carga con «Analizar carpeta» y se leen de la página el
  estado, las métricas y los errores de la consola.
- **Conteo.** «Destinos marcados» cuenta lugares distintos del código (archivo, línea y familia),
  no caminos: un mismo destino alcanzado desde varias entradas cuenta una vez.

## Resumen

| Lenguaje | Proyectos | Archivos | Destinos marcados | Proyectos sin hallazgos | No analizados | Máximo CLI | Máximo web |
|---|---|---|---|---|---|---|---|
| JavaScript/TypeScript | 20 | 1.668 | 341 | 2 | 0 | 7,5 s | 8,2 s |
| Python | 8 | 392 | 49 | 1 | 0 | 5,2 s | 6,4 s |
| Java | 7 | 1.097 | 159 | 2 | 0 | 115,0 s | 137,4 s |
| PHP | 7 | 15.110 | 217 | 1 | 0 | 37,8 s | 48,7 s |
| Go | 8 | 3.743 | 401 | 1 | 44 | 33,4 s | 34,9 s |
| **Total** | **50** | **22.010** | **1.167** | **7** | **44** | | |

- **Web = CLI.** En los 50 proyectos la página informó la misma cantidad de archivos y de hallazgos
  que la línea de comandos, y la consola del navegador no registró errores.
- **Tiempos.** Mediana: 0,8 s en la CLI y 1,5 s en la web. El más lento es WebGoat, con 581 archivos:
  115 s en la CLI y 137 s en la web.
- **Proyectos vulnerables a propósito.** Los 18 marcaron al menos un destino.
- **Proyectos sin hallazgos.** Los 7 son proyectos comunes: Spring PetClinic, el realworld de Spring
  y de Flask, Laravel, los ejemplos de gin, el starter de NestJS y un tutorial de Express.
- **No analizados.** Los 44 archivos son de Gitea y usan `new(expresión)`, una sintaxis de Go 1.26
  que la gramática de tree-sitter del proyecto no reconoce. Se informan como no analizados, no como
  limpios.

## Problemas que encontró la prueba y su corrección

La primera pasada se hizo con `main` en `1659bb3`. Los cambios entraron en los PR #47 y #48 y en
esta rama.

| Problema | Ejemplo | Antes | Después |
|---|---|---|---|
| El enlace entre archivos se aplicaba también a Python, Java, PHP y Go y unía miles de archivos en un grafo | Bagisto (3.365 archivos), Snipe-IT, Gitea | más de 10 min | 38 s, 25 s, 33 s |
| Los archivos JS de un proyecto mixto se analizaban con las reglas del otro lenguaje | dvpwa, WebGoat | JS sin analizar bien | cada archivo con sus reglas |
| `.yarn/` (plugins empaquetados de Yarn) se analizaba | kriasoft/node-starter-kit | 186 s | 0,9 s |
| La versión legible de una biblioteca junto a su `.min.js` | dvpwa (`materialize.js`), govwa (`bootstrap.js`) | 105 hallazgos de ruido | se saltea |
| Consultas de TypeORM tomadas como MongoDB | nestjs-realworld, express-typescript-boilerplate | 174 y 56 hallazgos | 1 y 20 |
| Vistas de Flask que responden JSON tomadas como HTML | microblog, flask-realworld | 37 y 26 | 2 y 0 |
| `Where` de Go con un constructor de condiciones (xorm) | Gitea, golang-gin-realworld | 556 y 12 destinos | 363 y 5 |
| Entradas de `http.server` sin reconocer | DSVW | 0 destinos (falso negativo) | 7 destinos reales |

## Resultados por proyecto

| Proyecto | Lenguaje | Commit | Archivos | Destinos marcados | No analizados | CLI | Web | Web = CLI |
|---|---|---|---|---|---|---|---|---|
| gothinkster/node-express-realworld-example-app | JS/TS | `30b68e1` | 39 | 1 | 0 | 0,8 s | 1,3 s | sí |
| hagopj13/node-express-boilerplate | JS/TS | `179ae84` | 50 | 12 | 0 | 1,2 s | 1,8 s | sí |
| sahat/hackathon-starter | JS/TS | `8de0de7` | 56 | 4 | 0 | 4,8 s | 5,7 s | sí |
| appsecco/dvna | JS/TS | `9ba473a` | 12 | 4 | 0 | 0,6 s | 1,4 s | sí |
| snoopysecurity/dvws-node | JS/TS | `35f9995` | 70 | 59 | 0 | 1,8 s | 2,6 s | sí |
| cr0hn/vulnerable-node | JS/TS | `d68f2a3` | 40 | 19 | 0 | 0,9 s | 1,5 s | sí |
| OWASP/NodeGoat | JS/TS | `c5cb68a` | 44 | 9 | 0 | 0,9 s | 1,5 s | sí |
| bradtraversy/devconnector_2.0 | JS/TS | `0da5372` | 56 | 10 | 0 | 0,9 s | 1,5 s | sí |
| bezkoder/nodejs-express-mysql | JS/TS | `68d3959` | 6 | 5 | 0 | 0,6 s | 1,1 s | sí |
| bezkoder/node-js-jwt-auth-mongodb | JS/TS | `90a2d72` | 13 | 6 | 0 | 0,6 s | 1,2 s | sí |
| madhums/node-express-mongoose-demo | JS/TS | `8a134ab` | 28 | 5 | 0 | 0,7 s | 1,2 s | sí |
| danielfsousa/express-rest-boilerplate | JS/TS | `b8bed6d` | 25 | 5 | 0 | 1,0 s | 1,6 s | sí |
| w3tecch/express-typescript-boilerplate | JS/TS | `1772701` | 80 | 5 | 0 | 0,9 s | 1,6 s | sí |
| santiq/bulletproof-nodejs | JS/TS | `7ce1b46` | 29 | 3 | 0 | 0,7 s | 1,2 s | sí |
| lujakob/nestjs-realworld-example-app | JS/TS | `c1c2cc4` | 36 | 1 | 0 | 0,7 s | 1,4 s | sí |
| expressjs/express | JS/TS | `1c6f1b0` | 142 | 186 | 0 | 6,7 s | 6,8 s | sí |
| nestjs/typescript-starter | JS/TS | `0b6d712` | 8 | 0 | 0 | 0,5 s | 1,1 s | sí |
| academind/node-restful-api-tutorial | JS/TS | `e00ce89` | 2 | 0 | 0 | 0,5 s | 1,0 s | sí |
| kriasoft/node-starter-kit | JS/TS | `b3fd3ec` | 61 | 1 | 0 | 0,9 s | 1,6 s | sí |
| payloadcms/website | JS/TS | `e3ab041` | 871 | 6 | 0 | 7,5 s | 8,2 s | sí |
| fportantier/vulpy | Python | `5249cc8` | 61 | 6 | 0 | 0,7 s | 1,4 s | sí |
| we45/Vulnerable-Flask-App | Python | `b6a4f97` | 4 | 12 | 0 | 5,2 s | 6,4 s | sí |
| miguelgrinberg/microblog | Python | `a975ef6` | 34 | 2 | 0 | 0,6 s | 1,3 s | sí |
| gothinkster/flask-realworld-example-app | Python | `4b95fb2` | 30 | 0 | 0 | 0,6 s | 1,2 s | sí |
| tiangolo/full-stack-fastapi-template | Python | `f4bcfab` | 152 | 4 | 0 | 1,7 s | 2,5 s | sí |
| pallets/flask | Python | `d086db8` | 83 | 17 | 0 | 1,1 s | 1,9 s | sí |
| anxolerd/dvpwa | Python | `a1d8f89` | 22 | 1 | 0 | 0,6 s | 1,2 s | sí |
| stamparm/DSVW | Python | `9ca3c9a` | 6 | 7 | 0 | 0,6 s | 1,3 s | sí |
| WebGoat/WebGoat | Java | `e7b1313` | 581 | 73 | 0 | 115,0 s | 137,4 s | sí |
| spring-projects/spring-petclinic | Java | `500158f` | 50 | 0 | 0 | 0,6 s | 1,3 s | sí |
| gothinkster/spring-boot-realworld-example-app | Java | `ee17e31` | 116 | 0 | 0 | 0,8 s | 1,5 s | sí |
| CSPF-Founder/JavaVulnerableLab | Java | `626a106` | 19 | 12 | 0 | 0,6 s | 1,2 s | sí |
| DataDog/vulnerable-java-application | Java | `e5c6c7a` | 18 | 1 | 0 | 0,5 s | 1,2 s | sí |
| in28minutes/spring-boot-examples | Java | `6e869c9` | 233 | 1 | 0 | 1,0 s | 1,9 s | sí |
| JoyChou93/java-sec-code | Java | `4711f4e` | 80 | 72 | 0 | 0,7 s | 1,4 s | sí |
| digininja/DVWA | PHP | `a1978a2` | 179 | 55 | 0 | 1,2 s | 2,1 s | sí |
| s4n7h0/xvwa | PHP | `fb30fa5` | 54 | 40 | 0 | 5,1 s | 6,7 s | sí |
| OWASP/Vulnerable-Web-Application | PHP | `c0f2689` | 28 | 33 | 0 | 0,6 s | 1,1 s | sí |
| laravel/laravel | PHP | `9ffef3b` | 29 | 0 | 0 | 0,6 s | 1,2 s | sí |
| koel/koel | PHP | `73214bd` | 2356 | 50 | 0 | 11,9 s | 15,8 s | sí |
| bagisto/bagisto | PHP | `7e4b38a` | 3365 | 18 | 0 | 37,8 s | 48,7 s | sí |
| snipe/snipe-it | PHP | `845ffe8` | 9099 | 21 | 0 | 25,3 s | 33,5 s | sí |
| 0c34/govwa | Go | `4058f79` | 20 | 7 | 0 | 0,6 s | 1,2 s | sí |
| Contrast-Security-OSS/go-test-bench | Go | `9244570` | 129 | 13 | 0 | 0,9 s | 1,7 s | sí |
| gothinkster/golang-gin-realworld-example-app | Go | `626c372` | 19 | 5 | 0 | 0,7 s | 1,3 s | sí |
| gin-gonic/examples | Go | `439005e` | 58 | 0 | 0 | 0,7 s | 1,4 s | sí |
| sqreen/go-dvwa | Go | `822f4bf` | 44 | 4 | 0 | 1,8 s | 2,7 s | sí |
| go-gitea/gitea | Go | `9e27bce` | 3432 | 363 | 44 | 33,4 s | 34,9 s | sí |
| traefik/whoami | Go | `1ce75d0` | 5 | 2 | 0 | 0,5 s | 1,1 s | sí |
| eddycjy/go-gin-example | Go | `4f5174c` | 36 | 7 | 0 | 0,6 s | 1,8 s | sí |

## Límites

- **Sin revisión manual en los proyectos comunes.** No se revisaron uno por uno los destinos
  marcados de los 32 proyectos comunes; no hay una cifra de precisión para ellos. Con el modelo de
  origen por defecto, en una biblioteca (Express, Flask) o en código interno (las migraciones de
  Gitea) cada parámetro de función cuenta como entrada, y eso explica la mayor parte de lo marcado.
  El modelo «Solo entradas web conocidas» de la web está pensado para ese caso.
- **Bibliotecas empaquetadas sin `.min` en el nombre.** El cargador de Google Charts en
  we45/Vulnerable-Flask-App (`loader.js`) o `chart.js` en Bagisto se analizan como código propio.
- **Sintaxis nueva de Go.** `new(expresión)` de Go 1.26 queda como archivo no analizado.
- **Importación por URL sin probar.** La red del entorno no alcanza la API de GitHub, así que los
  proyectos se cargaron como carpeta, que es la otra forma de carga de la página.
