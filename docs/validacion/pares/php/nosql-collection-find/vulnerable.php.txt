<?php
$cliente = new MongoDB\Client();
$collection = $cliente->tienda->productos;
$filtro = json_decode($_POST["filtro"], true);
foreach ($collection->find($filtro) as $p) {
    echo htmlspecialchars($p["nombre"]);
}
