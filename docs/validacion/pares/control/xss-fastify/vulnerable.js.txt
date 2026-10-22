const fastify = require("fastify")();

fastify.get("/saludo", async (request, reply) => {
  reply.type("text/html").send("<p>Hola, " + request.query.nombre + "</p>");
});
fastify.listen({ port: 3000 });
