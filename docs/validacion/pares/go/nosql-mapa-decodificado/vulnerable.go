package main

import (
	"encoding/json"
	"net/http"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

var usuarios *mongo.Collection

func login(w http.ResponseWriter, r *http.Request) {
	var filtro bson.M
	json.NewDecoder(r.Body).Decode(&filtro)
	err := usuarios.FindOne(r.Context(), filtro).Err()
	json.NewEncoder(w).Encode(map[string]bool{"ok": err == nil})
}
