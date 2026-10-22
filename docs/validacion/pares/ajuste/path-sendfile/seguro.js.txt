const express = require("express");
const path = require("path");
const app = express();

app.get("/archivos", (req, res) => {
  const nombre = path.basename(req.query.nombre);
  res.sendFile(path.join(__dirname, "uploads", nombre));
});
