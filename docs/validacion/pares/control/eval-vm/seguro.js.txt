const REGLAS = { descuento10: (precio) => precio * 0.9, descuento20: (precio) => precio * 0.8 };

function evaluarRegla(req, res) {
  const regla = REGLAS[req.body.regla];
  if (!regla) return res.status(400).end();
  res.json({ resultado: regla(100) });
}
module.exports = evaluarRegla;
