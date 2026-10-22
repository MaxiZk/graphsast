from flask import Flask, request, jsonify
from pymongo import MongoClient

app = Flask(__name__)
productos = MongoClient()["tienda"]["productos"]

@app.post("/buscar")
def buscar():
    filtro = request.json.get("filtro")
    return jsonify(list(productos.find(filtro)))
