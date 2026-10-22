package main

import (
	"net/http"
	"text/template"
)

func vista(w http.ResponseWriter, r *http.Request) {
	nombre := r.FormValue("nombre")
	t, _ := template.New("vista").Parse("Hola {{.}}")
	t.Execute(w, nombre)
}
