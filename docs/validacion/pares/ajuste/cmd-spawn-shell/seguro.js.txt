const { spawn } = require("child_process");

function convertir(req, res) {
  const archivo = req.query.archivo;
  const proceso = spawn("convert", [archivo, "salida.png"]);
  proceso.on("close", () => res.send("listo"));
}
module.exports = convertir;
