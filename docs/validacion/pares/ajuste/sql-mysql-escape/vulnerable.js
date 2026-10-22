const mysql = require("mysql2");
const pool = mysql.createPool({ database: "app" });

exports.borrar = (req, res) => {
  pool.execute("DELETE FROM notas WHERE id = " + req.body.id, (err) => {
    res.sendStatus(err ? 500 : 204);
  });
};
