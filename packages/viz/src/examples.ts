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
    description: "El dato cruza funciones vía BINDS_TO.",
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
];

export const DEFAULT_EXAMPLE_ID = "intra";

export function getExample(id: string): DemoExample {
  return DEMO_EXAMPLES.find((e) => e.id === id) ?? DEMO_EXAMPLES[0]!;
}
