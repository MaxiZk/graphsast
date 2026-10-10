# Cómo contribuir

## Preparar el entorno

```bash
npm ci
npm run build     # tsc -b
npm test          # core + viz
npm run benchmark # sale con 1 si algún caso se clasifica mal
```

Node 22 (el mismo que usa el CI). La arquitectura está resumida en
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Flujo de trabajo

- `main` tiene el check **Build, tests y benchmark** como obligatorio: los
  cambios entran por pull request, y el PR no se puede mergear hasta que el
  CI esté en verde. Eso incluye subir archivos desde la web de GitHub.
- Mensajes de commit con el formato `tipo(área): descripción`, en castellano
  (`feat(catalogo): ...`, `fix(web): ...`, `docs: ...`).
- **Dependabot**: si su PR queda desactualizado respecto de `main`, comentá
  `@dependabot rebase` en vez de mergear `main` a mano en su rama. Un merge
  manual de `package.json` y `package-lock.json` es la forma más fácil de
  dejar `main` sin instalar.

## Agregar un sink o un sanitizer

1. Editá la familia en `catalog/cwe-*.json`. Un sink puede ser un string
   (`"db.query"`, `".save"`) o un objeto con restricciones; el formato está en
   la sección «Formato del catálogo» del README y en `SinkSpec`
   (`packages/core/src/catalog/types.ts`).
2. Preferí la forma más acotada que siga detectando el caso real:
   - `args` si solo algunos argumentos son peligrosos (en SQL, el texto de la
     consulta: los valores ligados son la forma segura);
   - `bare` o el nombre calificado por paquete (`child_process.exec`) si el
     nombre suelto choca con otra API (`regex.exec`);
   - `receiver` si el nombre es genérico (`.find`).
3. Un sanitizer vale solo para su familia. Agregalo donde neutraliza el dato:
   `String(x)` protege una consulta de MongoDB, no una SQL. No agregues
   validadores de forma (zod, joi): un `z.string()` acepta una inyección.
4. Agregá un test en `packages/core/src/catalog/precision.test.ts` con el caso
   que debe detectarse **y** el que no (la API homónima, la forma segura).
5. Corré `npm test` y `npm run benchmark`: el benchmark no puede perder casos.

## Agregar una familia CWE

1. Creá `catalog/cwe-<n>-<nombre>.json` con `cwe`, `name`, `description`,
   `sources`, `sinks` y `sanitizers`.
2. Sumala a `catalog/index.json`.
3. Agregá casos al benchmark (abajo) y tests de precisión.

## Agregar un caso al benchmark

El corpus está en `packages/core/src/eval/benchmark/corpus.ts`. Cada caso es
un snippet con su etiqueta:

```ts
{
  id: "Z",
  title: "SQLi a través de un método de servicio",
  label: "vulnerable",        // o "safe"
  cwe: "CWE-89",
  tags: ["sqli", "inter"],
  code: `...`,
  minFindings: 1,             // opcional: cantidad esperada de hallazgos
  maxFindings: 1,
}
```

Un caso `safe` tiene que dar cero hallazgos. Agregá de a pares cuando se
pueda: la versión vulnerable y la misma con la corrección, que difieran en lo
mínimo. Si un caso nuevo falla, primero confirmá que la etiqueta es correcta;
si lo es, el caso documenta una limitación y conviene arreglar el motor antes
de mergearlo.

## Tests

- Tests unitarios junto al código (`*.test.ts`, vitest).
- `packages/core/src/cli/cli.e2e.test.ts` lanza el binario compilado sobre
  proyectos temporales; compila con `tsc -b` antes de empezar.
- La web: lógica en módulos sin DOM (`upload.ts`, `cytoscape.ts`,
  `project-view.ts`) con sus tests; lo que toca el DOM se verifica en el
  navegador.
- Nunca se saltea ni se desactiva un test para que el CI pase.
