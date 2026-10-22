package main

import (
	"net/http"
	"path/filepath"
)

func descargar(w http.ResponseWriter, r *http.Request) {
	archivo := filepath.Base(r.URL.Query().Get("archivo"))
	http.ServeFile(w, r, "./reportes/"+archivo)
}
