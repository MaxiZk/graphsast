<?php
$conn = mysqli_connect("localhost", "app", "secreto", "tienda");
$id = $_GET["id"];
$stmt = mysqli_prepare($conn, "SELECT nombre, precio FROM productos WHERE id = ?");
mysqli_stmt_bind_param($stmt, "i", $id);
mysqli_stmt_execute($stmt);
$resultado = mysqli_stmt_get_result($stmt);
while ($fila = mysqli_fetch_assoc($resultado)) {
    echo htmlspecialchars($fila["nombre"]) . "<br>";
}
