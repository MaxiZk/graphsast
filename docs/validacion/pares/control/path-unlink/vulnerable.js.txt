const fs = require("fs");
const express = require("express");
const app = express();

app.delete("/subidas/:archivo", (req, res) => {
  fs.unlinkSync("uploads/" + req.params.archivo);
  res.sendStatus(204);
});
