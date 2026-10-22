import os
from flask import Flask, request

app = Flask(__name__)

@app.route("/plantilla")
def plantilla():
    ruta = "plantillas/" + os.path.basename(request.args["nombre"])
    with open(ruta) as f:
        contenido = f.read()
    return {"contenido": contenido}
