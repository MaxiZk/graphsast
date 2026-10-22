const express = require("express");
const User = require("./models/User");
const app = express();
app.use(express.json());

app.post("/login", async (req, res) => {
  const user = await User.findOne({ username: req.body.username, password: req.body.password });
  if (!user) return res.status(401).send("no");
  res.send("bienvenido");
});
