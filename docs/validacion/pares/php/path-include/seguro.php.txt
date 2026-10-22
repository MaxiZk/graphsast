<?php
$pagina = $_GET["pagina"];
$permitidas = ["inicio", "contacto", "ayuda"];
if (!in_array($pagina, $permitidas, true)) {
    $pagina = "inicio";
}
include "paginas/" . basename($pagina) . ".php";
