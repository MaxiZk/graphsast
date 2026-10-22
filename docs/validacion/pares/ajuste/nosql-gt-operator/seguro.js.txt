const express = require("express");
const Producto = require("./models/Producto");
const app = express();

app.get("/baratos", async (req, res) => {
  const max = parseFloat(req.query.max);
  const lista = await Producto.find({ precio: { $lt: max } });
  res.json(lista);
});
