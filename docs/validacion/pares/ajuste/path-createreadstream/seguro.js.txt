const fs = require("fs");
const path = require("path");
const http = require("http");

http.createServer((req, res) => {
  const archivo = new URL(req.url, "http://localhost").searchParams.get("f");
  fs.createReadStream(path.join("/var/www/static/", path.basename(archivo))).pipe(res);
}).listen(8080);
