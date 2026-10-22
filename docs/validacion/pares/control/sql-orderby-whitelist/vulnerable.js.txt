const express = require("express");
const db = require("./db");
const app = express();

app.get("/productos", async (req, res) => {
  const orden = req.query.orden;
  const rows = await db.query("SELECT * FROM productos ORDER BY " + orden);
  res.json(rows);
});
