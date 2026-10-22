const express = require("express");
const app = express();

app.get("/recordatorio", (req, res) => {
  const mensaje = req.query.mensaje;
  setTimeout(() => console.log(mensaje), 1000);
  res.send("programado");
});
