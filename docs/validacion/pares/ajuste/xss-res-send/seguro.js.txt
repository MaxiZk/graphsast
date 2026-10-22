const express = require("express");
const escapeHtml = require("escape-html");
const app = express();

app.get("/hola", (req, res) => {
  const nombre = req.query.nombre;
  res.send("<h1>Hola " + escapeHtml(nombre) + "</h1>");
});
app.listen(3000);
