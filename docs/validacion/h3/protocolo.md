# Protocolo de validación de H3: visualización frente a reporte de texto

**Fecha:** 2026-09-24
**Estado:** borrador para revisar antes de la convocatoria.
**Vínculo con la tesis:** hipótesis H3 (capítulo 1), riesgos R-06 y R-07 (capítulo 6),
resultados en el capítulo 7.

> H3: la visualización del recorrido de los datos facilita al desarrollador la
> comprensión del riesgo frente a un listado de errores en texto.

## Fechas de control

| Fecha | Hito | Riesgo |
|---|---|---|
| 30/09 | Cierre de respuestas a la convocatoria | R-06 |
| 01/10 | Participantes confirmados; con menos de cinco se aplica la contingencia | R-06 |
| 02/10 o 03/10 | Sesión piloto con una persona que no participa del estudio | R-06 |
| 05/10 al 09/10 | Sesiones | R-06 |
| 10/10 | Planilla completa y resultados calculados | Capítulo 7 |

## Diseño

**Tipo.** Estudio intra-sujeto: cada participante resuelve un caso con el reporte de
texto y otro con el grafo. Así cada persona funciona como su propio control, lo que
importa con una muestra de cinco a ocho personas.

**Dos casos equivalentes.** Si se usara el mismo caso en las dos condiciones, la segunda
resolución aprovecharía lo aprendido en la primera. Por eso hay dos casos con la misma
estructura y distinta debilidad:

| | Caso A | Caso B |
|---|---|---|
| Debilidad | CWE-89, inyección SQL | CWE-78, inyección de comandos |
| Archivos | `rutas.js`, `pedidos.js` | `rutas.js`, `sistema.js` |
| Líneas | 25 | 27 |
| Camino vulnerable | `listarPedidos` → `armarFiltro` → `buscarPedidos` | `exportarReporte` → `armarRuta` → `comprimirCarpeta` |
| Distractor saneado | `verCliente` con `sanitize` | `diagnostico` con `validate` |
| Hallazgos del CLI | 1 | 1 |

Los dos casos usan solo construcciones que el motor resuelve (funciones declaradas con
`function` e importaciones ES con ruta relativa), para que la comparación mida la forma
de presentar el resultado y no un límite del motor. Se verificaron con el CLI el
2026-09-24: cada uno produce exactamente un hallazgo y el camino saneado no se reporta.

**Orden contrabalanceado.** Cuatro órdenes que alternan condición y caso. El
participante número *i* recibe el orden ((*i* − 1) mod 4) + 1.

| Orden | Primera tarea | Segunda tarea |
|---|---|---|
| O1 | Texto, caso A | Grafo, caso B |
| O2 | Grafo, caso A | Texto, caso B |
| O3 | Texto, caso B | Grafo, caso A |
| O4 | Grafo, caso B | Texto, caso A |

**Materiales por condición.** En las dos condiciones el participante tiene el código
fuente del caso. Solo cambia la forma del resultado:

- *Texto:* los archivos del caso y la salida de `graphsast scan --verbose`
  (`reportes/caso-a.md`, `reportes/caso-b.md`).
