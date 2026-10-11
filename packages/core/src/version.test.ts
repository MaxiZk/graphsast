import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./version.js";

const PACKAGE_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");

describe("VERSION", () => {
  it("coincide con la del paquete: el CLI, el SARIF y npm dicen lo mismo", () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).version);
  });
});
