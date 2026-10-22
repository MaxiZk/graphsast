<?php
$archivo = basename($_GET["archivo"]);
header("Content-Type: text/plain");
echo htmlspecialchars(file_get_contents("/var/www/docs/" . $archivo));
