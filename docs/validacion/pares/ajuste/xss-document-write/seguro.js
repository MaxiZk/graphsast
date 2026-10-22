var q = new URLSearchParams(location.search).get("q");
var h3 = document.createElement("h3");
h3.textContent = "Resultados para " + q;
document.body.appendChild(h3);
