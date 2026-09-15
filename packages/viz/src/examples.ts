export interface DemoExample {
  id: string;
  title: string;
  description: string;
  code: string;
  expectFinding: boolean;
}

export const DEMO_EXAMPLES: DemoExample[] = [
  {
    id: "intra",
    title: "A · SQLi intra-procedural",
    description: "input fluye a db.query sin sanitizar.",
    expectFinding: true,
    code: `function handler(input) {
  const q = input;
  db.query(q);
}`,
  },
  {
    id: "inter",
    title: "B · SQLi inter-procedural",
    description:
      "El dato entra en handler y llega al sink dentro de otra función: el "
      + "grafo muestra el cruce que el código no evidencia.",
    expectFinding: true,
    code: `function sink(q) {
  db.query(q);
}

function handler(input) {
  sink(input);
}`,
  },
  {
    id: "safe-literal",
    title: "C · Sin vulnerabilidad",
    description: "El sink usa un literal, no el dato tainted.",
    expectFinding: false,
    code: `function handler(input) {
  db.query("SELECT 1");
}`,
  },
  {
    id: "sanitized",
    title: "D · Sanitizado",
    description: "sanitize() en el camino bloquea el hallazgo.",
    expectFinding: false,
    code: `function handler(input) {
  const safe = sanitize(input);
  db.query(safe);
}`,
  },
  {
    id: "req-body",
    title: "E · req.body (Express)",
    description: "Entrada HTTP vía req.body hasta db.query.",
    expectFinding: true,
    code: `function handler(req) {
  const q = req.body;
  db.query(q);
}`,
  },
  {
    id: "eval-sink",
    title: "F · eval (command injection)",
    description: "Parámetro de función llega a eval().",
    expectFinding: true,
    code: `function handler(input) {
  eval(input);
}`,
  },
  {
    id: "finance-app",
    title: "G · Finance App (Express)",
    description: "Modelo de tu API: req.body → persistencia Mongoose sin validar.",
    expectFinding: true,
    code: `function postFinances(req, res) {
  const data = req.body;
  Finance.create(data);
}

function putFinance(req, res) {
  const id = req.params.id;
  const data = req.body;
  Finance.findByIdAndUpdate(id, data);
}`,
  },
  {
    id: "express-arrow",
    title: "H · Express arrow callback",
    description: "app.post con async (req, res) => … — patrón real de rutas.",
    expectFinding: true,
    code: `app.post('/finances', async (req, res) => {
  const data = req.body;
  Finance.create(data);
});`,
  },
  {
    id: "xss",
    title: "I · XSS document.write",
    description: "CWE-79: salida HTML sin sanitizar.",
    expectFinding: true,
    code: `function render(msg) {
  document.write(msg);
}`,
  },
  {
    id: "finance-full",
    title: "G+ · Finance App completa",
    description: "Tres handlers Mongoose con scoping por función.",
    expectFinding: true,
    code: `function postFinances(req, res) {
  const data = req.body;
  Finance.create(data);
}
function putFinance(req, res) {
  const id = req.params.id;
  const data = req.body;
  Finance.findByIdAndUpdate(id, data);
}
function deleteFinance(req, res) {
  Finance.findByIdAndDelete(req.params.id);
}`,
  },
  {
    id: "template-sqli",
    title: "M1 · SQLi por template literal",
    description: "El dato se interpola en la query; el flujo cruza el template.",
    expectFinding: true,
    code: `app.get('/users/:id', async (req, res) => {
  const id = req.params.id;
  db.query(\`SELECT * FROM users WHERE id=\${id}\`);
});`,
  },
  {
    id: "concat-sqli",
    title: "M2 · SQLi por concatenación",
    description: "Concatenación de string con el dato de req.params.",
    expectFinding: true,
    code: `function getUser(req) {
  const id = req.params.id;
  db.query("SELECT * FROM users WHERE id=" + id);
}`,
  },
  {
    id: "class-handler",
    title: "M12 · Handler como método de clase",
    description: "El controlador es un método; req.body llega al sink.",
    expectFinding: true,
    code: `class UserController {
  handle(req) {
    db.query(req.body);
  }
}`,
  },
  {
    id: "naming-negative",
    title: "N1 · Nombre parecido a un sink",
    description: "evaluatePrice contiene 'eval' pero no es el sink eval.",
    expectFinding: false,
    code: `function h(input) {
  evaluatePrice(input);
}`,
  },
];

/**
 * Arranca en el caso inter-procedural: con el intra-procedural de tres líneas
 * el grafo no agrega nada que el código no muestre mejor. Acá el dato cruza
 * de `handler` a `sink` vía BINDS_TO, que es justamente lo que no se ve
 * leyendo el archivo de arriba abajo.
 */
export const DEFAULT_EXAMPLE_ID = "inter";

export function getExample(id: string): DemoExample {
  return DEMO_EXAMPLES.find((e) => e.id === id) ?? DEMO_EXAMPLES[0]!;
}
