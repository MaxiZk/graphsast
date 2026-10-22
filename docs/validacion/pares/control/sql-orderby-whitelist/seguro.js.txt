const express = require("express");
const db = require("./db");
const app = express();
const COLUMNAS = ["nombre", "precio", "fecha"];

app.get("/productos", async (req, res) => {
  const orden = req.query.orden;
  if (!COLUMNAS.includes(orden)) return res.status(400).send("orden inválido");
  const rows = await db.query("SELECT * FROM productos ORDER BY " + orden);
  res.json(rows);
});
