const express = require("express");
const db = require("./db");
const app = express();

function obtenerUsuario(id) {
  return db.query("SELECT * FROM usuarios WHERE id = ?", [id]);
}

app.get("/usuarios/:id", async (req, res) => {
  const usuario = await obtenerUsuario(req.params.id);
  res.json(usuario);
});
