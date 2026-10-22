from flask import Flask, request, jsonify
from pymongo import MongoClient

app = Flask(__name__)
db = MongoClient()["app"]

@app.post("/login")
def login():
    datos = request.get_json()
    usuario = db.usuarios.find_one({"usuario": datos["usuario"], "clave": datos["clave"]})
    return jsonify({"ok": usuario is not None})
