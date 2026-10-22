package main

import (
	"net/http"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

var notas *mongo.Collection

func buscar(w http.ResponseWriter, r *http.Request) {
	autor := r.URL.Query().Get("autor")
	notas.Find(r.Context(), bson.M{"$where": "this.autor == '" + autor + "'"})
	w.WriteHeader(http.StatusOK)
}
