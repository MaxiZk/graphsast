const express = require("express");
const mysql = require("mysql");
const app = express();
const connection = mysql.createConnection({ host: "localhost", user: "root", database: "shop" });

app.get("/user/:id", (req, res) => {
  connection.query("SELECT * FROM users WHERE id = ?", [req.params.id], (err, rows) => {
    if (err) return res.status(500).send("error");
    res.json(rows);
  });
});
app.listen(3000);
