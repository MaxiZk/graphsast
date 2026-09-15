import cytoscape, { type Core } from "cytoscape";
import { renderCodeLines } from "./code-lines.js";
import { linesOnPath, toCytoscapeElements } from "./cytoscape.js";
import {
  DEFAULT_EXAMPLE_ID,
  DEMO_EXAMPLES,
  getExample,
} from "./examples.js";
import {
  describeFinding,
  describeNoFinding,
  findingTitle,
  formatFindingPath,
} from "./labels.js";
import { downloadHtmlReport, printHtmlReport } from "./report-export.js";
import type { VizAnalysisReport } from "./report-html.js";

/** Tipos alineados con la respuesta de /api/analyze (solo en el cliente). */
interface IRGraph {
  file: string;
  nodes: { id: string; kind: string; name: string; code: string; loc: { line: number }; callee?: string }[];
  edges: { kind: string; from: string; to: string }[];
}

interface TaintFinding {
  sourceId: string;
  sinkId: string;
  path: string[];
  sanitized: boolean;
  cwe?: number;
  cweName?: string;
  ruleId?: string;
}

interface TaintRoles {
  sourceIds: string[];
  sinkIds: string[];
  sanitizerIds: string[];
}

interface Verdict {
  kind: "not-analyzable" | "no-coverage" | "clean" | "vulnerable";
  title: string;
  detail: string;
  conclusive: boolean;
  sources: number;
  sinks: number;
  findings: number;
  syntaxErrors: number;
}

interface AnalysisStats {
  elapsedMs: number;
  lineCount: number;
  nodeCount: number;
  edgeCount: number;
  edgeKinds: Record<string, number>;
  findingCount: number;
}

const codeInput = document.querySelector<HTMLTextAreaElement>("#code-input")!;
const codeLinesEl = document.querySelector<HTMLDivElement>("#code-lines")!;
const exampleSelect = document.querySelector<HTMLSelectElement>("#example-select")!;
const exampleDesc = document.querySelector<HTMLParagraphElement>("#example-desc")!;
const analyzeBtn = document.querySelector<HTMLButtonElement>("#analyze-btn")!;
const copyBtn = document.querySelector<HTMLButtonElement>("#copy-btn")!;
const htmlBtn = document.querySelector<HTMLButtonElement>("#html-btn")!;
const pdfBtn = document.querySelector<HTMLButtonElement>("#pdf-btn")!;
const fitBtn = document.querySelector<HTMLButtonElement>("#fit-btn")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const statsEl = document.querySelector<HTMLDListElement>("#stats")!;
const findingsList = document.querySelector<HTMLUListElement>("#findings-list")!;
const catalogList = document.querySelector<HTMLUListElement>("#catalog-list")!;
const engineBadge = document.querySelector<HTMLSpanElement>("#engine-badge")!;
const rulesList = document.querySelector<HTMLUListElement>("#rules-list")!;
const rulesSummary = document.querySelector<HTMLElement>("#rules-summary")!;
const verdictEl = document.querySelector<HTMLDivElement>("#verdict")!;
const readingEl = document.querySelector<HTMLParagraphElement>("#reading")!;
const nodeDetail = document.querySelector<HTMLPreElement>("#node-detail")!;
const edgeFilters = document.querySelector<HTMLFieldSetElement>("#edge-filters")!;
const dimToggle = document.querySelector<HTMLInputElement>("#dim-toggle")!;

let cy: Core | null = null;
let graph: IRGraph | null = null;
let findings: TaintFinding[] = [];
let lastStats: AnalysisStats | null = null;
let lastRules: Record<string, string> = {};
let lastRoles: TaintRoles = { sourceIds: [], sinkIds: [], sanitizerIds: [] };
let lastReport: VizAnalysisReport | null = null;
let lastCatalog: { cwe: number; name: string; sinks: number; sanitizers: number }[] = [];
let lastEngine = "memory";
let highlightIndex = 0;
/**
 * Código al que corresponden los resultados en pantalla. Si el textarea deja
 * de coincidir, lo mostrado es de otro análisis y hay que invalidarlo: sin
 * esto, pegar código nuevo dejaba los hallazgos del ejemplo anterior a la
 * vista, atribuidos al código recién pegado.
 */
let analyzedCode: string | null = null;
let lastVerdict: Verdict | null = null;

const ALL_EDGE_KINDS = [
  "FLOWS_TO",
  "CALLS",
  "BINDS_TO",
  "RETURNS",
  "SANITIZED_BY",
] as const;
type IREdgeKind = (typeof ALL_EDGE_KINDS)[number];

