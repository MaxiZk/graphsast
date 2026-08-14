# GraphSAST — Documento de contexto del proyecto

> Proyecto Final de Ingeniería en Informática — Universidad del Salvador (USAL)
> Autor: Maximo Zuidwijk · Cátedra: Ing. Esteban Tissera, MBA
> Documento de referencia para retomar el proyecto o pasarlo como contexto a otra herramienta de IA.
> Última actualización: junio 2026.

---

## 1. Resumen en una frase

GraphSAST es un analizador estático de código que representa el flujo de datos de un programa como un grafo y rastrea el recorrido de las entradas no confiables hasta los puntos críticos del sistema, para detectar vulnerabilidades **antes** de ejecutar la aplicación.

---

## 2. Qué es y qué problema resuelve

**El problema.** Muchas fallas de seguridad y de diseño no están en una línea suelta de código, sino en *cómo circula la información* dentro de una aplicación. Un dato puede entrar por un formulario, pasar por varias funciones y módulos, y terminar en un punto sensible (por ejemplo, una consulta a la base de datos) sin haber sido validado. Las herramientas que buscan patrones de texto o firmas conocidas ayudan, pero pueden generar falsos positivos y no muestran con claridad el recorrido completo del dato.

**La solución.** GraphSAST analiza el código de otra forma: lo convierte en un grafo de flujo de datos y sigue el camino de cada dato desde su origen hasta los puntos críticos, revisando si fue validado en el trayecto. Eso permite encontrar fallas de arquitectura —las que dependen de cómo se conectan las partes del programa— y no solo errores de una línea.

---

## 3. Conceptos clave (vocabulario del proyecto)

- **AST (árbol de sintaxis abstracta):** representación jerárquica del código que abstrae su estructura (funciones, asignaciones, llamadas) sin los detalles de escritura. Es el primer paso: un *parser* convierte el código fuente en AST.
- **Grafo de flujo de datos:** representación donde se ve cómo se propaga la información entre operaciones y variables. Es lo que permite seguir el rastro de un dato a través de funciones y módulos.
- **Análisis de taint (datos "manchados"):** el concepto central. Consiste en seguir los datos no confiables por el programa.
  - **Source:** punto por donde entra un dato no confiable (un formulario, una petición de red).
  - **Sink:** punto crítico donde ese dato podría causar daño (consulta a base de datos, ejecución de comando).
  - **Sanitizer:** función que valida o limpia el dato y le quita la marca de "manchado".
  - **Vulnerabilidad:** existe cuando un dato manchado llega de un *source* a un *sink* **sin pasar por un sanitizer**.
- **Seguridad como accesibilidad en un grafo:** detectar la vulnerabilidad se reduce a un problema clásico de grafos: averiguar si existe un camino entre el *source* y el *sink* que no atraviese un *sanitizer*.

Regla mnemotécnica: **Source** = de dónde entra · **Sink** = dónde hace daño · **Sanitizer** = dónde se limpia · **Taint analysis** = seguir el dato sospechoso de source a sink.

---

## 4. Alcance por etapas (decisión de diseño importante)

El proyecto se plantea **por etapas** para garantizar un entregable terminable y, a la vez, dejar planteada la ambición. Esta decisión surgió al validar la idea con un desarrollador (ver caso de uso real, sección 5).

### Alcance central (lo que sí o sí se entrega)
- Análisis del flujo de datos dentro de **un archivo o un conjunto acotado de archivos**.
- Representación del código como grafo (AST → grafo de flujo de datos).
- Detección del recorrido source → sink sin sanitizar.
- Visualización del grafo con el camino de riesgo resaltado.
- Métricas de evaluación (ver sección 8).

### Alcance ampliado (objetivo deseable, si el tiempo lo permite)
- Extender el análisis a **múltiples archivos** y seguir el flujo que cruza entre ellos (llamadas entre funciones de distintos módulos).

### Trabajo futuro (queda planteado para después de la tesis)
- Escaneo de una **base de código completa y grande**, con navegación del flujo de todo el proyecto.
- Análisis más profundo y optimizado para proyectos reales de gran tamaño.

