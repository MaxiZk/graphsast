const fs = require("fs/promises");
const express = require("express");
const app = express();

app.get("/plantilla", async (req, res) => {
  const contenido = await fs.readFile(`./plantillas/${req.query.nombre}.html`, "utf8");
  res.type("text/plain").send(contenido);
});
