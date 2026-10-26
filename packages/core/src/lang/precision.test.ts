import { describe, expect, it } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";

const cwesOf = (code: string, file: string) =>
  [...new Set(analyzeTaint(analyzeGraph(code, file)).map((f) => f.cwe))].sort();

const java = (body: string) =>
  cwesOf(`class C {\n  void h(HttpServletRequest request) throws Exception {\n${body}\n  }\n}`, "C.java");

describe("asignaciones que pisan a las anteriores", () => {
  it("la última asignación antes del uso es la que llega", () => {
    expect(java(`String bar = request.getParameter("x");
bar = "fijo";
stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");`)).toEqual([]);
  });

  it("una asignación dentro de un if no pisa: la otra rama sigue llegando", () => {
    expect(java(`String bar = "fijo";
if (request.getParameter("y") != null) bar = request.getParameter("x");
stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");`)).toEqual([89]);
  });

  it("x = f(x) sigue trayendo el valor anterior", () => {
    expect(java(`String p = request.getParameter("x");
p = java.net.URLDecoder.decode(p, "UTF-8");
stmt.executeQuery("SELECT * FROM t WHERE a = '" + p + "'");`)).toEqual([89]);
  });

  it("un bucle que define la variable no pisa: puede no correr", () => {
    expect(cwesOf(`from flask import request
import os
def h():
    d = request.args.get("d")
    for d in []:
        pass
    os.system("ls " + d)`, "a.py")).toEqual([78]);
  });

  it("+= y .= agregan al valor anterior, no lo reemplazan", () => {
    expect(java(`String q = "SELECT * FROM t WHERE a = '" + request.getParameter("x");
q += "'";
stmt.executeQuery(q);`)).toEqual([89]);
    expect(cwesOf(`<?php
$q = "SELECT * FROM t WHERE a = '" . $_GET["x"];
$q .= "'";
mysqli_query($c, $q);`, "a.php")).toEqual([89]);
  });
});

describe("ramas que no se ejecutan (Java)", () => {
  it("un if con condición constante descarta la rama que no corre", () => {
    expect(java(`String param = request.getParameter("x");
String bar;
int num = 86;
if ((7 * 42) - num > 200) bar = "fijo"; else bar = param;
stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");`)).toEqual([]);
    expect(java(`String param = request.getParameter("x");
String bar;
int num = 106;
if ((7 * 42) - num > 200) bar = "fijo"; else bar = param;
stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");`)).toEqual([89]);
  });

  it("un ternario con condición constante", () => {
    expect(java(`String param = request.getParameter("x");
int num = 196;
String bar = (7 * 18) + num > 200 ? "fijo" : param;
stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");`)).toEqual([]);
  });

  it("un switch sobre un valor constante corre solo su case", () => {
    const sw = (guess: string) => java(`String param = request.getParameter("x");
String bar;
String guess = "${guess}";
char target = guess.charAt(1);
switch (target) {
  case 'A': bar = param; break;
  case 'B': bar = "fijo"; break;
  case 'C':
  case 'D': bar = param; break;
  default: bar = "fijo"; break;
}
stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");`);
    expect(sw("ABC")).toEqual([]);
    expect(sw("ACB")).toEqual([89]);
    expect(sw("AZB")).toEqual([]);
  });

  it("new Test().m(x) se resuelve al método de la clase interna", () => {
    const inner = (branch: string) => cwesOf(`class C {
  void h(HttpServletRequest request) throws Exception {
    String bar = new Test().doSomething(request.getParameter("x"));
    stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");
  }
  private class Test {
    public String doSomething(String param) {
      int num = 86;
      if ((7 * 42) - num > 200) return ${branch};
      return "fijo";
    }
  }
}`, "C.java");
    expect(inner(`"fijo"`)).toEqual([]);
    expect(inner("param")).toEqual([89]);
  });

  it("una variable que se reasigna no es constante", () => {
    expect(java(`String param = request.getParameter("x");
int num = 86;
num = Integer.parseInt(request.getParameter("n"));
String bar = (7 * 42) - num > 200 ? "fijo" : param;
stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");`)).toEqual([89]);
  });
});

