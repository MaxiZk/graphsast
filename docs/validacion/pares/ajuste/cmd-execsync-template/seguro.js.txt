const cp = require("child_process");

module.exports = function listar(req, res) {
  const carpeta = req.body.carpeta;
  const salida = cp.spawnSync("ls", ["-la", carpeta]).stdout.toString();
  res.json({ salida });
};
