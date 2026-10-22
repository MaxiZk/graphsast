import os
from flask import Flask, request, send_file

app = Flask(__name__)

@app.route("/descargar")
def descargar():
    nombre = request.args.get("archivo")
    return send_file(os.path.join("/srv/reportes", nombre))
