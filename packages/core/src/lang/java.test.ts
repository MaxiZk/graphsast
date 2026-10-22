import { describe, expect, it } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";
import { taintRulesFor } from "../taint/rules.js";

const cwesOf = (code: string, mode: "params" | "catalog" = "params") => {
  const graph = analyzeGraph(code, "App.java");
  return [...new Set(analyzeTaint(graph, { rules: taintRulesFor(mode, "java") }).map((f) => f.cwe))].sort();
};

describe("Java", () => {
  it("un método llamado sin receptor es el de la misma clase", () => {
    expect(cwesOf(`class Repo {
  Statement st;
  void buscar(String id) throws Exception { st.executeQuery(armar(id)); }
  String armar(String id) { return "SELECT * FROM t WHERE id = " + id; }
}`)).toEqual([89]);
  });

  it("un campo asignado en el constructor llega a otro método", () => {
    expect(cwesOf(`class Tarea {
  private final String comando;
  Tarea(String comando) { this.comando = comando; }
  void correr() throws Exception { Runtime.getRuntime().exec(this.comando); }
}
class Uso {
  void h(HttpServletRequest request) throws Exception { new Tarea(request.getParameter("c")).correr(); }
}`)).toEqual([78]);
  });

  it("con el modelo del catálogo, cuentan las anotaciones de Spring y el request del servlet", () => {
    const spring = `class C {
  @GetMapping("/x") void x(@RequestParam String id, String otro) throws Exception {
    st.executeQuery("SELECT " + id);
  }
  void y(String otro) throws Exception { st.executeQuery("SELECT " + otro); }
}`;
    expect(cwesOf(spring, "catalog")).toEqual([89]);
    expect(cwesOf(`class S { void doGet(HttpServletRequest request) throws Exception {
  st.executeQuery("SELECT " + request.getParameter("id"));
} }`, "catalog")).toEqual([89]);
  });

  it("ProcessBuilder sin shell solo es peligroso por el programa", () => {
    expect(cwesOf(`class C { void h(String host) throws Exception { new ProcessBuilder("ping", "-c", "1", host).start(); } }`)).toEqual([]);
    expect(cwesOf(`class C { void h(String cmd) throws Exception { new ProcessBuilder(cmd).start(); } }`)).toEqual([78]);
    expect(cwesOf(`class C { void h(String x) throws Exception { new ProcessBuilder("bash", "-c", "ls " + x).start(); } }`)).toEqual([78]);
  });

  it("un @RestController que devuelve un objeto responde JSON, no HTML", () => {
    expect(cwesOf(`@RestController class C {
  @GetMapping("/a") public String a(@RequestParam String q) { return "<b>" + q + "</b>"; }
  @GetMapping("/b") public Map<String, String> b(@RequestParam String q) { return Map.of("q", q); }
}`)).toEqual([79]);
  });
});