> **Por qué por etapas:** rastrear el flujo de datos en una base de código completa es uno de los problemas más difíciles del análisis estático (resolver llamadas entre funciones en todo el proyecto, variables que cruzan archivos, tamaño del grafo). Las herramientas profesionales (CodeQL, Joern) lo hacen con equipos y años de trabajo. Apuntar directo a eso en una tesis de grado es arriesgado. El planteo por etapas protege el trabajo: se garantiza algo terminable y demostrable, y se muestra visión sin comprometer la entrega.

---

## 5. Caso de uso real (validación de la idea)

La necesidad del alcance ampliado surgió de una conversación con un desarrollador que describió un dolor concreto: en su trabajo tienen una aplicación con un "wiring" (conexionado interno) muy enredado, donde nunca saben hacia dónde va el flujo de datos. Una herramienta que escanee el proyecto y muestre ese flujo como un grafo resolvería ese problema. Este caso de uso real justifica la dirección del proyecto y sirve como ejemplo concreto para la defensa.

---

## 6. Stack tecnológico propuesto

- **Parser / generación de AST:** bibliotecas de análisis sintáctico para el lenguaje objetivo (JavaScript/TypeScript como lenguaje base).
- **Construcción del grafo:** lógica propia que traduce el AST a un grafo dirigido de flujo de datos.
- **Persistencia del grafo:** base de datos orientada a grafos (por ejemplo, Neo4j) para consultar caminos.
- **Motor de consultas:** consultas sobre el grafo para detectar caminos source → sink sin sanitizar.
- **Visualización:** aplicación web con una librería de grafos (por ejemplo, Cytoscape.js) que dibuja el grafo y resalta el camino de riesgo.

> Nota: el stack es una propuesta y puede ajustarse. La mayoría de las herramientas previstas son de código abierto.

---

## 7. Objetivos

**Objetivo general:** desarrollar un analizador estático que compile la lógica de una aplicación en un grafo de flujo de datos para detectar y visualizar vulnerabilidades de arquitectura y posibles fugas de información, y validarlo midiendo su precisión sobre casos reales.

**Objetivos específicos:**
1. Construir un parser que genere el AST de un lenguaje moderno.
2. Traducir el AST a un grafo dirigido de flujo de control y de datos.
3. Implementar el análisis de taint (sources, sinks, sanitizers) sobre el grafo.
4. Persistir el grafo para consultas.
5. Desarrollar la visualización interactiva del grafo con los caminos de riesgo.
6. Validar el motor sobre proyectos reales y casos con vulnerabilidades conocidas, midiendo precisión.

---

## 8. Hipótesis y validación

**Hipótesis:**
- **H1:** representar el código como grafo de flujo de datos permite detectar vulnerabilidades de arquitectura que el análisis por patrones de texto no identifica.
- **H2:** el análisis de taint sobre el grafo reduce los falsos positivos respecto de la detección por coincidencia de nombres o expresiones regulares.
- **H3:** la visualización del recorrido de los datos facilita al desarrollador la comprensión del riesgo frente a un listado de errores en texto.

**Validación:** banco de pruebas con (a) casos sintéticos con fallas conocidas y (b) proyectos reales de código abierto con vulnerabilidades documentadas.

**Métricas:** precisión, exhaustividad (recall), falsos positivos, falsos negativos y tiempo de análisis (por ejemplo, por cada 1.000 líneas de código).

---

## 9. Ángulo QA (motivación personal)

El tema se vincula con un **curso de QA Testing Junior que el autor está cursando** (formación laboral orientada al aseguramiento de la calidad del software).

> IMPORTANTE — precisión honesta: es un **curso que se está cursando**, NO un empleo. No debe describirse como "trabajo en QA". Si el curso se aprueba y va bien, existiría la posibilidad de un empleo, pero eso todavía no ocurrió.

**Complementariedad (argumento fuerte para la defensa):** el testing dinámico prueba el software *mientras se ejecuta* y busca errores de comportamiento; el análisis estático (GraphSAST) revisa el código *antes de ejecutarlo* y detecta riesgos en su estructura. Las dos miradas persiguen el mismo objetivo —software más confiable— en momentos distintos del ciclo de desarrollo. El proyecto integra QA, ciberseguridad e ingeniería de software.

---

## 10. Diferenciación y aporte académico

Existen herramientas profesionales que hacen análisis de flujo de datos para seguridad: **CodeQL, Semgrep, Joern**.

> IMPORTANTE — precisión honesta: el análisis de flujo de datos con grafos **no es un concepto inventado por este proyecto**; ya existe en esas herramientas. El aporte NO es reemplazarlas.

