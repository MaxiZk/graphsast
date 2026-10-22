const http = require("http");
const url = require("url");

http.createServer((req, res) => {
  const q = url.parse(req.url, true).query;
  res.writeHead(200, { "Content-Type": "text/html" });
  res.write("<p>Buscaste: " + q.term + "</p>");
  res.end();
}).listen(8080);
