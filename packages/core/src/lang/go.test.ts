import { describe, expect, it } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";

const cwesOf = (code: string) =>
  [...new Set(analyzeTaint(analyzeGraph(`package main\n${code}`, "main.go")).map((f) => f.cwe))].sort();

describe("Go", () => {
  it("Decode(&x) escribe en x el cuerpo del pedido", () => {
    expect(cwesOf(`func h(w http.ResponseWriter, r *http.Request) {
  var body struct{ Q string }
  json.NewDecoder(r.Body).Decode(&body)
  db.Query("SELECT * FROM t WHERE q = '" + body.Q + "'")
}`)).toEqual([89]);
  });

  it("a, err := f() le da el valor de f() a cada nombre", () => {
    expect(cwesOf(`func h(r *http.Request) {
  id, err := leer(r)
  _ = err
  db.Exec("DELETE FROM t WHERE id = " + id)
}`)).toEqual([89]);
  });

  it("los argumentos de la consulta no son inyección", () => {
    expect(cwesOf(`func h(r *http.Request) { db.Query("SELECT * FROM t WHERE id = $1", r.FormValue("id")) }`)).toEqual([]);
  });

  it("un import con alias se reconoce por el paquete", () => {
    expect(cwesOf(`import ex "os/exec"
func h(r *http.Request) { ex.Command(r.FormValue("cmd")).Run() }`)).toEqual([78]);
  });

  it("exec.Command sin shell solo es peligroso por el programa", () => {
    expect(cwesOf(`func h(r *http.Request) { exec.Command("ping", "-c", "1", r.FormValue("h")).Run() }`)).toEqual([]);
    expect(cwesOf(`func h(r *http.Request) { exec.Command("bash", "-c", "ping " + r.FormValue("h")).Run() }`)).toEqual([78]);
  });

  it("strconv.Atoi convierte a número y corta la inyección", () => {
    expect(cwesOf(`func h(r *http.Request) {
  n, _ := strconv.Atoi(r.FormValue("n"))
  db.Query(fmt.Sprintf("SELECT * FROM t LIMIT %d", n))
}`)).toEqual([]);
  });
});
