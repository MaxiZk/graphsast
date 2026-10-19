export interface DemoExample {
  id: string;
  title: string;
  /** Qué mirar: el ataque en el vulnerable, qué cambió en el corregido. */
  description: string;
  code: string;
  expectFinding: boolean;
  /** Familia CWE que tiene que encontrar (vulnerables) o que deja de encontrar (corregidos). */
  cwe: number;
  /** El otro ejemplo del par vulnerable/corregido. */
  pair?: string;
}

/**
 * Cada vulnerabilidad viene en dos versiones que difieren en una línea: la
 * vulnerable y la corregida. Comparar los dos grafos muestra dónde se corta
 * el camino, que es lo que la demo tiene que enseñar.
 */
const SQLI = `// GET /usuarios?id=7
app.get("/usuarios", (req, res) => {
  const id = req.query.id;
  db.query("SELECT * FROM usuarios WHERE id = " + id, (err, filas) => res.json(filas));
});`;

const XSS = `// GET /saludo?nombre=Ana
app.get("/saludo", (req, res) => {
  const nombre = req.query.nombre;
  res.send("<h1>Hola, " + nombre + "</h1>");
});`;

const NOSQL = `// POST /login con { "email": "...", "password": "..." }
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const usuario = await User.findOne({ email: email, password: password });
  res.json({ ok: Boolean(usuario) });
});`;

const CMDI = `// GET /ping?host=8.8.8.8
app.get("/ping", (req, res) => {
  const host = req.query.host;
  // (el host no se valida)
  exec("ping -c 1 " + host);
  res.send("Ping enviado");
});`;

const PATH_TRAVERSAL = `// GET /archivos?nombre=manual.pdf
app.get("/archivos", (req, res) => {
  const nombre = req.query.nombre;
  res.send(fs.readFileSync("./archivos/" + nombre));
});`;

const CODE_INJECTION = `// GET /calcular?expr=2*3
app.get("/calcular", (req, res) => {
  const expr = req.query.expr;
  res.json({ resultado: eval(expr) });
});`;

/** El dato entra por el constructor, queda en la instancia y se usa en otro método. */
const CAMPO_DE_CLASE = `class Reportes {
  constructor(carpeta) { this.carpeta = carpeta; }
  comprimir() { exec("tar -czf reporte.tgz " + this.carpeta); }
}

app.post("/reportes", (req, res) => {
  new Reportes(req.body.carpeta).comprimir();
  res.send("Reporte en preparación");
});`;

/** El dato cruza dos funciones antes de llegar a la consulta. */
const ENTRE_FUNCIONES = `function buscarUsuario(req) {
  const id = req.params.id;
  return consultarUsuario(id);
}

function consultarUsuario(id) {
  return db.query("SELECT * FROM usuarios WHERE id = " + id);
}`;