function cytoscapeStyle(): cytoscape.Stylesheet[] {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": 12,
        "text-wrap": "wrap",
        "text-max-width": 110,
        "background-color": "#475569",
        color: "#f8fafc",
        "text-valign": "center",
        "text-halign": "center",
        width: 58,
        height: 58,
        "border-width": 2,
        "border-color": "#64748b",
      },
    },
    {
      selector: "node.parameter",
      style: { "background-color": "#0f766e", "border-color": "#5eead4" },
    },
    {
      selector: "node.variable",
      style: { "background-color": "#334155", "border-color": "#94a3b8" },
    },
    {
      selector: "node.call",
      style: { "background-color": "#4c1d95", "border-color": "#c4b5fd" },
    },
    {
      selector: "node.source",
      style: {
        "background-color": "#14b8a6",
        "border-width": 3,
        "border-color": "#99f6e4",
      },
    },
    {
      selector: "node.sink",
      style: {
        "background-color": "#dc2626",
        "border-width": 3,
        "border-color": "#fecaca",
      },
    },
    {
      selector: "node.sanitizer",
      style: {
        "background-color": "#2563eb",
        "border-color": "#93c5fd",
      },
    },
    {
      selector: "node.risk-path",
      style: {
        "background-color": "#f97316",
        "border-width": 3,
        "border-color": "#fed7aa",
      },
    },
    {
      selector: ".dimmed",
      style: { opacity: 0.18 },
    },
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": "#64748b",
        "target-arrow-color": "#64748b",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": 9,
        color: "#cbd5e1",
      },
    },
    {
      selector: "edge.flows-to",
      style: {
        "line-color": "#38bdf8",
        "target-arrow-color": "#38bdf8",
        width: 3,
      },
    },
    {
      selector: "edge.binds-to",
      style: { "line-color": "#a78bfa", "target-arrow-color": "#a78bfa" },
    },
    {
      selector: "edge.sanitized-by",
      style: {
        "line-color": "#22c55e",
        "target-arrow-color": "#22c55e",
        "line-style": "dashed",
      },
    },
    {
      selector: "edge.risk-edge",
      style: {
        width: 5,
        "line-color": "#f97316",
        "target-arrow-color": "#f97316",
        color: "#fdba74",
      },
    },
  ];
}

