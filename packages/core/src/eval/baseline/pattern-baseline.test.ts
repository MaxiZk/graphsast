import { describe, it, expect } from "vitest";
import { loadCatalogBundle } from "../../catalog/load.js";
import { baselineScan, isLiteralOnly, maskComments } from "./pattern-baseline.js";

const entries = loadCatalogBundle().entries;
const scan = (code: string) => baselineScan(code, entries);

describe("línea de base por patrones", () => {
  it("marca un sink con argumento no literal", () => {
    const f = scan(`function h(input) {\n  db.query(input);\n}`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ cwe: 89, sink: "db.query", line: 2 });
  });

  it("no marca un sink con argumento literal", () => {
    expect(scan(`db.query("SELECT 1");`)).toHaveLength(0);
    expect(scan(`db.query("SELECT " + "1");`)).toHaveLength(0);
  });

  it("marca aunque el dato pase por un saneamiento: no sigue el flujo", () => {
    const code = `function h(input) {\n  const safe = sanitize(input);\n  db.query(safe);\n}`;
    expect(scan(code)).toHaveLength(1);
  });

  it("marca una plantilla con interpolación y no una sin interpolación", () => {
    expect(scan("db.query(`SELECT * FROM t WHERE id = ${id}`);")).toHaveLength(1);
    expect(scan("db.query(`SELECT 1`);")).toHaveLength(0);
  });

  it("marca un sink sin argumentos: el dato puede venir en el receptor", () => {
    expect(scan(`const doc = new Finance(req.body);\ndoc.save();`)).toMatchObject([{ cwe: 943, line: 2 }]);
  });

  it("usa la misma coincidencia de nombres que el motor", () => {
    expect(scan(`evaluatePrice(x);`)).toHaveLength(0);
    expect(scan(`myExecutor(x);`)).toHaveLength(0);
    expect(scan(`child_process.exec(cmd);`)).toHaveLength(1);
  });

  it("detecta escrituras de propiedad y atributos JSX", () => {
    expect(scan(`el.innerHTML = name;`)).toMatchObject([{ cwe: 79 }]);
    expect(scan(`el.innerHTML = "<b>hola</b>";`)).toHaveLength(0);
    expect(scan(`<div dangerouslySetInnerHTML={{__html: html}} />`)).toMatchObject([{ cwe: 79 }]);
  });

  it("ignora sinks comentados y declaraciones de función", () => {
    expect(scan(`// db.query(input);\n/* exec(cmd) */`)).toHaveLength(0);
    expect(scan(`function exec(cmd) { return cmd; }`)).toHaveLength(0);
  });

  it("maskComments conserva los literales y la posición de las líneas", () => {
    const code = `const u = "http://x"; // nota\nfoo();`;
    const masked = maskComments(code);
    expect(masked).toContain(`"http://x"`);
    expect(masked).not.toContain("nota");
    expect(masked.split("\n")).toHaveLength(2);
  });

  it("isLiteralOnly distingue constantes de valores", () => {
    expect(isLiteralOnly(`"a", 1, true`)).toBe(true);
    expect(isLiteralOnly(`"a" + b`)).toBe(false);
  });
});
