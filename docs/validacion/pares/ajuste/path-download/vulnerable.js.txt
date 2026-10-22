const express = require("express");
const app = express();

app.get("/descargar", (req, res) => {
  const archivo = req.query.archivo;
  res.download("./reportes/" + archivo);
});
