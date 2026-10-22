const util = require("util");
const exec = util.promisify(require("child_process").exec);

async function comprimir(req, res) {
  const nombre = req.body.nombre;
  await exec(`tar -czf /backups/${nombre}.tgz /data`);
  res.send("ok");
}
module.exports = comprimir;
