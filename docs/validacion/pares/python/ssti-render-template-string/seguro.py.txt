from flask import Flask, request, render_template_string

app = Flask(__name__)

@app.route("/hola")
def hola():
    nombre = request.args.get("nombre", "")
    return render_template_string("<p>Hola {{ nombre }}</p>", nombre=nombre)
