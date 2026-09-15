import cytoscape, { type Core } from "cytoscape";
import { renderCodeLines } from "./code-lines.js";
import { linesOnPath, toCytoscapeElements } from "./cytoscape.js";
import {
  DEFAULT_EXAMPLE_ID,
  DEMO_EXAMPLES,
  getExample,
} from "./examples.js";
import { findingTitle, formatFindingPath } from "./labels.js";
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
const verdictEl = document.querySelector<HTMLDivElement>("#verdict")!;
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

const ALL_EDGE_KINDS = ["FLOWS_TO", "CALLS", "BINDS_TO", "RETURNS"] as const;
type IREdgeKind = (typeof ALL_EDGE_KINDS)[number];

function cytoscapeStyle(): cytoscape.Stylesheet[] {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": 10,
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
        "font-size": 8,
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
      spacingFactor: 1.15,
    })
    .run();
  instance.fit(undefined, 36);
  renderCodeHighlight();
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
  for (const [id, label] of Object.entries(lastRules)) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${id}</strong> — ${label}`;
    rulesList.appendChild(li);
  }
}

function renderVerdict() {
  verdictEl.hidden = false;
  if (findings.length > 0) {
    verdictEl.className = "verdict warn";
    verdictEl.textContent = `${findings.length} vulnerabilidad(es) detectada(s)`;
    return;
  }
  verdictEl.className = "verdict ok";
  verdictEl.textContent = "Sin caminos source → sink sin sanitizar";
}

function renderFindings() {
  findingsList.innerHTML = "";
  renderVerdict();

  if (!graph || findings.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    const sinks = lastRoles.sinkIds.length;
    const sources = lastRoles.sourceIds.length;
    li.textContent =
      sinks === 0
        ? "Sin sinks detectados. Reiniciá npm start si actualizaste el proyecto."
        : `Sin camino source→sink (${sources} source(s), ${sink(s)} sink(s) en el grafo).`;
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

function populateExamples() {
  for (const ex of DEMO_EXAMPLES) {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.title;
    exampleSelect.appendChild(opt);
  }
  exampleSelect.value = DEFAULT_EXAMPLE_ID;
  loadExample(DEFAULT_EXAMPLE_ID);
}

function loadExample(id: string) {
  const ex = getExample(id);
  exampleDesc.textContent = ex.description;
  codeInput.value = ex.code;
}

async function runAnalysis() {
  statusEl.textContent = "Analizando…";
  analyzeBtn.disabled = true;
  nodeDetail.textContent = "";
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeInput.value, file: "demo.ts" }),
    });
    const data = (await res.json()) as {
      graph?: IRGraph;
      findings?: TaintFinding[];
      roles?: TaintRoles;
      stats?: AnalysisStats;
      rules?: Record<string, string>;
      engine?: string;
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
    highlightIndex = 0;

    const roleHint = `${lastRoles.sourceIds.length} source(s) · ${lastRoles.sinkIds.length} sink(s)`;
    statusEl.textContent = `Análisis en ${lastStats?.elapsedMs ?? "?"} ms · ${findings.length} hallazgo(s) · ${roleHint}`;
    renderEngineBadge();
    renderCatalog();
    renderRules();
    renderStats();
    renderFindings();
    renderGraph();
  } catch (err) {
    statusEl.textContent = `Error: ${err}`;
    verdictEl.hidden = true;
    findingsList.innerHTML = "";
    statsEl.hidden = true;
    codeLinesEl.innerHTML = "";
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
  loadExample(exampleSelect.value);
  void runAnalysis();
});
analyzeBtn.addEventListener("click", () => void runAnalysis());
copyBtn.addEventListener("click", () => void copyReport());
htmlBtn.addEventListener("click", () => exportHtml());
pdfBtn.addEventListener("click", () => exportPdf());
fitBtn.addEventListener("click", () => cy?.fit(undefined, 36));
edgeFilters.addEventListener("change", () => renderGraph());
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
