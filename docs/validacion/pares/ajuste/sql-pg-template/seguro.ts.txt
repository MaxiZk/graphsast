import express from "express";
import { Pool } from "pg";
const pool = new Pool();
const app = express();
app.use(express.json());

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE username = $1 AND password = $2", [username, password]);
  if (result.rows.length > 0) res.send("ok");
  else res.status(401).send("credenciales inválidas");
});
