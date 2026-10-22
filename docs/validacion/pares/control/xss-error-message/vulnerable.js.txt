const express = require("express");
const app = express();

app.get("/producto", (req, res) => {
  const id = req.query.id;
  if (!/^\d+$/.test(id)) {
    return res.status(400).send("Producto inválido: " + id);
  }
  res.send("ok");
});
