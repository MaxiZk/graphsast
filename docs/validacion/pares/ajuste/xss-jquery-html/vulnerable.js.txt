$(function () {
  $("#buscar").on("click", function () {
    var termino = $("#entrada").val();
    $("#resultado").html("Buscaste: " + termino);
  });
});