describe("colecciones y armado de texto", () => {
  it("lo agregado a un StringBuilder o una lista llega a lo que se lee después", () => {
    expect(java(`StringBuilder sb = new StringBuilder("SELECT * FROM t WHERE a = '");
sb.append(request.getParameter("x")).append("'");
stmt.executeQuery(sb.toString());`)).toEqual([89]);
    expect(cwesOf(`from flask import request
import os
def h():
    partes = ["ls"]
    partes.append(request.args.get("d"))
    os.system(" ".join(partes))`, "a.py")).toEqual([78]);
  });

  it("un mapa con claves literales: solo trae el dato la clave en la que se guardó", () => {
    const map = (key: string) => java(`java.util.HashMap<String, Object> m = new java.util.HashMap<String, Object>();
m.put("a", "fijo");
m.put("b", request.getParameter("x"));
String bar = (String) m.get("${key}");
stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");`);
    expect(map("a")).toEqual([]);
    expect(map("b")).toEqual([89]);
  });

  it("un mapa que se usa de otra forma se trata entero", () => {
    expect(java(`java.util.HashMap<String, Object> m = new java.util.HashMap<String, Object>();
m.put("b", request.getParameter("x"));
String bar = (String) m.get(request.getParameter("k"));
stmt.executeQuery("SELECT * FROM t WHERE a = '" + bar + "'");`)).toEqual([89]);
  });
});

describe("validaciones antes de usar el dato", () => {
  it("PHP: is_numeric con die corta; sin salir del bloque, no", () => {
    expect(cwesOf(`<?php
$id = $_GET['id'];
if (!is_numeric($id)) { die("id"); }
mysqli_query($c, "SELECT * FROM t WHERE id = $id");`, "a.php")).toEqual([]);
    expect(cwesOf(`<?php
$id = $_GET['id'];
if (!is_numeric($id)) { echo "id"; }
mysqli_query($c, "SELECT * FROM t WHERE id = $id");`, "a.php")).toEqual([89]);
  });

  it("PHP: cada parte validada dentro del if (DVWA exec impossible)", () => {
    expect(cwesOf(`<?php
$target = $_REQUEST['ip'];
$octet = explode(".", $target);
if (is_numeric($octet[0]) && is_numeric($octet[1]) && sizeof($octet) == 2) {
  $target = $octet[0] . '.' . $octet[1];
  shell_exec('ping -c 4 ' . $target);
}
shell_exec('ping ' . $_REQUEST['ip']);`, "a.php")).toEqual([78]);
  });

  it("PHP: in_array y preg_match anclada", () => {
    expect(cwesOf(`<?php
$col = $_GET['sort'];
if (!in_array($col, ["name", "date"], true)) exit;
$h = $_GET['h'];
if (!preg_match('/^[a-z0-9.-]+$/', $h)) { exit; }
mysqli_query($c, "SELECT * FROM t ORDER BY $col");
shell_exec("ping " . $h);`, "a.php")).toEqual([]);
    expect(cwesOf(`<?php
$h = $_GET['h'];
if (!preg_match('/[a-z0-9.-]+/', $h)) { exit; }
shell_exec("ping " . $h);`, "a.php")).toEqual([78]);
  });

  it("Python: isalnum con abort, regex compilada, lista permitida con valor por defecto", () => {
    expect(cwesOf(`from flask import request, abort
import re, sqlite3, subprocess
HOST = re.compile(r"[a-z0-9.-]+")
def h():
    u = request.args.get("u")
    if not u.isalnum():
        abort(400)
    host = request.args.get("h")
    if HOST.fullmatch(host):
        subprocess.run("ping " + host, shell=True)
    col = request.args.get("sort")
    if col not in ("name", "date"):
        col = "name"
    sqlite3.connect("x").execute("SELECT * FROM t WHERE u = '" + u + "' ORDER BY " + col)`, "a.py")).toEqual([]);
  });

  it("Python: fuera del bloque validado el dato sigue contaminado", () => {
    expect(cwesOf(`from flask import request
import re, subprocess
def h():
    host = request.args.get("h")
    if re.fullmatch(r"[a-z0-9.-]+", host):
        subprocess.run("ping " + host, shell=True)
    subprocess.run("ping " + host, shell=True)`, "a.py")).toEqual([78]);
  });

  it("Java: comparación con literales, matches y lista permitida", () => {
    expect(java(`String sort = request.getParameter("sort");
if (!"asc".equals(sort) && !"desc".equals(sort)) { throw new IllegalArgumentException(); }
String user = request.getParameter("u");
if (!user.matches("[a-zA-Z0-9]+")) return;
stmt.executeQuery("SELECT * FROM t WHERE u = '" + user + "' ORDER BY name " + sort);`)).toEqual([]);
    expect(java(`String sort = request.getParameter("sort");
if ("asc".equals(sort) || sort.length() > 0) { stmt.executeQuery("SELECT * FROM t ORDER BY name " + sort); }`)).toEqual([89]);
  });

  it("Go: MatchString con una regex anclada y return", () => {
    expect(cwesOf(`package main
import ("net/http"; "os/exec"; "regexp")
var host = regexp.MustCompile(\`^[a-z0-9.-]+$\`)
func h(w http.ResponseWriter, r *http.Request) {
  h := r.FormValue("h")
  if !host.MatchString(h) { http.Error(w, "bad", 400); return }
  exec.Command("sh", "-c", "ping " + h).Run()
}`, "main.go")).toEqual([]);
    expect(cwesOf(`package main
import ("net/http"; "os/exec"; "regexp")
var host = regexp.MustCompile(\`[a-z0-9.-]+\`)
func h(w http.ResponseWriter, r *http.Request) {
  h := r.FormValue("h")
  if !host.MatchString(h) { http.Error(w, "bad", 400); return }
  exec.Command("sh", "-c", "ping " + h).Run()
}`, "main.go")).toEqual([78]);
  });
});

