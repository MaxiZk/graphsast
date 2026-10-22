function agregarComentario(texto) {
  const lista = document.getElementById("comentarios");
  const li = document.createElement("li");
  li.textContent = texto;
  lista.appendChild(li);
}

fetch("/api/comentarios")
  .then((r) => r.json())
  .then((comentarios) => comentarios.forEach((c) => agregarComentario(c.texto)));
