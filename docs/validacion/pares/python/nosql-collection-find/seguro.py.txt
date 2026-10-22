from flask import Flask, request, jsonify
from pymongo import MongoClient

app = Flask(__name__)
productos = MongoClient()["tienda"]["productos"]

@app.post("/buscar")
def buscar():
    categoria = str(request.json.get("categoria"))
    return jsonify(list(productos.find({"categoria": categoria})))
