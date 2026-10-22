<?php
$nombre = $_GET["nombre"] ?? "";
echo "<h1>Hola, " . htmlspecialchars($nombre, ENT_QUOTES, "UTF-8") . "</h1>";
