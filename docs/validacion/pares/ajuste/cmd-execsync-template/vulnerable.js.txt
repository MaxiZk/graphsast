const cp = require("child_process");

module.exports = function listar(req, res) {
  const carpeta = req.body.carpeta;
  const salida = cp.execSync(`ls -la ${carpeta}`).toString();
  res.json({ salida });
};
