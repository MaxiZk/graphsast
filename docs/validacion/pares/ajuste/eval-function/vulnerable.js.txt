function aplicarFiltro(req, res) {
  const filtro = new Function("item", "return " + req.query.condicion);
  res.json(datos.filter(filtro));
}
module.exports = aplicarFiltro;
