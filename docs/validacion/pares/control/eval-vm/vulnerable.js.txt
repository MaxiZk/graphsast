const vm = require("vm");

function evaluarRegla(req, res) {
  const resultado = vm.runInNewContext(req.body.regla, { precio: 100 });
  res.json({ resultado });
}
module.exports = evaluarRegla;
