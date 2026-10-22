const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();
const BASE = path.resolve(__dirname, "docs");

app.get("/doc/:nombre", (req, res) => {
  const ruta = path.resolve(BASE, req.params.nombre);
  if (!ruta.startsWith(BASE + path.sep)) {
    return res.status(403).send("acceso denegado");
  }
  fs.readFile(ruta, "utf8", (err, data) => {
    if (err) return res.status(404).end();
    res.type("text/plain").send(data);
  });
});
