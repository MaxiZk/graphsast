const { exec } = require("child_process");
const express = require("express");
const app = express();

app.post("/dns", (req, res) => {
  const dominio = req.body.dominio;
  exec(`nslookup ${dominio}`, (err, out) => res.type("text/plain").send(out));
});
