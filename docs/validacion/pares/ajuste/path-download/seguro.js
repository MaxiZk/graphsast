const express = require("express");
const app = express();
const PERMITIDOS = ["enero.pdf", "febrero.pdf", "marzo.pdf"];

app.get("/descargar", (req, res) => {
  const archivo = req.query.archivo;
  if (!PERMITIDOS.includes(archivo)) return res.status(400).send("no permitido");
  res.download("./reportes/" + archivo);
});
