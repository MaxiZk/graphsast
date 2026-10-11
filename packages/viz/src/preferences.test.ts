import { describe, it, expect } from "vitest";
import {
  DEFAULT_NODE_LIMIT,
  graphPalette,
  nodeLimitValue,
  resolveNodeLimit,
  resolveTheme,
  shortcutFor,
  stepIndex,
} from "./preferences.js";

describe("tema", () => {
  it("usa el guardado si es válido y si no, el del sistema", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme(null, true)).toBe("light");
    expect(resolveTheme("rosa", false)).toBe("dark");
  });

  it("cada tema tiene su fondo para el grafo y el PNG", () => {
    expect(graphPalette("light").background).not.toBe(graphPalette("dark").background);
  });
});

describe("límite de nodos", () => {
  it("acepta solo las opciones del selector", () => {
    expect(resolveNodeLimit("500")).toBe(500);
    expect(resolveNodeLimit("all")).toBe(Number.POSITIVE_INFINITY);
    expect(resolveNodeLimit("37")).toBe(DEFAULT_NODE_LIMIT);
    expect(resolveNodeLimit(null)).toBe(DEFAULT_NODE_LIMIT);
  });

  it("ida y vuelta con el valor del selector", () => {
    for (const v of ["100", "250", "1000", "all"]) expect(nodeLimitValue(resolveNodeLimit(v))).toBe(v);
  });
});

describe("atajos de teclado", () => {
  it("una tecla sola, fuera de un campo de texto", () => {
    expect(shortcutFor({ key: "n" })).toBe("next-finding");
    expect(shortcutFor({ key: "p", targetTag: "BUTTON" })).toBe("prev-finding");
    expect(shortcutFor({ key: "/" })).toBe("search");
    expect(shortcutFor({ key: "x" })).toBeNull();
  });

  it("nunca mientras se escribe ni con modificadores", () => {
    expect(shortcutFor({ key: "n", targetTag: "TEXTAREA" })).toBeNull();
    expect(shortcutFor({ key: "f", targetTag: "INPUT" })).toBeNull();
    expect(shortcutFor({ key: "t", targetTag: "SELECT" })).toBeNull();
    expect(shortcutFor({ key: "h", targetEditable: true })).toBeNull();
    expect(shortcutFor({ key: "f", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: "n", metaKey: true })).toBeNull();
  });
});

describe("stepIndex", () => {
  it("avanza y retrocede con vuelta", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
  });

  it("sin selección arranca por el extremo; sin elementos, -1", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});
