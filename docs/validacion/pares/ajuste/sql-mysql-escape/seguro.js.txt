const mysql = require("mysql2");
const pool = mysql.createPool({ database: "app" });

exports.borrar = (req, res) => {
  pool.query("DELETE FROM notas WHERE id = " + mysql.escape(req.body.id), (err) => {
    res.sendStatus(err ? 500 : 204);
  });
};
