<?php
function comprimir($nombre) {
    return `tar -czf /backups/$nombre.tgz /data`;
}
comprimir($_POST["nombre"]);
