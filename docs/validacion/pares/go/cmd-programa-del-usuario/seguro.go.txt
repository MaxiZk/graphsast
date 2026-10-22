package main

import (
	"net/http"
	"os/exec"
)

var permitidos = map[string]string{"git": "/usr/bin/git", "go": "/usr/local/go/bin/go"}

func herramienta(w http.ResponseWriter, r *http.Request) {
	ruta, ok := permitidos["git"]
	if !ok {
		http.Error(w, "no permitido", http.StatusBadRequest)
		return
	}
	exec.Command(ruta, "--version").Run()
	w.WriteHeader(http.StatusNoContent)
}
