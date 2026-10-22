document.addEventListener("DOMContentLoaded", () => {
  const seccion = decodeURIComponent(window.location.hash.substring(1));
  document.getElementById("titulo").innerHTML = "Sección: " + seccion;
});
