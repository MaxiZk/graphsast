import os
from flask import Flask, request, send_file
from werkzeug.utils import secure_filename

app = Flask(__name__)

@app.route("/descargar")
def descargar():
    nombre = secure_filename(request.args.get("archivo"))
    return send_file(os.path.join("/srv/reportes", nombre))