**El aporte académico es:**
- Construir un **prototipo propio** desde cero (parser, construcción del grafo, motor de consultas, visualización), con alcance definido.
- Ofrecer una **visualización clara** de los caminos de riesgo.
- **Medir** su funcionamiento con métricas objetivas sobre casos reales.

Si en la defensa preguntan "¿esto no lo hace ya CodeQL?", la respuesta es: sí, el concepto existe; el valor de la tesis está en implementarlo y validarlo de forma propia y demostrable, no en inventar la técnica.

---

## 11. Razonamiento de desarrollo paso a paso (roadmap sugerido)

Orden lógico para construirlo, alineado con el alcance por etapas:

1. **Parser → AST.** Elegir el lenguaje base y una librería de parsing. Lograr generar el AST de un archivo simple.
2. **AST → grafo.** Diseñar el algoritmo que recorre el AST y arma el grafo de flujo de datos (nodos = variables/operaciones, aristas = flujo). Empezar con casos chicos y controlados.
3. **Modelo de taint.** Definir qué se considera source, sink y sanitizer (empezar con un conjunto acotado y explícito). Implementar la búsqueda de caminos source → sink sin sanitizer sobre el grafo.
4. **Persistencia y consultas.** Guardar el grafo en la base orientada a grafos y escribir las consultas de detección.
5. **Visualización.** App web que dibuja el grafo y resalta el camino de riesgo. (Aquí encaja la idea de "pegar código y ver el grafo".)
6. **Validación.** Armar el banco de pruebas (casos sintéticos + proyectos reales con vulnerabilidades conocidas), correr el analizador y medir las métricas.
7. **(Ampliado) Multi-archivo.** Una vez sólido lo anterior, extender el seguimiento del flujo entre varios archivos.
8. **(Futuro) Base de código completa.** Escalar al escaneo de proyectos grandes.

Regla de trabajo: cerrar y validar cada etapa antes de pasar a la siguiente. Es preferible un alcance central terminado y demostrable que un alcance ambicioso a medio hacer.

---

## 12. Contexto académico y estado

- **Institución:** Universidad del Salvador (USAL), Facultad de Ingeniería, Ingeniería en Informática.
- **Cátedra:** Proyecto Final de Ingeniería en Informática 2026 — Prof. Ing. Esteban Tissera, MBA.
- **Estado:** propuesta aprobada por la cátedra; tema elegido: GraphSAST. Entregables (Entrega 0, Capítulo 1, Capítulo 2) redactados en borrador sobre el template oficial de la cátedra.
- **Pendientes del autor:** completar referencias bibliográficas (fuentes ya identificadas), costos (números reales), apéndices (se llenan a medida que avanza el desarrollo); leer y apropiarse del contenido para la defensa.

---

## 13. Notas de honestidad (para no cometer errores al usar este documento)

Estas aclaraciones son importantes si se usa este .md como contexto para generar más material:

1. **QA es un curso que se está cursando, no un empleo.** No afirmar que el autor "trabaja en QA".
2. **El concepto de análisis de flujo con grafos ya existe** (CodeQL, Semgrep, Joern). El aporte es el prototipo propio y su validación, no la invención de la técnica. No presentarlo como algo inédito.
3. **No inventar referencias, datos ni métricas.** Los números de validación se obtienen al ejecutar el sistema; las referencias deben ser fuentes reales consultadas.
4. **El material generado es andamiaje.** La cátedra pidió expresamente que el trabajo sea propio y no salida directa de IA: todo texto debe ser leído, entendido y reescrito con la voz del autor para poder defenderlo.

---

## 14. Pitch corto (referencia, ~95 palabras)

"Hola, soy Maximo Zuidwijk, estudiante de Ingeniería en Informática en la USAL. Estoy cursando QA Testing, donde se prueba el software mientras se ejecuta para encontrar errores. Pero muchas fallas de seguridad no están en una línea suelta, sino en cómo viajan los datos por el código, y eso el testing no siempre lo ve. Mi proyecto, GraphSAST, analiza el código antes de ejecutarlo: lo transforma en un grafo y sigue el recorrido de cada dato hasta los puntos críticos. Solo necesito proyectos reales para validarlo. El beneficio: detectar vulnerabilidades antes de que lleguen a producción."
