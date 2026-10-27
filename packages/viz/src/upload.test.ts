import { describe, it, expect } from "vitest";
import { describeSelection, gitignoreFilter, normalizeUploadPath, selectUploads } from "./upload.js";
import type { UploadedFile } from "./protocol.js";

/** Solo importa el tamaño: el contenido se lee recién en el worker. */
function upload(path: string, size = 10): UploadedFile {
  return { path, file: { size } as File };
}

describe("selectUploads", () => {
  it("deja solo JS/TS fuera de las carpetas excluidas, ordenado por ruta", () => {
    const selection = selectUploads([
      upload("app/src/server.ts"),
      upload("app/node_modules/express/index.js"),
      upload("app/dist/bundle.js"),
      upload("app/README.md"),
      upload("app/src/view.tsx"),
      upload("app/lib/util.mjs"),
    ]);
    expect(selection.accepted.map((u) => u.path)).toEqual([
      "app/lib/util.mjs",
      "app/src/server.ts",
      "app/src/view.tsx",
    ]);
    expect(selection.ignored).toBe(2);
    expect(selection.otherLanguage).toBe(1);
    expect(selection.tooLarge).toBe(0);
  });

  it("deja afuera las bibliotecas minificadas, con su propio conteo", () => {
    const selection = selectUploads([
      upload("public/js/jquery-3.2.1-min.js"),
      upload("public/js/bootstrap.min.js"),
      upload("public/js/bootstrap.js"),
      upload("public/js/app.js"),
    ]);
    expect(selection.accepted.map((u) => u.path)).toEqual(["public/js/app.js"]);
    expect(selection.minified).toBe(3);
    expect(describeSelection(selection)).toContain("3 minificados (bibliotecas de terceros)");
  });

  it("descarta archivos de más de 1 MB, como el CLI", () => {
    const selection = selectUploads([upload("a.ts", 1_000_000), upload("b.ts", 1_000_001)]);
    expect(selection.accepted.map((u) => u.path)).toEqual(["a.ts"]);
    expect(selection.tooLarge).toBe(1);
  });

  it("una carpeta excluida solo cuenta como carpeta, no como nombre de archivo", () => {
    const selection = selectUploads([upload("src/build.ts"), upload("build/out.ts")]);
    expect(selection.accepted.map((u) => u.path)).toEqual(["src/build.ts"]);
    expect(selection.ignored).toBe(1);
  });

  it("no repite un archivo que llega dos veces", () => {
    const selection = selectUploads([upload("/app/a.ts"), upload("app/a.ts")]);
    expect(selection.accepted).toHaveLength(1);
  });
});

describe("normalizeUploadPath", () => {
  it("usa / y quita el prefijo de raíz", () => {
    expect(normalizeUploadPath("/proj/src/a.ts")).toBe("proj/src/a.ts");
    expect(normalizeUploadPath("./a.ts")).toBe("a.ts");
    expect(normalizeUploadPath("proj\\src\\a.ts")).toBe("proj/src/a.ts");
  });
});

describe("describeSelection", () => {
  it("dice cuántos se analizan y por qué quedaron afuera los demás", () => {
    const text = describeSelection(
      selectUploads([
        upload("a.ts"),
        upload("node_modules/x.js"),
        upload("logo.png"),
        upload("big.ts", 2_000_000),
      ]),
    );
    expect(text).toBe(
      "1 archivo de código para analizar · 1 en node_modules u otras "
      + "carpetas excluidas · 1 de otros tipos · 1 demasiado grande (más de 1 MB)",
    );
  });
});

/** Archivo con contenido legible, como los .gitignore que se leen antes de seleccionar. */
function withText(path: string, text: string): UploadedFile {
  return { path, file: { size: text.length, text: async () => text } as File };
}

describe("tsconfig y .gitignore del proyecto", () => {
  it("los tsconfig/jsconfig van aparte: aportan alias, no se cuentan como archivos", () => {
    const selection = selectUploads([
      upload("app/tsconfig.json"),
      upload("app/packages/web/jsconfig.json"),
      upload("app/package.json"),
      upload("app/src/a.ts"),
    ]);
    expect(selection.accepted.map((u) => u.path)).toEqual(["app/src/a.ts"]);
    expect(selection.configs.map((u) => u.path)).toEqual(["app/tsconfig.json", "app/packages/web/jsconfig.json"]);
    expect(selection.otherLanguage).toBe(1);
  });

  it("un .gitignore excluye lo que ignora, desde su carpeta", async () => {
    const files = [
      withText("app/.gitignore", "generated/\n*.gen.ts\n"),
      withText("app/legacy/.gitignore", "old.js\n"),
      upload("app/src/a.ts"),
      upload("app/src/b.gen.ts"),
      upload("app/generated/client.ts"),
      upload("app/legacy/old.js"),
      upload("app/old.js"),
    ];
    const selection = selectUploads(files, await gitignoreFilter(files));
    expect(selection.accepted.map((u) => u.path)).toEqual(["app/old.js", "app/src/a.ts"]);
    expect(selection.gitignored).toBe(3);
    expect(describeSelection(selection)).toContain("3 excluidos por .gitignore");
  });

  it("un .graphsastignore excluye del análisis, con su propio conteo", async () => {
    const files = [
      withText("repo/.gitignore", "*.log.js\n"),
      withText("repo/.graphsastignore", "docs/casos/\n*.test.ts\n"),
      upload("repo/src/a.ts"),
      upload("repo/src/a.test.ts"),
      upload("repo/docs/casos/vulnerable.js"),
      upload("repo/src/debug.log.js"),
    ];
    const selection = selectUploads(
      files,
      await gitignoreFilter(files),
      await gitignoreFilter(files, ".graphsastignore"),
    );
    expect(selection.accepted.map((u) => u.path)).toEqual(["repo/src/a.ts"]);
    expect(selection.gitignored).toBe(1);
    expect(selection.graphsastIgnored).toBe(2);
    expect(describeSelection(selection)).toContain("2 excluidos por .graphsastignore");
  });

  it("sin .gitignore no se excluye nada", async () => {
    const files = [upload("app/src/a.ts")];
    expect(selectUploads(files, await gitignoreFilter(files)).gitignored).toBe(0);
  });
});
