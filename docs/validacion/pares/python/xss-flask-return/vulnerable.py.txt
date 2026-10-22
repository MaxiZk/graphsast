from flask import Flask, request

app = Flask(__name__)

@app.route("/saludo")
def saludo():
    nombre = request.args.get("nombre", "")
    return "<h1>Hola, " + nombre + "</h1>"
