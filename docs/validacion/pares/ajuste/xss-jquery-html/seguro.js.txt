$(function () {
  $("#buscar").on("click", function () {
    var termino = $("#entrada").val();
    $("#resultado").text("Buscaste: " + termino);
  });
});