describe("catálogo", () => {
  it("Go: los argumentos de una sentencia preparada no son inyección", () => {
    expect(cwesOf(`package main
func h(r *http.Request) {
  stmt, _ := db.Prepare("SELECT * FROM t WHERE id = ?")
  stmt.QueryRow(r.FormValue("id"))
}`, "main.go")).toEqual([]);
  });

  it("Go: json.Marshal escapa < y > al responder", () => {
    expect(cwesOf(`package main
func h(w http.ResponseWriter, r *http.Request) {
  b, _ := json.Marshal(r.FormValue("q"))
  w.Write(b)
}`, "main.go")).toEqual([]);
  });

  it("PHP: un escape de comillas no protege un valor sin comillas", () => {
    expect(cwesOf(`<?php
$id = mysqli_real_escape_string($c, $_POST['id']);
mysqli_query($c, "SELECT * FROM t WHERE id = $id");`, "a.php")).toEqual([89]);
    expect(cwesOf(`<?php
$id = mysqli_real_escape_string($c, $_POST['id']);
mysqli_query($c, "SELECT * FROM t WHERE id = '$id'");`, "a.php")).toEqual([]);
  });

  it("Java: variables de entorno de Runtime.exec y ProcessBuilder.command(lista)", () => {
    expect(java(`String[] env = {request.getParameter("e")};
Runtime r = Runtime.getRuntime();
r.exec(new String[] {"ls"}, env);`)).toEqual([78]);
    expect(java(`java.util.List<String> args = new java.util.ArrayList<String>();
args.add("sh"); args.add("-c"); args.add("echo " + request.getParameter("x"));
ProcessBuilder pb = new ProcessBuilder();
pb.command(args);
pb.start();`)).toEqual([78]);
  });
});
