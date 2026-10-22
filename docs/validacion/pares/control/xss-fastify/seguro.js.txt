const fastify = require("fastify")();
const escapeHtml = require("escape-html");

fastify.get("/saludo", async (request, reply) => {
  reply.type("text/html").send("<p>Hola, " + escapeHtml(request.query.nombre) + "</p>");
});
fastify.listen({ port: 3000 });
