const Koa = require("koa");
const Router = require("@koa/router");
const { pool } = require("./db");
const app = new Koa();
const router = new Router();

router.get("/items", async (ctx) => {
  const { rows } = await pool.query("SELECT * FROM items WHERE owner = $1", [ctx.query.owner]);
  ctx.body = rows;
});
app.use(router.routes());
