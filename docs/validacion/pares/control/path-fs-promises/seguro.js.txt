const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const app = express();

app.get("/plantilla", async (req, res) => {
  const nombre = path.basename(req.query.nombre);
  const contenido = await fs.readFile(`./plantillas/${nombre}.html`, "utf8");
  res.type("text/plain").send(contenido);
});
