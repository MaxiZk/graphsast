const { exec } = require("child_process");

exports.matar = (req, res) => {
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid)) return res.sendStatus(400);
  exec("kill -9 " + pid, () => res.sendStatus(204));
};
