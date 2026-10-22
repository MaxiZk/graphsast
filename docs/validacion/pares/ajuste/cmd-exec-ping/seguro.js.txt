const express = require("express");
const { execFile } = require("child_process");
const app = express();

app.get("/ping", (req, res) => {
  execFile("ping", ["-c", "1", req.query.host], (error, stdout) => {
    res.type("text/plain").send(stdout);
  });
});
