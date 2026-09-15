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
  // ── Patrones realistas (antes falsos negativos por matching textual) ──
  {
    id: "M1",
    title: "SQLi por template literal",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "template-literal", "express"],
    code: `function h(req) {
  db.query(\`SELECT * FROM users WHERE id=\${req.params.id}\`);
}`,
  },
  {
    id: "M2",
    title: "SQLi por concatenación de strings",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "concat", "express"],
    code: `function h(req) {
  const id = req.params.id;
  db.query("SELECT * FROM users WHERE id=" + id);
}`,
  },
  {
    id: "M3",
    title: "Asignación posterior a la declaración",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "assignment"],
    code: `function h(req) {
  let q;
  q = req.body;
  db.query(q);
}`,
  },
  {
    id: "M4",
    title: "Taint dentro de object literal",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "object"],
    code: `function h(req) {
  const o = { q: req.body };
  db.query(o.q);
}`,
  },
  {
    id: "M5",
    title: "Taint dentro de array literal",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "array"],
    code: `function h(req) {
  const a = [req.body];
  db.query(a[0]);
}`,
  },
  {
    id: "M6",
    title: "Flujo a través de await",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "async"],
    code: `async function h(req) {
  const d = await load(req.body);
  db.query(d);
}`,
  },
  {
    id: "M7",
    title: "Destructuring de req.params",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "destructuring", "express"],
    code: `function h(req) {
  const { id } = req.params;
  db.query(id);
}`,
  },
  {
    id: "M8",
    title: "Llamada anidada como argumento",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "nested-call"],
    code: `function h(req) {
  db.query(String(req.body));
}`,
  },
  {
    id: "M9",
    title: "Constructor de query con dos argumentos",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "multi-arg"],
    code: `function h(req) {
  const q = build(req.body, 1);
  db.query(q);
}`,
  },
  {
    id: "M10",
    title: "Source req.headers",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "express", "headers"],
    code: `function h(req) {
  const q = req.headers.authorization;
  db.query(q);
}`,
  },
  {
    id: "M11",
    title: "Source req.cookies",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "express", "cookies"],
    code: `function h(req) {
  const q = req.cookies.session;
  db.query(q);
}`,
  },
  {
    id: "M12",
    title: "Método de clase como handler",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "class-method"],
    code: `class UserController {
  handle(req) {
    db.query(req.body);
  }
}`,
  },
  {
    id: "M13",
    title: "Sanitizer en rama paralela no protege el sink",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "sanitizer", "unsound-path"],
    code: `function h(req) {
  const a = req.body;
  const b = sanitize(a);
  db.query(a);
}`,
  },
  {
    id: "M14",
    title: "Nombre que contiene 'escape' no sanitiza",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["sqli", "sanitizer", "naming"],
    code: `function h(req) {
  const q = escapeNothing(req.body);
  db.query(q);
}`,
  },

  // ── Negativos: nombres que antes disparaban por coincidencia de substring ──
  {
    id: "N1",
    title: "evaluatePrice no es el sink eval",
    label: "safe",
    tags: ["negative", "naming", "cmdi"],
    code: `function h(input) {
  evaluatePrice(input);
}`,
  },
  {
    id: "N2",
    title: "myExecutor no es el sink exec",
    label: "safe",
    tags: ["negative", "naming", "cmdi"],
    code: `function h(input) {
  myExecutor(input);
}`,
  },
  {
    id: "N3",
    title: "spawnConfetti no es el sink spawn",
    label: "safe",
    tags: ["negative", "naming", "cmdi"],
    code: `function h(input) {
  spawnConfetti(input);
}`,
  },
  {
    id: "N4",
    title: "Concatenación solo de literales",
    label: "safe",
    tags: ["negative", "sqli"],
    code: `function h(input) {
  db.query("SELECT " + "1");
}`,
  },
  {
    id: "N5",
    title: "Sanitizado con validator.escape",
    label: "safe",
    cwe: "CWE-89",
    tags: ["negative", "sanitizer", "sqli"],
    code: `function h(req) {
  const q = validator.escape(req.body);
  db.query(q);
}`,
  },

  // ── Ámbito de bloque: dos declaraciones del mismo nombre en bloques
  //    hermanos no son la misma variable. S1 y S2 cubren el falso positivo
  //    que el corpus no detectaba; S3–S5 impiden que la corrección se pase
  //    de precisa y empiece a perder hallazgos reales.
  {
    id: "S1",
    title: "Dos `const x` en `case` hermanos (sin camino real)",
    label: "safe",
    cwe: "CWE-89",
    tags: ["negative", "scope", "block", "sqli"],
    code: `function handler(req, res) {
  switch (req.query.mode) {
    case "a": {
      const x = "literal-seguro";
      db.query(x);
      break;
    }
    case "b": {
      const x = req.query.evil;
      console.log(x);
      break;
    }
  }
}`,
  },
  {
    id: "S2",
    title: "Dos `const v` en las ramas de un `if` (sin camino real)",
    label: "safe",
    cwe: "CWE-89",
    tags: ["negative", "scope", "block", "sqli"],
    code: `function handler(req) {
  if (req.flag) {
    const v = "literal-seguro";
    db.query(v);
  } else {
    const v = req.query.evil;
    console.log(v);
  }
}`,
  },
  {
    id: "S3",
    title: "Taint y sink dentro del mismo bloque",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["scope", "block", "sqli"],
    code: `function handler(req) {
  switch (req.query.mode) {
    case "b": {
      const x = req.query.evil;
      db.query(x);
      break;
    }
  }
}`,
  },
  {
    id: "S4",
    title: "`var` izado fuera de su bloque hasta el sink",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["scope", "hoisting", "sqli"],
    code: `function handler(req) {
  if (req.flag) {
    var v = req.query.evil;
  }
  db.query(v);
}`,
  },
  // ── XSS por escritura de propiedad y JSX: cobertura que el catálogo
  //    declaraba pero el motor no podía ejercer.
  {
    id: "X1",
    title: "innerHTML con dato no confiable",
    label: "vulnerable",
    cwe: "CWE-79",
    tags: ["xss", "property-write"],
    code: `function h(req) {
  const el = document.getElementById("a");
  el.innerHTML = req.query.x;
}`,
  },
  {
    id: "X2",
    title: "innerHTML con literal",
    label: "safe",
    cwe: "CWE-79",
    tags: ["negative", "xss", "property-write"],
    code: `function h(req) {
  const el = document.getElementById("a");
  el.innerHTML = "<b>hola</b>";
}`,
  },
  {
    id: "X3",
    title: "dangerouslySetInnerHTML con dato no confiable",
    label: "vulnerable",
    cwe: "CWE-79",
    file: "componente.tsx",
    tags: ["xss", "jsx", "react"],
    code: `function Card({ req }) {
  return <div dangerouslySetInnerHTML={{ __html: req.query.bio }} />;
}`,
  },
  {
    id: "X4",
    title: "dangerouslySetInnerHTML sanitizado con DOMPurify",
    label: "safe",
    cwe: "CWE-79",
    file: "componente.tsx",
    tags: ["negative", "xss", "jsx", "sanitizer"],
    code: `function Card({ req }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(req.query.bio) }} />;
}`,
  },
  {
    id: "X5",
    title: "Atributo JSX corriente no es sink",
    label: "safe",
    cwe: "CWE-79",
    file: "componente.tsx",
    tags: ["negative", "xss", "jsx"],
    code: `function Card({ req }) {
  return <div className={req.query.c} />;
}`,
  },
  {
    id: "S5",
    title: "Def externa alcanza un sink en bloque anidado",
    label: "vulnerable",
    cwe: "CWE-89",
    tags: ["scope", "block", "sqli"],
    code: `function handler(req) {
  const q = req.query.id;
  if (req.flag) {
    db.query(q);
  }
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
