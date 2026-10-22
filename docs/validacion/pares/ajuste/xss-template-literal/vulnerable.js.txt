const express = require("express");
const app = express();
app.use(express.urlencoded({ extended: true }));

app.post("/comentario", (req, res) => {
  const { autor, texto } = req.body;
  res.send(`<div class="comentario"><b>${autor}</b><p>${texto}</p></div>`);
});
