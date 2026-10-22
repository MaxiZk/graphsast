package main

import (
	"net/http"
	"text/template"
)

func vista(w http.ResponseWriter, r *http.Request) {
	plantilla := r.FormValue("plantilla")
	t, _ := template.New("vista").Parse(plantilla)
	t.Execute(w, nil)
}
