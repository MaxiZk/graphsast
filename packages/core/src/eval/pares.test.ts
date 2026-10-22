import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanSource } from "../scan/scan-files.js";

/**
 * Pares vulnerable/corregido de docs/validacion/pares: el vulnerable da un
 * hallazgo de su familia y el corregido ninguno, analizando cada archivo
 * solo, como en la versión web.
 *
 * Los archivos llevan `.txt` al final (`vulnerable.py.txt`) para que el
 * análisis de código de GitHub no tome como propio código vulnerable a
 * propósito; se analizan con su nombre real (`vulnerable.py`).
 */

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs/validacion/pares");

interface Pair {
  conjunto: string;
  nombre: string;
  cwe: number;
}

const { pares } = JSON.parse(readFileSync(path.join(DIR, "pares.json"), "utf8")) as { pares: Pair[] };

function fileOf(pair: Pair, kind: "vulnerable" | "seguro"): string {
  const dir = path.join(DIR, pair.conjunto, pair.nombre);
  const name = readdirSync(dir).find((f) => f.startsWith(`${kind}.`) && f.endsWith(".txt"));
  if (!name) throw new Error(`Falta ${kind} en ${dir}`);
  return path.join(dir, name);
}

const cwesOf = (file: string) => {
  const result = scanSource(readFileSync(file, "utf8"), path.basename(file, ".txt"));
  if (result.error) throw new Error(`${file}: ${result.error}`);
  return result.findings.map((f) => f.cwe);
};

describe("pares vulnerable/corregido", () => {
  it.each(pares.map((p) => [`${p.conjunto}/${p.nombre}`, p] as const))("%s", (_, pair) => {
    expect(cwesOf(fileOf(pair, "vulnerable"))).toContain(pair.cwe);
    expect(cwesOf(fileOf(pair, "seguro"))).toEqual([]);
  });
});
