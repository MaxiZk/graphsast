const fs = require("fs");

module.exports = function guardarNota(req, res) {
  const { titulo, cuerpo } = req.body;
  fs.writeFileSync(`./notas/${titulo}.txt`, cuerpo);
  res.status(201).end();
};
