import { describe, it, expect } from "vitest";
import { describeNoFinding } from "./labels.js";

describe("describeNoFinding", () => {
  it("concuerda en singular", () => {
    expect(describeNoFinding(1, 1)).toBe(
      "Ningún dato llega de 1 entrada del usuario a 1 operación peligrosa sin pasar por "
        + "un filtro.",
    );
  });

  it("concuerda en plural", () => {
    expect(describeNoFinding(2, 3)).toBe(
      "Ningún dato llega de 2 entradas del usuario a 3 operaciones peligrosas sin pasar "
        + "por un filtro.",
    );
  });

  it("sin cobertura, no afirma que el código sea seguro", () => {
    expect(describeNoFinding(1, 0)).toBe(
      "No hay camino que describir: el código tiene 1 entrada del usuario y "
        + "0 operaciones peligrosas.",
    );
  });
});
