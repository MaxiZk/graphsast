const fs = require("fs");
const http = require("http");

http.createServer((req, res) => {
  const archivo = new URL(req.url, "http://localhost").searchParams.get("f");
  fs.createReadStream("/var/www/static/" + archivo).pipe(res);
}).listen(8080);
