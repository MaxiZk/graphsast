const knex = require("knex")({ client: "pg" });
const express = require("express");
const app = express();

app.get("/orders", async (req, res) => {
  const orders = await knex("orders").where({ customer: req.query.customer });
  res.json(orders);
});
