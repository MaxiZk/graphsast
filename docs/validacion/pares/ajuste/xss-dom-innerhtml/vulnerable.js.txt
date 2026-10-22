function mostrarMensaje(mensaje) {
  const contenedor = document.getElementById("mensaje");
  contenedor.innerHTML = "<p>" + mensaje + "</p>";
}

const params = new URLSearchParams(window.location.search);
mostrarMensaje(params.get("msg"));
