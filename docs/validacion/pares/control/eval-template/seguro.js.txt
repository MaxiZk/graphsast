const express = require("express");
const app = express();

app.get("/formula", (req, res) => {
  const x = Number(req.query.x);
  const factor = Number(req.query.factor);
  res.json({ total: x * factor });
});
