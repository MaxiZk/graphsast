const { exec } = require("child_process");

exports.matar = (req, res) => {
  const pid = req.params.pid;
  exec("kill -9 " + pid, () => res.sendStatus(204));
};
