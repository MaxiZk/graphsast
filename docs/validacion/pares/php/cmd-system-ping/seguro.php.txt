<?php
$host = $_GET["host"];
echo "<pre>";
system("ping -c 1 " . escapeshellarg($host));
echo "</pre>";
