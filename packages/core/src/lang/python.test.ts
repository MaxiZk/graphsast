import { describe, expect, it } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";
import { scanSource } from "../scan/scan-files.js";

const cwesOf = (code: string) =>
  [...new Set(analyzeTaint(analyzeGraph(code, "app.py")).map((f) => f.cwe))].sort();

describe("Python", () => {
  it("las lecturas de request de Flask son origen sin parámetros", () => {
    expect(cwesOf(`from flask import request
def h():
    cursor.execute("SELECT * FROM t WHERE id = " + request.args["id"])`)).toEqual([89]);
  });

  it("un parámetro de la vista también (Django, FastAPI)", () => {
    expect(cwesOf(`def h(request):
    cursor.execute("SELECT * FROM t WHERE n = '%s'" % request.GET["n"])`)).toEqual([89]);
  });

  it("los argumentos ligados no son inyección", () => {
    expect(cwesOf(`def h(request):
    cursor.execute("SELECT * FROM t WHERE n = %s", (request.GET["n"],))`)).toEqual([]);
  });

  it("un import con alias se reconoce: sp.run es subprocess.run", () => {
    expect(cwesOf(`import subprocess as sp
def h(host):
    sp.run("ping " + host, shell=True)`)).toEqual([78]);
    expect(cwesOf(`from os import system
def h(cmd):
    system(cmd)`)).toEqual([78]);
  });

  it("subprocess sin shell=True no pasa por el shell", () => {
    expect(cwesOf(`import subprocess
def h(host):
    subprocess.run(["ping", host])
    subprocess.run("ping " + host, shell=False)`)).toEqual([]);
  });

  it("self.x guardado en __init__ llega a otro método, y Clase(x) liga con __init__", () => {
    expect(cwesOf(`import os
class Tarea:
    def __init__(self, comando):
        self.comando = comando
    def correr(self):
        os.system(self.comando)
def h(request):
    Tarea(request.GET["c"]).correr()`)).toEqual([78]);
  });

  it("el retorno de una vista es HTML solo en Flask", () => {
    const vista = `@app.get("/x")
def x(nombre: str):
    return "<h1>" + nombre + "</h1>"`;
    expect(cwesOf(`from flask import Flask\napp = Flask(__name__)\n${vista}`)).toEqual([79]);
    expect(cwesOf(`from fastapi import FastAPI\napp = FastAPI()\n${vista}`)).toEqual([]);
  });

  it("un error de sintaxis no se informa como archivo limpio", () => {
    const result = scanSource(`def h(:\n    pass\n`, "roto.py");
    expect(result.error).toMatch(/error de sintaxis de Python en la línea 1/);
  });

  it("la columna se cuenta en caracteres aunque la línea tenga acentos", () => {
    const graph = analyzeGraph(`def h(request):
    año = "ñ"; os.system(request.GET["c"])`, "app.py");
    const call = graph.nodes.find((n) => n.kind === "Call" && n.name === "os.system")!;
    expect(call.loc.col).toBe(`    año = "ñ"; `.length + 1);
  });

  it("una vista que devuelve un diccionario o un objeto serializado responde JSON", () => {
    expect(cwesOf(`from flask import Flask, request
app = Flask(__name__)
@app.route("/u")
def u():
    return User.query.get(request.args.get("id")).to_dict()`)).toEqual([]);
    expect(cwesOf(`from flask import Flask, request
from flask_apispec import marshal_with
app = Flask(__name__)
@app.route("/a")
@marshal_with(schema)
def a():
    return request.args.get("q")`)).toEqual([]);
    expect(cwesOf(`from flask import Flask, request
app = Flask(__name__)
@app.route("/h")
def h():
    return "<p>" + request.args.get("q") + "</p>"`)).toEqual([79]);
  });
});
