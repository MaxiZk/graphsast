const express = require("express");
const Producto = require("./models/Producto");
const app = express();

app.get("/baratos", async (req, res) => {
  const lista = await Producto.find({ precio: { $lt: req.query.max } });
  res.json(lista);
});
