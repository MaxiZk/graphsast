---
fecha: 2026-09-24
rama: claude/proyecto-capitulos-7-8-022ae5
estado: pusheada, PR pendiente
tags: [tesis, entrega-7, entrega-8, validacion]
---

# Capítulos 7 y 8 y template LaTeX

Resumen de lo hecho en la sesión del 24/09/2026, en la rama `claude/proyecto-capitulos-7-8-022ae5`.

Contexto general del proyecto: [[GraphSAST_Proyecto]] · [[README]]

## Fechas que vienen

| Fecha | Qué |
|---|---|
| 30/09 | Cierre de respuestas a la convocatoria de H3 |
| **01/10** | Mínimo 5 participantes confirmados (riesgo R-06) |
| 02 o 03/10 | Sesión piloto de H3 |
| 05 al 09/10 | Sesiones de validación con usuarios |
| **06/10** | NodeGoat etiquetado (riesgo R-02) |
| **13/10** | Entrega 7 (capítulo 7) y cierre del alcance del motor |
| **20/10** | Entrega 8 (capítulo 8) |
| 27/10 | Documento integrado en un solo PDF |
| 03/11 | Sistema congelado, repo etiquetado, video de la demo |
| 10/11 | Ensayo de la defensa |
| **17/11** | Entrega final: documento, sistema y presentación |

## Qué se hizo

### 1. Consigna de la cátedra
- Se leyeron `_260908_formato documento y entregables.pdf` y `260915_Clase 12 Capitulo presentacion y resultados.pdf`.
- La cátedra entrega un **template LaTeX** (`github.com/Noorman999/usal-proyecto-final-template`) y la tesis estaba en `.docx`. Se decidió pasar todo al template.

### 2. Documento en LaTeX (`docs/tesis/`)
- **Capítulos 1 a 6** migrados desde `GraphSAST.docx` sin cambiar el texto: 22 tablas, 9 figuras, fórmulas, citas en APA y referencias cruzadas automáticas.
- **Capítulo 7, presentación de resultados**:
  - 11 requerimientos funcionales y 7 no funcionales con criterio medible
  - proceso de desarrollo con las fechas reales de cada etapa
  - 247 pruebas automatizadas agrupadas por etapa
  - banco sintético: composición por familia y matriz de confusión (29 TP, 0 FP, 14 TN, 0 FN)
  - advisories de npm y resultados desfavorables
  - lugares reservados para NodeGoat, la línea de base y las sesiones con usuarios
- **Capítulo 8**: esqueleto con las secciones que pide la cátedra.
- **Preliminares**: resumen, abstract (traducción), borrador de la declaración de IA, glosario, siglas y símbolos.
- **Apéndices**: A (encuesta de validación, armado con el protocolo de H3) y C (versiones, comandos para reproducir, variables de entorno). Anexo I con los repositorios.
- **Formato**:
  - portada sin decano ni director, con fondo de GraphSAST (red de nodos y camino source → sink)
  - guías de la cátedra ocultas
  - sin páginas en blanco entre capítulos
- PDF compilado: `docs/tesis/main.pdf` (93 páginas).

### 3. Validación de H3 (`docs/validacion/h3/`)
- [[protocolo]]: estudio de 20 minutos, cada participante resuelve un caso con el reporte de texto y otro con el grafo. Incluye preguntas, clave de corrección, criterio de lectura, entrevista a un experto, contingencia y mensaje de convocatoria.
- `caso-a/` (inyección SQL) y `caso-b/` (inyección de comandos): dos archivos cada uno, un camino vulnerable y un endpoint saneado. Verificados con el CLI.
- `reportes/`: salida de texto que se entrega en la condición sin grafo.
- `registro.csv`: planilla para anotar los resultados.

### 4. Commits en la rama
- `4507014` docs(validacion): protocolo y materiales para validar H3 con usuarios
- `23bfab7` docs(tesis): documento en el template LaTeX de la cátedra, capítulos 1 a 8

## Pendientes

### Urgente (esta semana)
- [ ] Mandar la convocatoria de H3 (el mensaje está en [[protocolo]])
- [ ] Conseguir un experto en seguridad para la entrevista
- [ ] Probar la carga de `caso-a` y `caso-b` en https://graph-sast.vercel.app/
- [ ] Abrir el PR: terminar `gk auth login` o usar https://github.com/MaxiZk/graphsast/compare/main...claude/proyecto-capitulos-7-8-022ae5?expand=1

### Antes del 13/10
- [ ] Etiquetar las vulnerabilidades de NodeGoat **antes** de correr el analizador
- [ ] Implementar la línea de base por patrones (la necesitan H1 y H2)
- [ ] Funciones flecha y callbacks de Express entre archivos (R-01)
- [ ] Calificar `exec` por el módulo `child_process` (R-04)
- [ ] Agregar la licencia MIT al repo (R-10)
- [ ] Revisar las alertas de Dependabot (R-05)

### Decisiones y textos que son míos
- [ ] Escribir los agradecimientos
- [ ] Revisar y confirmar la declaración de uso de IA; indicar la carpeta de prompts
- [ ] Declarar el uso de IA también en el capítulo 2 (metodología)
- [ ] Confirmar el título nuevo (18 palabras)
- [ ] Confirmar los umbrales de RNF-03 a RNF-06
- [ ] Revisar la traducción del abstract
- [ ] Completar las fechas de consulta de las fuentes web de los capítulos 5 y 6

### Inconsistencias encontradas
- [ ] La tabla de tecnologías del capítulo 4 dice TypeScript 5.5, Cytoscape 3.30 y Vitest 2.0; las instaladas son 5.9.3, 3.34.0 y 2.1.9
- [ ] El banco sintético etiqueta los 4 casos de Mongoose como CWE-20; el catálogo los clasifica como CWE-943

## Cómo compilar la tesis

Desde `docs/tesis`:

```bash
podman run --rm -v "$PWD":/work:Z -w /work docker.io/texlive/texlive:latest latexmk main.tex
```

Para cambiar el fondo de la portada: editar `figuras/portada/generar.py`, correrlo y volver a compilar.
