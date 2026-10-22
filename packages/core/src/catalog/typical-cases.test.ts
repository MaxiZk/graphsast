import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";
import { getCatalogBundle } from "../taint/rules.js";
import { rulesFromCatalog } from "./rules.js";

/**
 * Casos de los pares vulnerable/corregido (docs/validacion/pares) reducidos a
 * lo que cada regla decide, con el borde que no tiene que cruzar.
 */
function cwesOf(code: string, file = "t.js"): number[] {
  return [...new Set(analyzeTaint(analyzeGraph(code, file)).map((f) => f.cwe!))].sort();
}

const handler = (body: string) => `app.get("/x", (req, res) => {\n${body}\n});`;

describe("entradas del navegador", () => {
  it("location, document.cookie y window.name son origen sin parámetros", () => {
    expect(cwesOf(`document.getElementById("t").innerHTML = location.hash.substring(1);`)).toEqual([79]);
    expect(cwesOf(`document.write(new URLSearchParams(window.location.search).get("q"));`)).toEqual([79]);
    expect(cwesOf(`el.innerHTML = document.cookie;`)).toEqual([79]);
    expect(cwesOf(`eval(window.name);`)).toEqual([95]);
  });

  it("el valor de un campo del formulario y $(...).val() también", () => {
    expect(cwesOf(`out.innerHTML = document.querySelector("#q").value;`)).toEqual([79]);
    expect(cwesOf(`const input = document.getElementById("q");\nout.innerHTML = input.value;`)).toEqual([79]);
    expect(cwesOf(`$("#r").html($("#q").val());`)).toEqual([79]);
  });

  it("escribir en location no es leer una entrada, y una variable local llamada location no es la global", () => {
    expect(cwesOf(`location.href = "/inicio"; el.innerHTML = "<b>hola</b>";`)).toEqual([]);
    expect(cwesOf(`const location = { hash: "#a" };\nel.innerHTML = location.hash;`)).toEqual([]);
    expect(cwesOf(`el.innerHTML = config.value;`)).toEqual([]);
  });

  it("textContent no es destino", () => {
    expect(cwesOf(`document.getElementById("t").textContent = location.hash;`)).toEqual([]);
  });

  it("también con el modelo de origen del catálogo", () => {
    const rules = rulesFromCatalog(getCatalogBundle(), "catalog");
    const findings = analyzeTaint(analyzeGraph(`el.innerHTML = location.hash;`, "t.js"), { rules });
    expect(findings.map((f) => f.cwe)).toEqual([79]);
  });
});

describe("execFile y spawn sin shell", () => {
  it("los argumentos en un array no pasan por el shell", () => {
    expect(cwesOf(handler(`execFile("ping", ["-c", "1", req.query.host]);`))).toEqual([]);
    expect(cwesOf(handler(`spawn("ls", ["-la", req.query.dir]);`))).toEqual([]);
  });

  it("el programa a ejecutar sí, y los argumentos cuando hay un shell", () => {
    expect(cwesOf(handler(`execFile(req.query.cmd, []);`))).toEqual([78]);
    expect(cwesOf(handler(`spawn("sh", ["-c", "convert " + req.query.f]);`))).toEqual([78]);
    expect(cwesOf(handler(`spawn("ls", [req.query.dir], { shell: true });`))).toEqual([78]);
    expect(cwesOf(handler(`spawn("ls", [req.query.dir], { shell: false });`))).toEqual([]);
  });
});

describe("setTimeout con un texto", () => {
  it("un texto armado con el dato se evalúa como código", () => {
    expect(cwesOf(handler(`setTimeout("alert('" + req.query.m + "')", 10);`))).toEqual([95]);
  });

  it("una función no", () => {
    expect(cwesOf(handler(`setTimeout(() => console.log(req.query.m), 10);`))).toEqual([]);
    expect(cwesOf(`function debounce(fn, ms) { setTimeout(fn, ms); }`)).toEqual([]);
  });
});

describe("respuestas de Express y de Node", () => {
  it("res.status(...).send y res.write con HTML son XSS", () => {
    expect(cwesOf(handler(`res.status(400).send("No existe: " + req.query.id);`))).toEqual([79]);
    expect(cwesOf(handler(`res.write("<p>" + req.query.q + "</p>");`))).toEqual([79]);
    expect(cwesOf(handler(`res.end(\`<h1>\${req.query.q}</h1>\`);`))).toEqual([79]);
  });

  it("con tipo text/plain, o un objeto en una variable, no", () => {
    expect(cwesOf(handler(`res.type("text/plain").send(req.query.q);`))).toEqual([]);
    expect(cwesOf(handler(`const result = { q: req.query.q };\nres.status(200).send(result);`))).toEqual([]);
  });

  it("con tipo html explícito, sí", () => {
    expect(cwesOf(handler(`res.type("html").send(req.query.q);`))).toEqual([79]);
  });
});

describe("rutas de archivo", () => {
  it("res.sendFile y res.download son destinos", () => {
    expect(cwesOf(handler(`res.sendFile(path.join(__dirname, "up", req.query.f));`))).toEqual([22]);
    expect(cwesOf(handler(`res.download("./reportes/" + req.query.f);`))).toEqual([22]);
  });

  it("startsWith sobre la ruta resuelta acota la ruta", () => {
    expect(cwesOf(handler(`const ruta = path.resolve(BASE, req.query.f);
if (!ruta.startsWith(BASE + path.sep)) return res.status(403).end();
fs.readFileSync(ruta);`))).toEqual([]);
  });

  it("sin resolver la ruta antes, startsWith no alcanza", () => {
    expect(cwesOf(handler(`const ruta = BASE + req.query.f;
if (!ruta.startsWith(BASE)) return res.status(403).end();
fs.readFileSync(ruta);`))).toEqual([22]);
  });

  it("y no protege el mismo dato de otra familia", () => {
    expect(cwesOf(handler(`const ruta = path.resolve(BASE, req.query.f);
if (!ruta.startsWith(BASE)) return res.status(403).end();
res.send("<p>" + ruta + "</p>");`))).toEqual([79]);
  });
});

describe("find de MongoDB y Array.prototype.find", () => {
  it("find sobre una colección con nombre en minúscula", () => {
    expect(cwesOf(handler(`const col = client.db().collection("p");\ncol.find({ cat: req.query.cat });`))).toEqual([943]);
    expect(cwesOf(handler(`collection.find(req.body.filtro);`))).toEqual([943]);
    expect(cwesOf(handler(`db.ordersCollection.find({ email: req.body.email });`))).toEqual([943]);
  });

  it("find de un array con una función no es una consulta", () => {
    expect(cwesOf(handler(`const item = items.find((i) => i.id === req.params.id);\nres.json(item);`))).toEqual([]);
  });

  it("un método de texto devuelve texto: no puede llevar operadores", () => {
    expect(cwesOf(handler(`User.findOne({ email: req.body.email.toLowerCase() });`))).toEqual([]);
    expect(cwesOf(handler(`User.findOne({ email: req.body.email.trim() });`))).toEqual([]);
  });
});
