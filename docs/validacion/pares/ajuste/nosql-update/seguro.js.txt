const { MongoClient } = require("mongodb");
const client = new MongoClient(process.env.MONGO_URL);

async function actualizarNombre(req, res) {
  const usuarios = client.db().collection("usuarios");
  await usuarios.updateOne({ email: String(req.body.email) }, { $set: { nombre: String(req.body.nombre) } });
  res.sendStatus(204);
}
module.exports = actualizarNombre;
