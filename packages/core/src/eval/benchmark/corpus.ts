import type { BenchmarkCase } from "../types.js";

/**
 * Banco de pruebas sintético para validación cuantitativa (sección 8, GraphSAST_Proyecto.md).
 * Cada caso es un snippet autocontenido con etiqueta ground-truth.
 */
export const BENCHMARK_CORPUS: BenchmarkCase[] = [
  {
    id: "A",
    title: "SQLi intra-procedural",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "intra"],
    code: `function handler(input) {
  const q = input;
  db.query(q);
}`,
  },
  {
    id: "B",
    title: "SQLi inter-procedural",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "inter"],
    code: `function sink(q) {
  db.query(q);
}

function handler(input) {
  sink(input);
}`,
  },
  {
    id: "C",
    title: "Sink con literal (seguro)",
    label: "safe",
    cwe: "CWE-89",
    tags: ["sqli", "negative"],
    code: `function handler(input) {
  db.query("SELECT 1");
}`,
  },
  {
    id: "D",
    title: "Sanitizado en el camino",
    label: "safe",
    cwe: "CWE-89",
    tags: ["sqli", "sanitizer"],
    code: `function handler(input) {
  const safe = sanitize(input);
  db.query(safe);
}`,
  },
  {
    id: "E",
    title: "req.body → SQLi",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "express"],
    code: `function handler(req) {
  const q = req.body;
  db.query(q);
}`,
  },
  {
    id: "F",
    title: "eval / command injection",
    label: "vulnerable",
    cwe: "CWE-78",
    tags: ["cmdi"],
    code: `function handler(input) {
  eval(input);
}`,
  },
  {
    id: "G1",
    title: "Mongoose create",
    label: "vulnerable",
    cwe: "CWE-20",
    tags: ["mongoose", "express"],
    code: `function postFinances(req) {
  const data = req.body;
  Finance.create(data);
}`,
  },
  {
    id: "G3",
    title: "Finance App — tres handlers",
    label: "vulnerable",
    cwe: "CWE-20",
    tags: ["mongoose", "express", "multi-handler"],
    minFindings: 3,
    maxFindings: 3,
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
    id: "H-create",
    title: "Express arrow + Finance.create",
    label: "vulnerable",
    cwe: "CWE-20",
    tags: ["express", "arrow"],
    code: `app.post('/finances', async (req, res) => {
  const data = req.body;
  Finance.create(data);
});`,
    file: "routes.js",
  },
  {
    id: "H-save",
    title: "Express arrow + new/save",
    label: "vulnerable",
    cwe: "CWE-20",
    tags: ["express", "arrow", "mongoose"],
    code: `app.post('/finances', async (req, res) => {
  const finance = new Finance(req.body);
  await finance.save();
});`,
    file: "routes.js",
  },
  {
    id: "I",
    title: "XSS document.write",
    label: "vulnerable",
    cwe: "CWE-79",
    tags: ["xss"],
    code: `function render(msg) {
  document.write(msg);
}`,
  },
  {
    id: "J",
    title: "Parámetro res no es source",
    label: "safe",
    tags: ["express", "negative"],
    code: `function handler(res) {
  db.query("SELECT 1");
}`,
  },
  {
    id: "K",
    title: "Dos funciones — sin cruce espurio",
    label: "safe",
    tags: ["scope", "negative"],
    code: `function safeHandler(input) {
  db.query("SELECT 1");
}
function other(data) {
  const x = data;
}`,
  },
  {
    id: "L",
    title: "req.params.id directo al sink",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "express"],
    code: `function handler(req) {
  db.query(req.params.id);
}`,
  },
];

export function corpusStats() {
  const vulnerable = BENCHMARK_CORPUS.filter((c) => c.label === "vulnerable").length;
  const safe = BENCHMARK_CORPUS.filter((c) => c.label === "safe").length;
  const lines = BENCHMARK_CORPUS.reduce(
    (n, c) => n + c.code.split("\n").length,
    0,
  );
  return { total: BENCHMARK_CORPUS.length, vulnerable, safe, lines };
}
