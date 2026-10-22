import sqlite3
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/productos")
def productos():
    categoria = request.args.get("categoria", "")
    conn = sqlite3.connect("tienda.db")
    filas = conn.execute("SELECT nombre, precio FROM productos WHERE categoria = ?", (categoria,)).fetchall()
    return jsonify(filas)
