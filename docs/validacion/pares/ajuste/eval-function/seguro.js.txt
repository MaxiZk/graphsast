const FILTROS = { baratos: (item) => item.precio < 100, caros: (item) => item.precio >= 100 };
function aplicarFiltro(req, res) {
  const filtro = FILTROS[req.query.condicion];
  if (!filtro) return res.status(400).end();
  res.json(datos.filter(filtro));
}
module.exports = aplicarFiltro;
