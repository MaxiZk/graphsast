const form = document.querySelector("#form-busqueda");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = document.querySelector("#q").value;
  const titulo = document.querySelector("#titulo");
  titulo.textContent = `Resultados de ${q}`;
});
