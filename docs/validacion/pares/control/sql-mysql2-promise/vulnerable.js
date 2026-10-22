const mysql = require("mysql2/promise");

async function getOrders(req, res) {
  const conn = await mysql.createConnection({ host: "db", user: "app" });
  const [rows] = await conn.query(`SELECT * FROM orders WHERE status = '${req.query.status}'`);
  res.json(rows);
}
module.exports = { getOrders };
