<?php
$pdo = new PDO("mysql:host=localhost;dbname=app", "app", "secreto");
$usuario = $_POST["usuario"];
$clave = $_POST["clave"];
$fila = $pdo->query("SELECT id FROM usuarios WHERE usuario = '$usuario' AND clave = '$clave'")->fetch();
if ($fila) {
    $_SESSION["id"] = $fila["id"];
}
