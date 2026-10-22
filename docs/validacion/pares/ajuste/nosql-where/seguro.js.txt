const express = require("express");
const Note = require("./models/Note");
const app = express();

app.get("/notas", async (req, res) => {
  const notas = await Note.find({ autor: { $eq: req.query.autor } });
  res.json(notas);
});
