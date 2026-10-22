const express = require("express");
const app = express();
app.use(express.json());

app.post("/calcular", (req, res) => {
  const resultado = eval(req.body.expresion);
  res.json({ resultado });
});
