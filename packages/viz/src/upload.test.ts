import { describe, it, expect } from "vitest";
import { describeSelection, normalizeUploadPath, selectUploads } from "./upload.js";
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
      "1 archivo JavaScript/TypeScript para analizar · 1 en node_modules u otras "
      + "carpetas excluidas · 1 de otros tipos · 1 demasiado grande (más de 1 MB)",
    );
  });
});
