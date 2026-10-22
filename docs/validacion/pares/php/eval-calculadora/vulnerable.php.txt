<?php
$expresion = $_GET["expr"];
eval('$resultado = ' . $expresion . ';');
echo intval($resultado);
