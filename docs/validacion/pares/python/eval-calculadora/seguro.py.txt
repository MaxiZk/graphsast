from flask import Flask, request

app = Flask(__name__)

@app.route("/calcular")
def calcular():
    a = float(request.args.get("a"))
    b = float(request.args.get("b"))
    return {"resultado": a + b}
