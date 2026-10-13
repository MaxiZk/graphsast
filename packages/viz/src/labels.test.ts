import { describe, it, expect } from "vitest";
import { describeNoFinding } from "./labels.js";

describe("describeNoFinding", () => {
  it("concuerda en singular", () => {
    expect(describeNoFinding(1, 1)).toBe(
      "Ningún dato llega de 1 entrada a 1 operación sensible sin pasar por "
        + "una función de saneamiento.",
    );
  });

  it("concuerda en plural", () => {
    expect(describeNoFinding(2, 3)).toBe(
      "Ningún dato llega de 2 entradas a 3 operaciones sensibles sin pasar "
        + "por una función de saneamiento.",
    );
  });

  it("sin cobertura, no afirma que el código sea seguro", () => {
    expect(describeNoFinding(1, 0)).toBe(
      "No hay camino que describir: el código tiene 1 entrada y "
        + "0 operaciones sensibles.",
    );
  });
});
