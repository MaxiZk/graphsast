package main

import (
	"net/http"
	"os"
	"path/filepath"
)

func documento(w http.ResponseWriter, r *http.Request) {
	nombre := filepath.Base(r.URL.Query().Get("nombre"))
	datos, err := os.ReadFile(filepath.Join("/srv/docs", nombre))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	w.Write(datos)
}
