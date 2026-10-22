const express = require("express");
const app = express();

app.get("/recordatorio", (req, res) => {
  setTimeout("console.log('" + req.query.mensaje + "')", 1000);
  res.send("programado");
});
