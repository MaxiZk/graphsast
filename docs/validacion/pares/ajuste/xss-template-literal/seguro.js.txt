const express = require("express");
const validator = require("validator");
const app = express();
app.use(express.urlencoded({ extended: true }));

app.post("/comentario", (req, res) => {
  const autor = validator.escape(req.body.autor);
  const texto = validator.escape(req.body.texto);
  res.send(`<div class="comentario"><b>${autor}</b><p>${texto}</p></div>`);
});
