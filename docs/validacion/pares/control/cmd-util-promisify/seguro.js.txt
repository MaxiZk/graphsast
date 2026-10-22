const util = require("util");
const execFile = util.promisify(require("child_process").execFile);

async function comprimir(req, res) {
  const nombre = req.body.nombre;
  await execFile("tar", ["-czf", `/backups/${nombre}.tgz`, "/data"]);
  res.send("ok");
}
module.exports = comprimir;
