<?php
function comprimir($nombre) {
    $seguro = escapeshellarg($nombre . ".tgz");
    return `tar -czf /backups/$seguro /data`;
}
comprimir($_POST["nombre"]);
