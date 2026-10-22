app.post("/config", (req, res) => {
  const config = JSON.parse(req.body.config);
  guardar(config);
  res.sendStatus(200);
});
