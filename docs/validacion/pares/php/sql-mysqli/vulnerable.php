<?php
$conn = mysqli_connect("localhost", "app", "secreto", "tienda");
$id = $_GET["id"];
$resultado = mysqli_query($conn, "SELECT nombre, precio FROM productos WHERE id = " . $id);
while ($fila = mysqli_fetch_assoc($resultado)) {
    echo htmlspecialchars($fila["nombre"]) . "<br>";
}
