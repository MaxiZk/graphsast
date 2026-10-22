const { execSync } = require("child_process");
const express = require("express");
const app = express();

app.get("/historial", (req, res) => {
  const rama = req.query.rama;
  const log = execSync("git log --oneline " + rama, { encoding: "utf8" });
  res.type("text/plain").send(log);
});
