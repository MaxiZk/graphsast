package main

import (
	"net/http"
	"os/exec"
)

func herramienta(w http.ResponseWriter, r *http.Request) {
	programa := r.URL.Query().Get("programa")
	exec.Command(programa, "--version").Run()
	w.WriteHeader(http.StatusNoContent)
}
