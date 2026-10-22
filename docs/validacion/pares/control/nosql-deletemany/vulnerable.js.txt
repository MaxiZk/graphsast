const express = require("express");
const Mensaje = require("./models/Mensaje");
const app = express();
app.use(express.json());

app.post("/mensajes/borrar", async (req, res) => {
  await Mensaje.deleteMany({ autor: req.body.autor });
  res.sendStatus(204);
});
