import shlex
import os
from fastapi import FastAPI

app = FastAPI()

@app.post("/backup")
def backup(nombre: str):
    os.system("tar -czf /backups/" + shlex.quote(nombre) + ".tgz /data")
    return {"ok": True}
