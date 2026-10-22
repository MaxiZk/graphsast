package main

import (
	"net/http"

	"github.com/robertkrimen/otto"
)

func calcular(w http.ResponseWriter, r *http.Request) {
	expresion := r.URL.Query().Get("expr")
	vm := otto.New()
	vm.Run(expresion)
	w.WriteHeader(http.StatusOK)
}
