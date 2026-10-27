import { describe, it, expect } from "vitest";
import { analyzeGraph } from "../ir/graph.js";
import { analyzeTaint } from "../taint/analyzer.js";

/**
 * Falsos positivos encontrados al analizar proyectos reales de GitHub (DVNA,
 * dvws-node, Juice Shop, hackathon-starter...). Cada caso fija qué deja de
 * marcarse y, al lado, qué tiene que seguir marcándose.
 */
function cwesOf(code: string): number[] {
  return analyzeTaint(analyzeGraph(code, "t.js")).map((f) => f.cwe!).sort();
}

const handler = (body: string) => `app.post("/x", async (req, res) => {\n${body}\n});`;

describe("inserciones: el body entero sí, campos elegidos no", () => {
  it("create con un objeto armado campo por campo no es hallazgo", () => {
    expect(cwesOf(handler(`await User.create({ email: req.body.email, name: req.body.name });`))).toEqual([]);
  });

  it("create con el body entero, o con un spread del body, sí", () => {
    expect(cwesOf(handler(`await User.create(req.body);`))).toEqual([943]);
    expect(cwesOf(handler(`await User.create({ ...req.body, role: "user" });`))).toEqual([943]);
  });

  it("save después de asignar campos sueltos no es hallazgo", () => {
    expect(cwesOf(handler(`
  const user = await User.findById(req.user.id);
  user.email = req.body.email;
  await user.save();`))).toEqual([]);
    expect(cwesOf(handler(`
  const product = new Product();
  product.name = req.body.name;
  await product.save();`))).toEqual([]);
  });

  it("save de un documento armado con el body entero sí", () => {
    expect(cwesOf(handler(`const finance = new Finance(req.body);\n  await finance.save();`))).toEqual([943]);
  });

  it("las consultas de un repositorio de ORM (TypeORM) no son MongoDB", () => {
    expect(cwesOf(handler(`await this.userRepository.findOne({ username: req.query.author });`))).toEqual([]);
    expect(cwesOf(handler(`await repo.find({ where: { id: req.params.id } });`))).toEqual([]);
    expect(cwesOf(handler(`await users.findOne({ username: req.query.author });`))).toEqual([943]);
  });

  it("save que recibe el dato como argumento sí, salvo en un repositorio de ORM", () => {
    expect(cwesOf(handler(`await store.save(req.body);`))).toEqual([943]);
    expect(cwesOf(handler(`await store.save({ name: req.body.name });`))).toEqual([]);
    // TypeORM: guardar una entidad arma un INSERT/UPDATE con parámetros.
    expect(cwesOf(handler(`await repo.save(req.body);`))).toEqual([]);
    expect(cwesOf(handler(`await this.userRepository.save(req.body);`))).toEqual([]);
  });

  it("save con un callback no recibe el dato: req.session.save(() => ...) no es hallazgo", () => {
    expect(cwesOf(handler(`req.session.user = req.body.user;\n  req.session.save(() => res.redirect("/"));`))).toEqual([]);
    expect(cwesOf(handler(`req.session.save(function () { res.redirect("/" + req.query.next); });`))).toEqual([]);
  });
});

describe("consultas que no pueden recibir operadores", () => {
  it("$eq compara el valor tal cual: no es hallazgo", () => {
    expect(cwesOf(handler(`await User.findOne({ email: { $eq: req.body.email } });`))).toEqual([]);
    expect(cwesOf(handler(`await User.findOne({ email: { "$eq": req.body.email } });`))).toEqual([]);
  });

  it("$eq protege solo el valor que envuelve", () => {
    expect(cwesOf(handler(`await User.findOne({ email: { $eq: req.body.email }, role: req.body.role });`))).toEqual([943]);
  });

  it("$eq no corta el dato para otras familias", () => {
    expect(cwesOf(handler(`const q = { $eq: req.query.name };\n  res.send("<p>" + q + "</p>");`))).toEqual([79]);
  });

  it("findOne({ where }) es Sequelize, SQL con parámetros: no es NoSQL", () => {
    expect(cwesOf(handler(`await UserModel.findOne({ where: { email: req.body.email } });`))).toEqual([]);
    expect(cwesOf(handler(`await db.User.findOne({ 'where': { login: req.body.login } });`))).toEqual([]);
  });

  it("la misma consulta sin where sigue siendo NoSQL, y $where también", () => {
    expect(cwesOf(handler(`await User.findOne({ email: req.body.email });`))).toEqual([943]);
    expect(cwesOf(handler(`await User.findOne({ $where: "this.name == '" + req.body.name + "'" });`))).toEqual([943]);
  });
});

describe("res.send de un objeto responde JSON, no HTML", () => {
  it("objetos y arrays literales no son XSS", () => {
    expect(cwesOf(handler(`res.send({ name: req.body.name });`))).toEqual([]);
    expect(cwesOf(handler(`res.status(400).send({ error: "No existe " + req.query.id });`))).toEqual([]);
    expect(cwesOf(handler(`res.send([req.query.a, req.query.b]);`))).toEqual([]);
  });

  it("un texto armado con el dato sí", () => {
    expect(cwesOf(handler(`res.send("<h1>" + req.query.name + "</h1>");`))).toEqual([79]);
    expect(cwesOf(handler(`res.send(\`<h1>\${req.query.name}</h1>\`);`))).toEqual([79]);
  });
});
