function mostrarMensaje(mensaje) {
  const contenedor = document.getElementById("mensaje");
  const p = document.createElement("p");
  p.textContent = mensaje;
  contenedor.appendChild(p);
}

const params = new URLSearchParams(window.location.search);
mostrarMensaje(params.get("msg"));
