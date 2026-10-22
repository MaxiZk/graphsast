<?php
$cliente = new MongoDB\Client("mongodb://localhost:27017");
$usuarios = $cliente->app->usuarios;
$usuario = $usuarios->findOne(["usuario" => (string) $_POST["usuario"], "clave" => (string) $_POST["clave"]]);
if ($usuario) {
    echo "Bienvenido";
}
