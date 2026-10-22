from flask import Flask, request
from markupsafe import escape

app = Flask(__name__)

@app.route("/saludo")
def saludo():
    nombre = request.args.get("nombre", "")
    return "<h1>Hola, " + escape(nombre) + "</h1>"
