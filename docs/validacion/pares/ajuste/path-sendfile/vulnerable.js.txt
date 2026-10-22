const express = require("express");
const path = require("path");
const app = express();

app.get("/archivos", (req, res) => {
  res.sendFile(path.join(__dirname, "uploads", req.query.nombre));
});
