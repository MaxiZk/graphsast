const express = require("express");
const User = require("./models/User");
const app = express();
app.use(express.json());

app.post("/login", async (req, res) => {
  const username = String(req.body.username);
  const password = String(req.body.password);
  const user = await User.findOne({ username, password });
  if (!user) return res.status(401).send("no");
  res.send("bienvenido");
});
