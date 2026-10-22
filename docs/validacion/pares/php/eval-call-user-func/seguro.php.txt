<?php
$acciones = ["mayusculas" => "strtoupper", "minusculas" => "strtolower"];
$accion = $acciones[$_GET["accion"]] ?? "strtolower";
$resultado = call_user_func($accion, "texto fijo");
echo htmlspecialchars((string) $resultado);
