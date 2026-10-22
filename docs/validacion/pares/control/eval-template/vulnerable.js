const express = require("express");
const app = express();

app.get("/formula", (req, res) => {
  const x = Number(req.query.x);
  const total = eval(`${x} * ${req.query.factor}`);
  res.json({ total });
});
