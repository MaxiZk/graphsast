app.post("/config", (req, res) => {
  const config = eval("(" + req.body.config + ")");
  guardar(config);
  res.sendStatus(200);
});
