import { describe, it, expect } from "vitest";
import { loadSource } from "./parser.js";

describe("loadSource", () => {
  it("crea un SourceFile con el nombre de archivo dado", () => {
    const sf = loadSource("const x = 1;", "demo.ts");
    expect(sf.getBaseName()).toBe("demo.ts");
  });

  it("parsea declaraciones reconocibles por la API de ts-morph", () => {
    const sf = loadSource("function f() {}", "demo.ts");
    expect(sf.getFunctions()).toHaveLength(1);
  });
});
