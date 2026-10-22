<?php
$cliente = new MongoDB\Client();
$collection = $cliente->tienda->productos;
$categoria = strval($_POST["categoria"]);
foreach ($collection->find(["categoria" => $categoria]) as $p) {
    echo htmlspecialchars($p["nombre"]);
}
