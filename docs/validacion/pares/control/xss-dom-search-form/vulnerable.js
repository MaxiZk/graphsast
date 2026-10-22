const form = document.querySelector("#form-busqueda");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = document.querySelector("#q").value;
  document.querySelector("#titulo").innerHTML = `Resultados de <b>${q}</b>`;
});
