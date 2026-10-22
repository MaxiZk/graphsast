package main

import "net/http"

func descargar(w http.ResponseWriter, r *http.Request) {
	archivo := r.URL.Query().Get("archivo")
	http.ServeFile(w, r, "./reportes/"+archivo)
}