- *Grafo:* los archivos del caso, que carga como carpeta en la versión web
  (https://graph-sast.vercel.app/).

## Perfil de participantes

- Escribe JavaScript o TypeScript con regularidad (trabajo, estudio avanzado o proyectos propios).
- No participó del desarrollo de GraphSAST ni vio los casos.
- Tiene una computadora con navegador actualizado y puede compartir pantalla.

Se registra, sin identificar a la persona: años de experiencia con JavaScript, si
trabaja en desarrollo y si usó alguna herramienta de análisis estático.

## Guion de la sesión (20 minutos)

| Minuto | Paso |
|---|---|
| 0 a 2 | Bienvenida y consentimiento verbal (texto abajo). Se asigna el número de participante y el orden. |
| 2 a 5 | Familiarización: con el ejemplo integrado de la web se explican *source*, *sink* y *sanitizer* en tres frases, y se muestra el mismo ejemplo como reporte de texto. No se usan los casos A ni B. |
| 5 a 11 | Primera tarea: se entregan los materiales de la primera condición, se inicia el cronómetro y se hacen las preguntas P1 a P4. Límite: 6 minutos. |
| 11 a 12 | Valoración de la primera condición (L1 y L2). |
| 12 a 18 | Segunda tarea, igual que la primera, con la otra condición y el otro caso. |
| 18 a 20 | Valoración de la segunda condición, preguntas finales y cierre. |

**Consentimiento (leer).** "La sesión dura veinte minutos. Vas a mirar dos fragmentos
de código con los resultados de una herramienta y responder cuatro preguntas sobre cada
uno. Se evalúa la herramienta, no a vos. Registro el tiempo y tus respuestas sin tu
nombre, y los resultados se usan solo en mi proyecto final. Podés dejar la sesión cuando
quieras. ¿Estás de acuerdo?"

**Reglas del facilitador.** Leer las preguntas tal como están escritas. No confirmar
ni corregir respuestas durante la tarea. Si el participante pregunta cómo usar la
interfaz, responder solo sobre controles ("ese botón carga la carpeta"), nunca sobre el
resultado. El cronómetro se detiene cuando termina de responder P4 o a los seis minutos.

## Preguntas de la tarea

Iguales para los dos casos; entre corchetes, los nombres que cambian.

- **P1.** ¿Qué dato ingresado por el usuario llega a la operación peligrosa?
- **P2.** ¿Por qué funciones pasa ese dato, en orden, hasta llegar a ella?
- **P3.** ¿El endpoint [`verCliente` / `diagnostico`] tiene la misma vulnerabilidad? ¿Por qué?
- **P4.** Si tuvieras que corregir la vulnerabilidad con un solo cambio, ¿en qué archivo y línea lo harías?

### Clave de corrección (no se muestra al participante)

Cada pregunta vale 1 punto; el acierto por tarea va de 0 a 4.

| | Caso A | Caso B |
|---|---|---|
| P1 | `req.query.estado` (acepta "el parámetro estado de la URL") | `req.body.carpeta` (acepta "el campo carpeta del body") |
| P2 | `listarPedidos` → `armarFiltro` → `buscarPedidos`, en ese orden | `exportarReporte` → `armarRuta` → `comprimirCarpeta`, en ese orden |
| P3 | No, porque el id pasa por `sanitize` antes de la consulta | No, porque el host pasa por `validate` antes del comando |
| P4 | Cualquier punto del camino vulnerable antes del sink: `rutas.js` líneas 4, 5 o 15, o `pedidos.js` línea 2 con consulta parametrizada | Cualquier punto del camino vulnerable antes del sink: `rutas.js` líneas 4, 5 o 15, o `sistema.js` línea 4 sin pasar la ruta por el shell |

P4 es incorrecta si el cambio propuesto está en el endpoint saneado o no corta el camino.

## Valoraciones

Escala de 1 (totalmente en desacuerdo) a 5 (totalmente de acuerdo), después de cada tarea:

- **L1.** Entendí por dónde viaja el dato desde la entrada hasta la operación peligrosa.
- **L2.** Tengo claro dónde aplicar la corrección.

Preguntas finales:

- **F1.** ¿Con cuál de las dos formas preferirías trabajar: texto, grafo o indistinto? ¿Por qué?
- **F2.** Una herramienta así, que corre en el navegador sin enviar tu código a un servidor,
  ¿la pagarías a USD 8 por mes? Sí / No / Solo con otras funciones (¿cuáles?). *(R-07)*
- **F3.** ¿Algo que te haya costado o que agregarías?

## Registro y análisis

La planilla `registro.csv` tiene una fila por participante y tarea. Los indicadores se
fijan antes de las sesiones para que la lectura no se ajuste a los resultados:

1. **Principal: acierto** (0 a 4) por condición.
2. **Secundario: tiempo** hasta responder P4, en segundos, por condición (6 minutos si
   se agota el límite).
3. **Complementario: valoraciones** L1 y L2, y la preferencia F1.

**Criterio de lectura.** Se considera que los datos respaldan H3 si, comparando las dos
tareas de cada participante, la mayoría obtiene en la condición de grafo un acierto
igual o mayor y, además, un tiempo menor o una valoración L1 mayor. Con cinco a ocho
personas los resultados se informan en forma descriptiva (medianas y conteo de
participantes a favor de cada condición) y como evidencia preliminar, sin prueba de
significación. Si hay ocho pares completos se puede agregar la prueba de rangos con
signo de Wilcoxon, aclarando su baja potencia.

**Amenazas a la validez que se declaran en el capítulo 7.**

- Muestra chica y por conveniencia, del entorno del autor.
- El autor es a la vez desarrollador y facilitador; se mitiga con el guion y las reglas de arriba.
- Los casos son chicos (dos archivos): no representan la lectura de un proyecto real.
- La condición de grafo incluye la carga de la carpeta, que consume parte del tiempo.
  El tiempo se toma desde que el resultado queda visible en pantalla.

## Entrevista a un experto

La guía de la cátedra para el capítulo 7 pide una validación "idealmente triangulada
(métricas técnicas, encuesta, entrevista)" y traducida a decisiones de diseño. Por eso
la entrevista forma parte del plan y no solo de la contingencia.

Se entrevista durante 20 minutos a un desarrollador con experiencia en seguridad de
aplicaciones, que no participa de las sesiones. Resuelve los dos casos con el mismo
guion y después responde:

- ¿Qué información del reporte de texto te faltó o te sobró?
- ¿Qué información del grafo te faltó o te sobró?
- ¿En qué momento de tu trabajo usarías cada formato?
- ¿Qué construcciones de código real esperarías que la herramienta no siga?
- Frente a Semgrep o CodeQL, ¿en qué situación elegirías esta herramienta y en cuál no?

Con su consentimiento se registran su formación, su cargo y su experiencia (apéndice B
del template: un apéndice por entrevista, con la transcripción organizada por temas).

## Contingencia (R-06)

Con menos de cinco participantes confirmados al 1/10, se hacen las sesiones con quienes
confirmaron, el resultado se declara preliminar y la entrevista al experto pasa a ser la
fuente principal de la validación cualitativa.

## Destino en el documento

| Material | Dónde va |
|---|---|
| Diseño, cuestionario y mensaje de convocatoria | Apéndice A, encuesta de validación |
| Transcripción de la entrevista | Apéndice B, entrevista |
| Resultados, lectura de H3 y amenazas a la validez | Capítulo 7 |
| Respuestas a F3 y a la entrevista, convertidas en decisiones | Tabla "Traducción de la retroalimentación en decisiones de diseño" del capítulo 7 |
| Respuesta a H3 y limitaciones | Capítulo 8 |

## Mensaje de convocatoria

> Hola, ¿cómo estás? Estoy terminando mi proyecto final de Ingeniería en Informática
> (USAL): una herramienta que analiza código JavaScript y muestra por dónde viaja un dato
> hasta un punto peligroso, como una consulta a la base de datos.
>
> Busco personas que programen en JavaScript o TypeScript para una sesión remota de
> 20 minutos, entre el lunes 5 y el viernes 9 de octubre. Vas a mirar dos fragmentos de
> código cortos con los resultados de la herramienta y responder unas preguntas. No hace
> falta saber de seguridad ni instalar nada: solo un navegador y compartir pantalla.
>
> ¿Te sumás? Si podés, respondeme antes del martes 30 con un par de horarios que te
> queden bien. ¡Gracias!

## Pendientes antes de convocar

- [ ] Revisar y ajustar las preguntas y el criterio de lectura.
- [ ] Probar la carga de las carpetas `caso-a` y `caso-b` en la versión publicada.
- [ ] Preparar un .zip por caso con solo los archivos `.js`, sin los reportes.
- [ ] Sesión piloto el 2 o 3 de octubre y ajuste de tiempos.
