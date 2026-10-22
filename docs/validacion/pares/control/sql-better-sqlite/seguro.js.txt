const Database = require("better-sqlite3");
const db = new Database("app.db");

function login(username, password) {
  const stmt = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?");
  return stmt.get(username, password);
}

module.exports = (req, res) => {
  const user = login(req.body.username, req.body.password);
  res.json({ ok: Boolean(user) });
};
