package main

import (
	"fmt"
	"net/http"
)

func saludo(w http.ResponseWriter, r *http.Request) {
	nombre := r.URL.Query().Get("nombre")
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprintf(w, "<h1>Hola, %s</h1>", nombre)
}
