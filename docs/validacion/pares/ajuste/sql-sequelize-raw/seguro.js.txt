const { Sequelize, QueryTypes } = require("sequelize");
const sequelize = new Sequelize("sqlite::memory:");

async function buscarProductos(req, res) {
  const nombre = req.query.nombre;
  const productos = await sequelize.query("SELECT * FROM products WHERE name = :nombre", {
    replacements: { nombre },
    type: QueryTypes.SELECT,
  });
  res.json(productos);
}
module.exports = { buscarProductos };
