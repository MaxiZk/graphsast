const express = require("express");
const { Client } = require("pg");
const client = new Client();
const app = express();

app.get("/pagina", async (req, res) => {
  const limite = req.query.limite;
  const r = await client.query("SELECT * FROM posts LIMIT " + limite);
  res.json(r.rows);
});
