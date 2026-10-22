package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

var db *sql.DB

func usuario(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	row := db.QueryRow("SELECT nombre FROM usuarios WHERE id = '" + id + "'")
	var nombre string
	row.Scan(&nombre)
	json.NewEncoder(w).Encode(map[string]string{"nombre": nombre})
}
