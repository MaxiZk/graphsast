package main

import (
	"html/template"
	"net/http"
)

var pagina = template.Must(template.New("p").Parse("<p>{{.}}</p>"))

func comentario(w http.ResponseWriter, r *http.Request) {
	texto := r.FormValue("texto")
	pagina.Execute(w, template.HTML(texto))
}
