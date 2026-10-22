const sqlite3 = require("sqlite3");
const db = new sqlite3.Database("app.db");
const express = require("express");
const router = express.Router();

router.get("/search", (req, res) => {
  const term = req.query.q;
  const sql = "SELECT name, price FROM products WHERE name LIKE ?";
  db.all(sql, ["%" + term + "%"], (err, rows) => res.json(rows));
});
module.exports = router;
