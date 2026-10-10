import { describe, it, expect } from "vitest";
import { analyzeTaintFromCode, analyzeGraph } from "../index.js";

function findings(code: string, file = "t.ts"): number {
  return analyzeTaintFromCode(code, file).length;
}

/**
 * `innerHTML` y `outerHTML` figuraban en el catálogo CWE-79 desde el principio
 * pero no podían disparar nunca: son escrituras de propiedad, y los sinks se
 * emparejan contra el `callee` de nodos Call. Estos tests fijan que la
 * cobertura declarada sea cobertura real.
 */
describe("sinks XSS por escritura de propiedad", () => {
  it("`el.innerHTML = tainted` se detecta", () => {
    expect(findings(`function h(req) {
  const el = document.getElementById("a");
  el.innerHTML = req.query.x;
}`)).toBeGreaterThan(0);
  });

  it("`el.outerHTML = tainted` se detecta", () => {
    expect(findings(`function h(req) {
  const el = document.getElementById("a");
  el.outerHTML = req.query.x;
}`)).toBeGreaterThan(0);
  });

  it("un literal en innerHTML no es hallazgo", () => {
    expect(findings(`function h(req) {
  const el = document.getElementById("a");
  el.innerHTML = "<b>hola</b>";
}`)).toBe(0);
  });

  it("un sanitizador en el camino suprime el hallazgo", () => {
    expect(findings(`function h(req) {
  const el = document.getElementById("a");
  el.innerHTML = DOMPurify.sanitize(req.query.x);
}`)).toBe(0);
  });

  it("escribir una propiedad inocua no crea un sink", () => {
    expect(findings(`function h(req) {
  const o = {};
  o.nombre = req.query.x;
}`)).toBe(0);
  });

  it("el nodo se ubica en el nombre de la propiedad, sin colisionar ids", () => {
    const g = analyzeGraph(
      `function h(req) { document.getElementById("a").innerHTML = req.query.x; }`,
      "t.ts",
    );
    const ids = g.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(g.nodes.some((n) => n.kind === "Call" && n.callee.endsWith(".innerHTML")))
      .toBe(true);
  });
});

describe("sinks XSS en JSX", () => {
  it("`dangerouslySetInnerHTML` con dato no confiable se detecta", () => {
    expect(findings(
      `function Card(req) {
  return <div dangerouslySetInnerHTML={{ __html: req.query.bio }} />;
}`,
      "t.tsx",
    )).toBeGreaterThan(0);
  });

  it("funciona con el parámetro desestructurado, que es la forma habitual", () => {
    expect(findings(
      `function Card({ req }) {
  return <div dangerouslySetInnerHTML={{ __html: req.query.bio }} />;
}`,
      "t.tsx",
    )).toBeGreaterThan(0);
  });

  it("sanitizado con DOMPurify no es hallazgo", () => {
    expect(findings(
      `function Card({ req }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(req.query.bio) }} />;
}`,
      "t.tsx",
    )).toBe(0);
  });

  it("un atributo JSX cualquiera no es sink", () => {
    expect(findings(
      `function Card({ req }) {
  return <div className={req.query.c} />;
}`,
      "t.tsx",
    )).toBe(0);
  });
});

describe("parámetros desestructurados", () => {
  it("`function h({ body }, res)` reconoce `body` como source", () => {
    expect(findings(`function h({ body }, res) {
  res.send(body.nombre);
}`)).toBeGreaterThan(0);
  });

  it("cada binding produce su propio nodo Parameter", () => {
    const g = analyzeGraph(`function h({ body, query }) { return 1; }`, "t.ts");
    const names = g.nodes.filter((n) => n.kind === "Parameter").map((n) => n.name);
    expect(names).toContain("body");
    expect(names).toContain("query");
  });

  it("`paramIds` sigue alineado con la posición del argumento", () => {
    const g = analyzeGraph(`function h({ a, b }, c) { return 1; }`, "t.ts");
    const fn = g.nodes.find((n) => n.kind === "Function" && n.name === "h");
    expect(fn && fn.kind === "Function" && fn.paramIds.length).toBe(2);
  });
});
