from flask import Flask, request

app = Flask(__name__)

@app.route("/calcular")
def calcular():
    expresion = request.args.get("expr")
    return {"resultado": eval(expresion)}
