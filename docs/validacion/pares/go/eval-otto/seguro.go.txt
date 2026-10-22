package main

import (
	"net/http"
	"strconv"
)

func calcular(w http.ResponseWriter, r *http.Request) {
	a, _ := strconv.ParseFloat(r.URL.Query().Get("a"), 64)
	b, _ := strconv.ParseFloat(r.URL.Query().Get("b"), 64)
	w.Write([]byte(strconv.FormatFloat(a+b, 'f', 2, 64)))
}
