function agregarComentario(texto) {
  const lista = document.getElementById("comentarios");
  lista.insertAdjacentHTML("beforeend", "<li>" + texto + "</li>");
}

fetch("/api/comentarios")
  .then((r) => r.json())
  .then((comentarios) => comentarios.forEach((c) => agregarComentario(c.texto)));
