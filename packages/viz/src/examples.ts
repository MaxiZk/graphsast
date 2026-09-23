export interface DemoExample {
  id: string;
  title: string;
  description: string;
  code: string;
  expectFinding: boolean;
}

/**
 * La misma función en dos versiones que difieren en una línea: el id de la URL
 * llega a la consulta pasando por otra función, y en la segunda versión pasa
 * antes por sanitize(). Comparar los dos grafos muestra dónde se corta el
 * camino, que es lo que la demo tiene que enseñar.
 */
const CONSULTA = `function buscarUsuario(req) {
  const id = req.params.id;
  return consultarUsuario(id);
}

function consultarUsuario(id) {
  return db.query("SELECT * FROM usuarios WHERE id = " + id);
}`;

export const DEMO_EXAMPLES: DemoExample[] = [
  {
    id: "vulnerable",
    title: "Con vulnerabilidad (SQL Injection)",
    description:
      "El id de la URL pasa a otra función y llega a db.query concatenado en "
      + "la consulta, sin sanitizar.",
    expectFinding: true,
    code: CONSULTA,
  },
  {
    id: "sanitized",
    title: "Sanitizado",
    description:
      "El mismo código, pero el id pasa por sanitize() antes de la consulta: "
      + "el camino se corta y no hay hallazgo.",
    expectFinding: false,
    code: CONSULTA.replace("const id = req.params.id;", "const id = sanitize(req.params.id);"),
  },
];

/** Arranca en la versión vulnerable: sin hallazgo no hay camino que mirar. */
export const DEFAULT_EXAMPLE_ID = "vulnerable";

export function getExample(id: string): DemoExample {
  return DEMO_EXAMPLES.find((e) => e.id === id) ?? DEMO_EXAMPLES[0]!;
}