function ensureCy(): Core {
  if (!cy) {
    cy = cytoscape({
      container: document.getElementById("cy")!,
      style: cytoscapeStyle(),
      wheelSensitivity: 0.2,
    });
    cy.on("tap", "node", (evt) => {
      const d = evt.target.data();
      nodeDetail.textContent = [
        d.kind ? `kind: ${d.kind}` : "",
        d.line ? `line: ${d.line}` : "",
        d.code ? `code: ${d.code}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });
  }
  return cy;
}

function visibleEdgeKinds(): Set<IREdgeKind> {
  const set = new Set<IREdgeKind>();
  for (const input of edgeFilters.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][value]',
  )) {
    if (input.checked) set.add(input.value as IREdgeKind);
  }
  return set;
}

function currentHighlight(): TaintFinding | undefined {
  return findings[highlightIndex];
}

function renderCodeHighlight() {
  const finding = currentHighlight();
  const lines = new Set(linesOnPath(graph ?? { file: "", nodes: [], edges: [] }, finding));
  renderCodeLines(codeLinesEl, codeInput.value, lines);
}

/**
 * Zoom por debajo del cual las etiquetas dejan de leerse proyectadas.
 * Medido sobre el ejemplo G+, que son tres componentes desconectadas en fila:
 * encuadrar todo daba 0.35 y no se leía ni un nodo.
 */
const MIN_READABLE_ZOOM = 0.6;

/**
 * Encuadra el grafo entero; si para entrar hay que achicarlo más de lo
 * legible, encuadra el camino de riesgo con sus vecinos inmediatos —que es lo
 * que hay que mirar— y deja el resto a un paso de rueda.
 */
function fitGraph(instance: Core, hasHighlight: boolean) {
  instance.fit(undefined, 36);
  if (instance.zoom() >= MIN_READABLE_ZOOM || !hasHighlight) return;
  const path = instance.$(".risk-path");
  if (path.nonempty()) instance.fit(path.closedNeighborhood(), 48);
}

function renderGraph() {
  if (!graph) return;
  const finding = currentHighlight();
  const instance = ensureCy();
  instance.json({
    elements: toCytoscapeElements(graph, {
      highlight: finding,
      roles: lastRoles,
      visibleEdges: visibleEdgeKinds(),
      dimNonPath: dimToggle.checked && !!finding,
    }),
  });
  instance
    .layout({
      name: "breadthfirst",
      directed: true,
      padding: 36,
      // Sin contar la etiqueta, el layout separa círculos de 58px mientras el
      // texto ocupa hasta 110: en grafos de más de diez nodos los rótulos se
      // pisaban y no se leía cuál era cuál.
      nodeDimensionsIncludeLabels: true,
      avoidOverlap: true,
      spacingFactor: 1.3,
    })
    .run();
  fitGraph(instance, !!finding);
  renderCodeHighlight();
}

/**
 * Descarta el resultado en pantalla. Se usa cuando el análisis falla: sin esto
 * queda el grafo del análisis anterior, que no corresponde al código actual.
 */
function clearAnalysisView() {
  graph = null;
  findings = [];
  lastStats = null;
  lastRoles = { sourceIds: [], sinkIds: [], sanitizerIds: [] };
  lastReport = null;
  lastVerdict = null;
  highlightIndex = 0;

  cy?.elements().remove();
  verdictEl.hidden = true;
  readingEl.textContent = "";
  findingsList.innerHTML = "";
  statsEl.hidden = true;
  codeLinesEl.innerHTML = "";
  nodeDetail.textContent = "";
}

function renderStats() {
  if (!lastStats) {
    statsEl.hidden = true;
    return;
  }
  statsEl.hidden = false;
  const kinds = Object.entries(lastStats.edgeKinds)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  statsEl.innerHTML = `
    <dt>Tiempo</dt><dd>${lastStats.elapsedMs} ms</dd>
    <dt>Líneas</dt><dd>${lastStats.lineCount}</dd>
    <dt>Nodos</dt><dd>${lastStats.nodeCount}</dd>
    <dt>Aristas</dt><dd>${lastStats.edgeCount}</dd>
    <dt>Tipos</dt><dd>${kinds}</dd>
  `;
}

function renderCatalog() {
  catalogList.innerHTML = "";
  if (lastCatalog.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Catálogo no cargado.";
    catalogList.appendChild(li);
    return;
  }
  for (const entry of lastCatalog) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>CWE-${entry.cwe}</strong> ${entry.name}<br /><span class="muted">${entry.sinks} sinks · ${entry.sanitizers} sanitizers</span>`;
    catalogList.appendChild(li);
  }
}

function renderEngineBadge() {
  engineBadge.textContent = lastEngine === "neo4j" ? "Neo4j" : "Memoria";
  engineBadge.className = `engine-badge ${lastEngine}`;
  engineBadge.title =
    lastEngine === "neo4j"
      ? "Análisis vía Cypher sobre grafo persistido"
      : "Análisis BFS en memoria (sin Neo4j)";
}

function renderRules() {
  rulesList.innerHTML = "";
  const entries = Object.entries(lastRules);
  rulesSummary.textContent = `Ver reglas activas (${entries.length})`;
  for (const [id, label] of entries) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${id}</strong> — ${label}`;
    rulesList.appendChild(li);
  }
}

/** Clase CSS por veredicto: solo `clean` merece el verde pleno. */
const VERDICT_CLASS: Record<Verdict["kind"], string> = {
  "not-analyzable": "verdict error",
  "no-coverage": "verdict unknown",
  clean: "verdict ok",
  vulnerable: "verdict warn",
};

/**
 * Veredicto derivado en el cliente cuando la respuesta no trae uno: pasa con
 * un servidor de dev viejo, levantado antes de que el endpoint lo incluyera.
 * Sin esto el panel decía «Sin analizar todavía» justo después de analizar.
 * No puede detectar `not-analyzable` —eso lo sabe solo el parser—, así que se
 * limita a lo que el cliente sí puede ver: hallazgos, sources y sinks.
 */
function fallbackVerdict(): Verdict {
  const sources = lastRoles.sourceIds.length;
  const sinks = lastRoles.sinkIds.length;
  const base = { sources, sinks, findings: findings.length, syntaxErrors: 0 };

  if (findings.length > 0) {
    return {
      ...base,
      kind: "vulnerable",
      conclusive: true,
      title: `${findings.length} vulnerabilidad(es) detectada(s)`,
      detail:
        "Hay caminos de datos desde una entrada no confiable hasta una "
        + "operación peligrosa, sin sanitizador en el medio.",
    };
  }
  if (sources === 0 || sinks === 0) {
    return {
      ...base,
      kind: "no-coverage",
      conclusive: false,
      title: "Sin vulnerabilidades, pero no hay nada que evaluar",
      detail:
        `Se analizó el código, pero hay ${sources} source(s) y ${sinks} sink(s). `
        + "El resultado no afirma que el código sea seguro.",
    };
  }
  return {
    ...base,
    kind: "clean",
    conclusive: true,
    title: "Sin caminos source → sink sin sanitizar",
    detail:
      `Se recorrieron los caminos entre ${sources} source(s) y ${sinks} sink(s) `
      + "y ninguno llega sin sanitizar. Alcance: este archivo.",
  };
}

function renderVerdict() {
  verdictEl.hidden = false;
  const verdict = lastVerdict;
  if (!verdict) {
    // Solo se llega acá sin analizar; tras un análisis hay fallback.
    verdictEl.className = "verdict unknown";
    verdictEl.textContent = "Sin analizar todavía.";
    return;
  }
  verdictEl.className = VERDICT_CLASS[verdict.kind];
  verdictEl.innerHTML = "";
  const title = document.createElement("strong");
  title.textContent = verdict.title;
  const detail = document.createElement("p");
  detail.className = "verdict-detail";
  detail.textContent = verdict.detail;
  verdictEl.append(title, detail);
}

/**
 * Lectura del hallazgo resaltado en lenguaje natural. Sin hallazgos la frase
 * dice por qué no lo hay, en vez de quedar en blanco.
 */
function renderReading() {
  const finding = currentHighlight();
  if (graph && finding) {
    readingEl.textContent = describeFinding(graph, finding);
    return;
  }
  if (!graph) {
    readingEl.textContent = "";
    return;
  }
  readingEl.textContent = describeNoFinding(
    lastRoles.sourceIds.length,
    lastRoles.sinkIds.length,
  );
}

function renderFindings() {
  findingsList.innerHTML = "";
  renderVerdict();
  renderReading();

  if (!graph || findings.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    const sinks = lastRoles.sinkIds.length;
    const sources = lastRoles.sourceIds.length;
    li.textContent =
      sinks === 0
        ? "Sin sinks detectados. Reiniciá npm start si actualizaste el proyecto."
        : `Sin camino source→sink (${sources} source(s), ${sinks} sink(s) en el grafo).`;
    findingsList.appendChild(li);
    return;
  }

  findings.forEach((f, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = i === highlightIndex ? "active" : "";
    btn.innerHTML = `<strong>${findingTitle(graph!, f, i)}</strong>${formatFindingPath(graph!, f)}`;
    btn.addEventListener("click", () => {
      highlightIndex = i;
      renderFindings();
      renderGraph();
    });
    li.appendChild(btn);
    findingsList.appendChild(li);
  });
}

/** Entrada del desplegable que representa el código propio del usuario. */
const CUSTOM_EXAMPLE_ID = "__custom__";

function populateExamples() {
  const custom = document.createElement("option");
  custom.value = CUSTOM_EXAMPLE_ID;
  custom.textContent = "✎ Mi código (pegar abajo)";
  exampleSelect.appendChild(custom);

  for (const ex of DEMO_EXAMPLES) {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.title;
    exampleSelect.appendChild(opt);
  }
  exampleSelect.value = DEFAULT_EXAMPLE_ID;
  loadExample(DEFAULT_EXAMPLE_ID);
}

/**
 * Vacía el editor para pegar código propio. No dispara análisis: no hay nada
 * que analizar todavía.
 */
function loadCustom() {
  exampleDesc.textContent =
    "Pegá tu código JavaScript o TypeScript y apretá Ctrl+Enter para analizarlo.";
  codeInput.value = "";
  clearAnalysisView();
  analyzedCode = null;
  statusEl.textContent = "Pegá tu código y apretá Ctrl+Enter o «Analizar».";
  codeInput.focus();
}

function loadExample(id: string) {
  const ex = getExample(id);
  exampleDesc.textContent = ex.description;
  codeInput.value = ex.code;
}

async function runAnalysis() {
  const submittedCode = codeInput.value;
  statusEl.textContent = "Analizando…";
  analyzeBtn.disabled = true;
  nodeDetail.textContent = "";
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: submittedCode, file: "demo.ts" }),
    });
    const data = (await res.json()) as {
      graph?: IRGraph;
      findings?: TaintFinding[];
      roles?: TaintRoles;
      stats?: AnalysisStats;
      rules?: Record<string, string>;
      engine?: string;
      verdict?: Verdict;
      report?: VizAnalysisReport;
      catalog?: { cwe: number; name: string; sinks: number; sanitizers: number }[];
      error?: string;
    };
    if (!res.ok || data.error) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }

    graph = data.graph!;
    findings = data.findings ?? [];
    lastStats = data.stats ?? null;
    lastRules = data.rules ?? {};
    lastRoles = data.roles ?? { sourceIds: [], sinkIds: [], sanitizerIds: [] };
    lastReport = data.report ?? null;
    lastCatalog = data.catalog ?? [];
    lastEngine = data.engine ?? "memory";
    lastVerdict = data.verdict ?? fallbackVerdict();
    highlightIndex = 0;
    analyzedCode = submittedCode;

    const roleHint = `${lastRoles.sourceIds.length} source(s) · ${lastRoles.sinkIds.length} sink(s)`;
    statusEl.textContent = lastVerdict && !lastVerdict.conclusive
      ? `${lastVerdict.title} · ${lastStats?.elapsedMs ?? "?"} ms`
      : `Análisis en ${lastStats?.elapsedMs ?? "?"} ms · ${findings.length} hallazgo(s) · ${roleHint}`;
    renderEngineBadge();
    renderCatalog();
    renderRules();
    renderStats();
    renderFindings();
    renderGraph();
  } catch (err) {
    clearAnalysisView();
    analyzedCode = null;
    statusEl.textContent = `Error: ${err}`;
  } finally {
    analyzeBtn.disabled = false;
  }
}

async function copyReport() {
  try {
    const report: VizAnalysisReport = lastReport ?? {
      analyzedAt: new Date().toISOString(),
      engine: lastEngine,
      code: codeInput.value,
      file: "demo.ts",
      findings,
      stats: {
        elapsedMs: lastStats?.elapsedMs ?? 0,
        lineCount: codeInput.value.split("\n").length,
        nodeCount: graph?.nodes.length ?? 0,
        edgeCount: graph?.edges.length ?? 0,
        findingCount: findings.length,
      },
    };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    statusEl.textContent = "Informe JSON copiado al portapapeles.";
  } catch (err) {
    statusEl.textContent = `No se pudo copiar: ${err}`;
  }
}

function exportHtml() {
  if (!lastReport) {
    statusEl.textContent = "Analizá primero para generar el informe.";
    return;
  }
  try {
    downloadHtmlReport(lastReport);
    statusEl.textContent = "Informe HTML descargado.";
  } catch (err) {
    statusEl.textContent = `Error al exportar HTML: ${err}`;
  }
}

function exportPdf() {
  if (!lastReport) {
    statusEl.textContent = "Analizá primero para generar el informe.";
    return;
  }
  try {
    printHtmlReport(lastReport);
    statusEl.textContent = "Usá «Guardar como PDF» en el diálogo de impresión.";
  } catch (err) {
    statusEl.textContent = `Error al exportar PDF: ${err}`;
  }
}

populateExamples();
exampleSelect.addEventListener("change", () => {
  if (exampleSelect.value === CUSTOM_EXAMPLE_ID) {
    loadCustom();
    return;
  }
  loadExample(exampleSelect.value);
  void runAnalysis();
});
analyzeBtn.addEventListener("click", () => void runAnalysis());
copyBtn.addEventListener("click", () => void copyReport());
htmlBtn.addEventListener("click", () => exportHtml());
pdfBtn.addEventListener("click", () => exportPdf());
fitBtn.addEventListener("click", () => cy?.fit(undefined, 36));
edgeFilters.addEventListener("change", () => renderGraph());
codeInput.addEventListener("input", () => {
  // El contenido ya no es el del ejemplo elegido: que el rótulo no mienta.
  if (exampleSelect.value !== CUSTOM_EXAMPLE_ID) {
    exampleSelect.value = CUSTOM_EXAMPLE_ID;
    exampleDesc.textContent = "Código propio, sin analizar todavía.";
  }
  if (analyzedCode === null || codeInput.value === analyzedCode) return;
  clearAnalysisView();
  analyzedCode = null;
  statusEl.textContent = "Código modificado — Ctrl+Enter o «Analizar» para analizarlo.";
});
codeInput.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    void runAnalysis();
  }
});

void runAnalysis().catch((err) => {
  statusEl.textContent = `Error al iniciar: ${err}`;
  console.error(err);
});
