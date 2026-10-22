const { MongoClient } = require("mongodb");
const sanitize = require("mongo-sanitize");
const express = require("express");
const app = express();
const client = new MongoClient("mongodb://localhost:27017");

app.get("/productos", async (req, res) => {
  const productos = client.db("tienda").collection("productos");
  const lista = await productos.find({ categoria: sanitize(req.query.categoria) }).toArray();
  res.json(lista);
});
