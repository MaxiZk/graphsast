import { describe, expect, it } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";

const cwesOf = (code: string) =>
  [...new Set(analyzeTaint(analyzeGraph(code, "index.php")).map((f) => f.cwe))].sort();

describe("PHP", () => {
  it("las superglobales son entradas y echo es un destino HTML", () => {
    expect(cwesOf(`<?php echo "<b>" . $_GET["n"] . "</b>";`)).toEqual([79]);
    expect(cwesOf(`<?php echo "<b>" . htmlspecialchars($_GET["n"]) . "</b>";`)).toEqual([]);
  });

  it("<?= ?> en una plantilla también imprime", () => {
    expect(cwesOf(`<?php $q = $_GET["q"]; ?>\n<p><?= $q ?></p>`)).toEqual([79]);
  });

  it("(int) convierte a número y corta la inyección", () => {
    expect(cwesOf(`<?php mysqli_query($c, "SELECT * FROM t WHERE id = " . (int) $_GET["id"]);`)).toEqual([]);
    expect(cwesOf(`<?php mysqli_query($c, "SELECT * FROM t WHERE id = " . $_GET["id"]);`)).toEqual([89]);
  });

  it("de $_SERVER solo cuentan las claves que manda el cliente", () => {
    expect(cwesOf(`<?php echo $_SERVER["HTTP_USER_AGENT"];`)).toEqual([79]);
    expect(cwesOf(`<?php include $_SERVER["DOCUMENT_ROOT"] . "/config.php";`)).toEqual([]);
  });

  it("las comillas invertidas ejecutan un comando", () => {
    expect(cwesOf(`<?php $d = $_GET["d"]; $s = \`ls $d\`;`)).toEqual([78]);
  });

  it("$this->campo asignado en el constructor llega a otro método", () => {
    expect(cwesOf(`<?php
class Busqueda {
  private $termino;
  public function __construct($termino) { $this->termino = $termino; }
  public function mostrar() { echo "<p>" . $this->termino . "</p>"; }
}
(new Busqueda($_GET["q"]))->mostrar();`)).toEqual([79]);
  });
});
