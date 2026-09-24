import { buscarPedidos, buscarCliente } from "./pedidos.js";

export function listarPedidos(req, res) {
  const estado = req.query.estado;
  const filtro = armarFiltro(estado);
  res.json(buscarPedidos(filtro));
}

export function verCliente(req, res) {
  const id = sanitize(req.params.id);
  res.json(buscarCliente(id));
}

function armarFiltro(valor) {
  return "estado = '" + valor + "'";
}
