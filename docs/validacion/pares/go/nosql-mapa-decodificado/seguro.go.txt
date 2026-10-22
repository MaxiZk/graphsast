package main

import (
	"encoding/json"
	"net/http"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

var usuarios *mongo.Collection

type credenciales struct {
	Usuario string `json:"usuario"`
	Clave   string `json:"clave"`
}

func login(w http.ResponseWriter, r *http.Request) {
	var cred credenciales
	json.NewDecoder(r.Body).Decode(&cred)
	err := usuarios.FindOne(r.Context(), bson.M{"usuario": cred.Usuario, "clave": cred.Clave}).Err()
	json.NewEncoder(w).Encode(map[string]bool{"ok": err == nil})
}
