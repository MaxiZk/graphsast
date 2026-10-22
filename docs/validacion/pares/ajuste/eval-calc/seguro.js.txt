const express = require("express");
const app = express();
app.use(express.json());

app.post("/calcular", (req, res) => {
  const a = Number(req.body.a);
  const b = Number(req.body.b);
  res.json({ resultado: a + b });
});