export const DEMO_EXAMPLES: DemoExample[] = [
  {
    id: "sqli",
    title: "SQL Injection · vulnerable",
    description:
      "El id de la URL se pega al texto de la consulta. Con ?id=1 OR 1=1 la "
      + "consulta devuelve todos los usuarios.",
    expectFinding: true,
    cwe: 89,
    pair: "sqli-fixed",
    code: SQLI,
  },
  {
    id: "sqli-fixed",
    title: "SQL Injection · corregido",
    description:
      "La misma consulta con un parámetro (?): el id viaja aparte del texto SQL "
      + "y la base lo trata como un valor. No hay hallazgo.",
    expectFinding: false,
    cwe: 89,
    pair: "sqli",
    code: SQLI.replace(
      'db.query("SELECT * FROM usuarios WHERE id = " + id, ',
      'db.query("SELECT * FROM usuarios WHERE id = ?", [id], ',
    ),
  },
  {
    id: "xss",
    title: "XSS · vulnerable",
    description:
      "El nombre de la URL vuelve dentro del HTML. Con "
      + "?nombre=<script>alert(1)</script> el navegador ejecuta el script.",
    expectFinding: true,
    cwe: 79,
    pair: "xss-fixed",
    code: XSS,
  },
  {
    id: "xss-fixed",
    title: "XSS · corregido",
    description:
      "El nombre pasa por escapeHtml() antes de entrar al HTML: el < llega como "
      + "&lt; y se muestra como texto. No hay hallazgo.",
    expectFinding: false,
    cwe: 79,
    pair: "xss",
    code: XSS.replace("const nombre = req.query.nombre;", "const nombre = escapeHtml(req.query.nombre);"),
  },
  {
    id: "nosql",
    title: "NoSQL Injection · vulnerable",
    description:
      'El login le pasa a MongoDB lo que vino en el JSON. Con "password": '
      + '{"$ne": null} la condición vale para cualquier usuario y entra sin contraseña.',
    expectFinding: true,
    cwe: 943,
    pair: "nosql-fixed",
    code: NOSQL,
  },
  {
    id: "nosql-fixed",
    title: "NoSQL Injection · corregido",
    description:
      "String() convierte cada campo en texto: un objeto como {\"$ne\": null} ya "
      + "no llega como operador. No hay hallazgo.",
    expectFinding: false,
    cwe: 943,
    pair: "nosql",
    code: NOSQL.replace(
      "User.findOne({ email: email, password: password })",
      "User.findOne({ email: String(email), password: String(password) })",
    ),
  },
  {
    id: "cmdi",
    title: "Command Injection · vulnerable",
    description:
      "El host de la URL se pega a un comando del sistema. Con "
      + "?host=8.8.8.8; cat /etc/passwd el servidor ejecuta también el segundo comando.",
    expectFinding: true,
    cwe: 78,
    pair: "cmdi-fixed",
    code: CMDI,
  },
  {
    id: "cmdi-fixed",
    title: "Command Injection · corregido",
    description:
      "Antes de usar el host se valida con una regex anclada (solo letras, números, "
      + "punto y guion) y, si no pasa, se corta. El ; nunca llega al comando. No hay hallazgo.",
    expectFinding: false,
    cwe: 78,
    pair: "cmdi",
    code: CMDI.replace(
      "  // (el host no se valida)",
      '  if (!/^[\\w.-]+$/.test(host)) return res.status(400).send("Host inválido");',
    ),
  },
  {
    id: "path",
    title: "Path Traversal · vulnerable",
    description:
      "El nombre de la URL arma la ruta del archivo. Con ?nombre=../../etc/passwd "
      + "el servidor devuelve un archivo de fuera de la carpeta.",
    expectFinding: true,
    cwe: 22,
    pair: "path-fixed",
    code: PATH_TRAVERSAL,
  },
  {
    id: "path-fixed",
    title: "Path Traversal · corregido",
    description:
      "path.basename() se queda solo con el nombre del archivo: ../../etc/passwd "
      + "pasa a ser passwd, que se busca dentro de la carpeta. No hay hallazgo.",
    expectFinding: false,
    cwe: 22,
    pair: "path",
    code: PATH_TRAVERSAL.replace(
      "const nombre = req.query.nombre;",
      "const nombre = path.basename(req.query.nombre);",
    ),
  },
  {
    id: "code",
    title: "Code Injection · vulnerable",
    description:
      "La expresión de la URL se ejecuta con eval. Con "
      + "?expr=process.exit() el atacante apaga el servidor; con require(...) corre lo que quiera.",
    expectFinding: true,
    cwe: 95,
    code: CODE_INJECTION,
  },
  {
    id: "clase",
    title: "Campo de clase · vulnerable",
    description:
      "El dato entra por el constructor, queda guardado en this.carpeta y se usa "
      + "en otro método. GraphSAST lo sigue a través del campo.",
    expectFinding: true,
    cwe: 78,
    code: CAMPO_DE_CLASE,
  },
  {
    id: "vulnerable",
    title: "Entre funciones · vulnerable",
    description:
      "El id de la URL pasa a otra función y recién ahí llega a la consulta. "
      + "GraphSAST sigue el dato a través de la llamada.",
    expectFinding: true,
    cwe: 89,
    pair: "sanitized",
    code: ENTRE_FUNCIONES,
  },
  {
    id: "sanitized",
    title: "Entre funciones · corregido",
    description:
      "El mismo código, pero el id pasa por sanitize() antes de la llamada: "
      + "el camino se corta y no hay hallazgo.",
    expectFinding: false,
    cwe: 89,
    pair: "vulnerable",
    code: ENTRE_FUNCIONES.replace("const id = req.params.id;", "const id = sanitize(req.params.id);"),
  },
];

/** Arranca en una vulnerabilidad: sin hallazgo no hay camino que mirar. */
export const DEFAULT_EXAMPLE_ID = "sqli";

export function getExample(id: string): DemoExample {
  return DEMO_EXAMPLES.find((e) => e.id === id) ?? DEMO_EXAMPLES[0]!;
}
