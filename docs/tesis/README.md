# Template — Proyecto Final de Ingeniería Informática (USAL)

Template LaTeX para el documento de Proyecto Final de la Facultad de
Ingeniería de la Universidad del Salvador. Sigue la estructura de ocho
capítulos de la cátedra, uno por entrega, y cada capítulo abre con una caja
que resume qué evalúa la cátedra.

## Cómo empezar

1. Crear el repo propio con **Use this template** (o clonar este).
2. Completar los datos al principio de `main.tex`: título, autor, correo,
   autoridades, ciclo lectivo y palabras clave.
3. Escribir cada capítulo en su archivo de `capitulos/`, reemplazando los
   marcadores entre corchetes.

## Compilar

Compilador: **pdfLaTeX** (LuaLaTeX también funciona, y es obligatorio con
`pdfa=true`). La bibliografía usa `biber` y el glosario `makeglossaries`;
`latexmk` corre todo solo.

```bash
git clone https://github.com/Noorman999/usal-proyecto-final-template.git mi-tesis
cd mi-tesis
latexmk main.tex
```

**En Overleaf**: subir la carpeta como `.zip` y elegir pdfLaTeX en el menú
(Menu → Compiler). El plan gratuito corta la compilación a los 20 segundos;
la primera vez puede quedarse corta, pero deja archivos en caché: apretar
*Recompile* de nuevo y termina. Las siguientes compilaciones tardan unos
segundos. Si se corta seguido, compilar localmente (TeX Live + VS Code con
LaTeX Workshop) no tiene límite.

## Estructura

| Archivo | Contenido |
|---|---|
| `main.tex` | Datos del trabajo y orden de los capítulos |
| `preliminares/` | Resumen, abstract, agradecimientos, declaración de IA, y las entradas del glosario, siglas y símbolos (se imprimen al final del documento) |
| `capitulos/01` a `08` | Introducción · Metodología y procedimientos · Síntesis de la literatura consultada · Marco tecnológico · Justificación económica · Análisis de riesgos · Presentación de resultados · Implicancias, conclusiones y recomendaciones |
| `refs.bib` | Bibliografía (estilo APA) |
| `apendices/` | Encuesta de validación, entrevista, detalles técnicos |
| `anexos/` | Repositorios de código |
| `figuras/` | Imágenes del trabajo |

## Cajas de guía y marcadores

```latex
\begin{guia} ... \end{guia}          % qué evalúa la cátedra
\begin{ejemplo} ... \end{ejemplo}    % ejemplo de estructura
\completar{texto}                    % marcador a reemplazar
```

Para la entrega final se ocultan todas las cajas con:

```latex
\documentclass[guias=false]{usal-proyecto-final}
```

Las cajas `nota`, `advertencia` y `resumenbox` son para el cuerpo del
trabajo y quedan en el documento final.

## Citas, glosario y siglas

```latex
\citep{clave}   % (Autor, año)
\citet{clave}   % Autor (año)
\gls{clave}     % término del glosario o sigla, con enlace
```

Las siglas se expanden completas la primera vez y luego se abrevian. Solo
se imprimen las entradas usadas en el texto.

## Portada

```latex
\coverlogo{template/usal}            % logo superior
\coverwatermark{template/archivo}    % marca de agua (vacío = sin marca)
```

El color principal del documento es `mainColor`, en la sección 3 de
`usal-proyecto-final.cls`.

## PDF/A

Con la opción de clase `pdfa=true` (y LuaLaTeX) el PDF sale en formato
PDF/A-2b. Compila más lento; activarlo solo si lo piden. Se puede validar
en <https://www.pdfforge.org/online/en/validate-pdfa>.
