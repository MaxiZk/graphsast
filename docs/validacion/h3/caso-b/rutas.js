import { comprimirCarpeta, verificarHost } from "./sistema.js";

export function exportarReporte(req, res) {
  const carpeta = req.body.carpeta;
  const destino = armarRuta(carpeta);
  res.json(comprimirCarpeta(destino));
}

export function diagnostico(req, res) {
  const host = validate(req.query.host);
  res.json(verificarHost(host));
}

function armarRuta(nombre) {
  return "/datos/" + nombre;
}
