export function buscarPedidos(filtro) {
  return db.query("SELECT * FROM pedidos WHERE " + filtro);
}

export function buscarCliente(id) {
  return db.query("SELECT * FROM clientes WHERE id = " + id);
}
