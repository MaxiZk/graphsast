const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();
const DIR = path.resolve("uploads");

app.delete("/subidas/:archivo", (req, res) => {
  const destino = path.join(DIR, req.params.archivo);
  if (!destino.startsWith(DIR + path.sep)) return res.sendStatus(400);
  fs.unlinkSync(destino);
  res.sendStatus(204);
});
