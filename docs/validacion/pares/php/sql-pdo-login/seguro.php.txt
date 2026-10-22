<?php
$pdo = new PDO("mysql:host=localhost;dbname=app", "app", "secreto");
$usuario = $_POST["usuario"];
$clave = $_POST["clave"];
$stmt = $pdo->prepare("SELECT id FROM usuarios WHERE usuario = ? AND clave = ?");
$stmt->execute([$usuario, $clave]);
$fila = $stmt->fetch();
if ($fila) {
    $_SESSION["id"] = $fila["id"];
}
