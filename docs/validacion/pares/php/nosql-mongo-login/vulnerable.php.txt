<?php
$cliente = new MongoDB\Client("mongodb://localhost:27017");
$usuarios = $cliente->app->usuarios;
$usuario = $usuarios->findOne(["usuario" => $_POST["usuario"], "clave" => $_POST["clave"]]);
if ($usuario) {
    echo "Bienvenido";
}
