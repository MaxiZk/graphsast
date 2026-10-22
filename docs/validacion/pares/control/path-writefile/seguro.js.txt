const fs = require("fs");
const crypto = require("crypto");

module.exports = function guardarNota(req, res) {
  const { cuerpo } = req.body;
  const id = crypto.randomUUID();
  fs.writeFileSync(`./notas/${id}.txt`, cuerpo);
  res.status(201).json({ id });
};
