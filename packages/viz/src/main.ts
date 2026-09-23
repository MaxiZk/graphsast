import cytoscape, { type Core } from "cytoscape";
import type {
  AnalysisPayload,
  IRGraph,
  TaintFinding,
  TaintRoles,
  Verdict,
} from "@graphsast/core/browser";
import { analyzeProject, analyzeSnippet } from "./analysis-client.js";
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
  plural,
} from "./labels.js";
import {
  findingHeading,
  findingLocation,
  findingPath,
  graphIndexOfFile,
  linesInFile,
  projectFindings,
  projectVerdict,
  type ProjectFinding,
} from "./project-view.js";
import type { CatalogSummary, ProjectAnalysis, UploadedFile } from "./protocol.js";
import {
  describeSelection,
  filesFromDrop,
  filesFromInput,
  selectUploads,
} from "./upload.js";

type AnalysisStats = AnalysisPayload["stats"];

/** Qué se está mirando: el proyecto subido o los ejemplos de la demo. */
type Mode = "project" | "examples";

const codeInput = document.querySelector<HTMLTextAreaElement>("#code-input")!;
const codeLinesEl = document.querySelector<HTMLDivElement>("#code-lines")!;
const exampleSelect = document.querySelector<HTMLSelectElement>("#example-select")!;
const exampleDesc = document.querySelector<HTMLParagraphElement>("#example-desc")!;
const analyzeBtn = document.querySelector<HTMLButtonElement>("#analyze-btn")!;
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
const tabProject = document.querySelector<HTMLButtonElement>("#tab-project")!;
const tabExamples = document.querySelector<HTMLButtonElement>("#tab-examples")!;
const projectModeEl = document.querySelector<HTMLDivElement>("#project-mode")!;
const examplesModeEl = document.querySelector<HTMLDivElement>("#examples-mode")!;
const dropZone = document.querySelector<HTMLDivElement>("#drop-zone")!;
const folderInput = document.querySelector<HTMLInputElement>("#folder-input")!;
const filesInput = document.querySelector<HTMLInputElement>("#files-input")!;
const selectionSummary = document.querySelector<HTMLParagraphElement>("#selection-summary")!;
const scanProgress = document.querySelector<HTMLProgressElement>("#scan-progress")!;
const projectFilesEl = document.querySelector<HTMLDivElement>("#project-files")!;
const fileList = document.querySelector<HTMLUListElement>("#file-list")!;
const fileViewLabel = document.querySelector<HTMLParagraphElement>("#file-view-label")!;
const projectCode = document.querySelector<HTMLDivElement>("#project-code")!;

let cy: Core | null = null;
let graph: IRGraph | null = null;
let findings: TaintFinding[] = [];
let lastStats: AnalysisStats | null = null;
let lastRules: Record<string, string> = {};
let lastRoles: TaintRoles = { sourceIds: [], sinkIds: [], sanitizerIds: [] };
let lastCatalog: CatalogSummary[] = [];
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

let mode: Mode = "project";
/** Último análisis de ejemplo, para restaurarlo al volver a la pestaña. */
let snippet: AnalysisPayload | null = null;
let examplesLoaded = false;
let project: ProjectAnalysis | null = null;
let projectItems: ProjectFinding[] = [];
/** Archivo del proyecto que se muestra, y hallazgo resaltado (-1: ninguno). */
let selectedFile: string | null = null;
let selectedItem = -1;

const ALL_EDGE_KINDS = [
  "FLOWS_TO",
  "CALLS",
  "BINDS_TO",
  "RETURNS",
  "SANITIZED_BY",
] as const;
type IREdgeKind = (typeof ALL_EDGE_KINDS)[number];

function cytoscapeStyle(): cytoscape.StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": 12,
        "text-wrap": "wrap",
        "text-max-width": "110px",
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
  if (mode === "project") {
    renderProjectCode();
    return;
  }
  const finding = currentHighlight();
  const lines = new Set(linesOnPath(graph ?? { file: "", nodes: [], edges: [] }, finding));
  renderCodeLines(codeLinesEl, codeInput.value, lines);
}

/** Archivo elegido del proyecto, con las líneas del camino resaltado. */
function renderProjectCode() {
  const code = selectedFile ? project?.contents[selectedFile] : undefined;
  if (!selectedFile || code === undefined) {
    fileViewLabel.textContent = "Archivo";
    projectCode.innerHTML = "";
    return;
  }
  const item = projectItems[selectedItem];
  const lines = item ? linesInFile(item.finding, selectedFile) : new Set<number>();
  fileViewLabel.textContent = selectedFile;
  renderCodeLines(projectCode, code, lines);
  // Solo el visor: scrollIntoView movería también la columna y taparía las pestañas.
  const risk = projectCode.querySelector<HTMLElement>(".code-line.risk");
  projectCode.scrollTop = risk
    ? projectCode.scrollTop + risk.getBoundingClientRect().top
      - projectCode.getBoundingClientRect().top - projectCode.clientHeight / 3
    : 0;
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
  lastVerdict = null;
  highlightIndex = 0;

  cy?.elements().remove();
  verdictEl.hidden = true;
  readingEl.textContent = "";
  findingsList.innerHTML = "";
  statsEl.hidden = true;
  codeLinesEl.innerHTML = "";
  projectCode.innerHTML = "";
  nodeDetail.textContent = "";
}

function renderStats() {
  if (mode === "project") {
    renderProjectStats();
    return;
  }
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

function renderProjectStats() {
  if (!project) {
    statsEl.hidden = true;
    return;
  }
  const { totals } = project.output.result;
  statsEl.hidden = false;
  statsEl.innerHTML = `
    <dt>Tiempo</dt><dd>${Math.round(totals.elapsedMs)} ms</dd>
    <dt>Archivos</dt><dd>${totals.files}</dd>
    <dt>Líneas</dt><dd>${totals.lines}</dd>
    <dt>Llamadas entre archivos</dt><dd>${totals.crossFileCalls}</dd>
    <dt>No analizados</dt><dd>${totals.errors}</dd>
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
    const titulo = document.createElement("p");
    titulo.className = "catalog-title";
    titulo.innerHTML = `<strong>CWE-${entry.cwe}</strong> ${entry.name}`;
    li.appendChild(titulo);

    // La descripción sale del catálogo, no de la UI: si se agrega una familia
    // nueva al JSON, se explica sola.
    if (entry.description) {
      const desc = document.createElement("p");
      desc.className = "catalog-desc";
      desc.textContent = entry.description;
      li.appendChild(desc);
    }

    const conteo = document.createElement("p");
    conteo.className = "muted catalog-count";
    conteo.textContent = `${entry.sinks} sinks · ${entry.sanitizers} sanitizers`;
    li.appendChild(conteo);
    catalogList.appendChild(li);
  }
}

function renderEngineBadge() {
  engineBadge.textContent = lastEngine === "neo4j" ? "Neo4j" : "Memoria";
  engineBadge.className = `engine-badge ${lastEngine}`;
  engineBadge.title =
    lastEngine === "neo4j"
      ? "Análisis vía Cypher sobre grafo persistido"
      : "Análisis BFS en memoria, en tu navegador";
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

function renderVerdict() {
  verdictEl.hidden = false;
  const verdict = lastVerdict;
  if (!verdict) {
    // Solo se llega acá sin analizar; tras un análisis hay fallback.
    verdictEl.className = "verdict unknown";
    verdictEl.textContent = mode === "project"
      ? "Subí una carpeta o archivos para analizarlos."
      : "Sin analizar todavía.";
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

  if (mode === "project") {
    renderProjectFindings();
    return;
  }

  if (!graph || findings.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    const sinks = lastRoles.sinkIds.length;
    const sources = lastRoles.sourceIds.length;
    li.textContent = graph
      ? `Sin camino source→sink (${plural(sources, "source", "sources")}, ${plural(sinks, "sink", "sinks")} en el grafo).`
      : "Todavía no hay resultados.";
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

function renderProjectFindings() {
  if (projectItems.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = project ? "Sin hallazgos en el proyecto." : "Todavía no hay resultados.";
    findingsList.appendChild(li);
    return;
  }
  projectItems.forEach((item, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = i === selectedItem ? "active" : "";
    const title = document.createElement("strong");
    title.textContent = findingHeading(item.finding);
    const where = document.createElement("span");
    where.className = "finding-location";
    where.textContent = findingLocation(item.finding);
    const path = document.createElement("span");
    path.className = "finding-path";
    path.textContent = findingPath(item.finding);
    btn.append(title, where, path);
    btn.addEventListener("click", () => selectProjectItem(i));
    li.appendChild(btn);
    findingsList.appendChild(li);
  });
}

/** Archivos subidos con su cantidad de hallazgos o el motivo por el que no se analizaron. */
function renderFileList() {
  fileList.innerHTML = "";
  if (!project) return;
  for (const file of project.output.result.files) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = [
      file.file === selectedFile ? "active" : "",
      file.error ? "failed" : file.findings.length > 0 ? "vulnerable" : "",
    ].filter(Boolean).join(" ");
    btn.title = file.error ?? "";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.file;
    const badge = document.createElement("span");
    badge.className = "file-badge";
    badge.textContent = file.error ? "no analizado" : String(file.findings.length);
    btn.append(name, badge);
    btn.disabled = !!file.error;
    btn.addEventListener("click", () => selectProjectFile(file.file));
    li.appendChild(btn);
    fileList.appendChild(li);
  }
}

/** Muestra el grafo `graphIndex` del proyecto con el hallazgo `findingIndex` resaltado. */
function showProjectGraph(graphIndex: number, findingIndex: number) {
  const scanGraph = project?.output.graphs[graphIndex];
  graph = scanGraph?.graph ?? null;
  findings = scanGraph?.findings ?? [];
  lastRoles = project?.roles[graphIndex] ?? { sourceIds: [], sinkIds: [], sanitizerIds: [] };
  highlightIndex = findingIndex;
  nodeDetail.textContent = "";
  renderFileList();
  renderFindings();
  if (graph) renderGraph();
  else {
    cy?.elements().remove();
    renderCodeHighlight();
  }
}

function selectProjectItem(i: number) {
  const item = projectItems[i];
  if (!item) return;
  selectedItem = i;
  selectedFile = item.finding.file;
  showProjectGraph(item.graphIndex, item.findingIndex);
}

/** Elige un archivo: su primer hallazgo si tiene, o su grafo sin resaltar. */
function selectProjectFile(file: string) {
  const first = projectItems.findIndex((item) => item.finding.file === file);
  if (first >= 0) {
    selectProjectItem(first);
    return;
  }
  selectedItem = -1;
  selectedFile = file;
  showProjectGraph(graphIndexOfFile(project!.output, file), -1);
}

function showProject() {
  if (!project) return;
  projectItems = projectFindings(project.output);
  lastRules = project.rules;
  lastCatalog = project.catalog;
  lastEngine = "memory";
  lastVerdict = projectVerdict(project.output, project);
  projectFilesEl.hidden = project.output.result.files.length === 0;
  renderEngineBadge();
  renderCatalog();
  renderRules();
  renderStats();
  const firstFile = project.output.result.files.find((f) => !f.error)?.file;
  if (projectItems.length > 0) selectProjectItem(0);
  else if (firstFile) selectProjectFile(firstFile);
  else {
    clearAnalysisView();
    renderFileList();
    renderFindings();
  }
}

async function scanUploads(uploads: UploadedFile[]) {
  const selection = selectUploads(uploads);
  selectionSummary.hidden = false;
  selectionSummary.textContent = describeSelection(selection);
  if (selection.accepted.length === 0) {
    statusEl.textContent = "No hay archivos JavaScript o TypeScript para analizar.";
    return;
  }

  folderInput.disabled = true;
  filesInput.disabled = true;
  dropZone.classList.add("busy");
  scanProgress.hidden = false;
  scanProgress.max = selection.accepted.length;
  scanProgress.value = 0;
  statusEl.textContent = "Preparando el analizador…";
  const started = performance.now();
  try {
    project = await analyzeProject(selection.accepted, (done, total, file) => {
      scanProgress.value = done;
      statusEl.textContent = `Analizando ${done + 1} de ${total}: ${file}`;
    });
    if (mode !== "project") return;
    showProject();
    const { totals } = project.output.result;
    statusEl.textContent =
      `Listo en ${Math.round(performance.now() - started)} ms · `
      + `${plural(totals.files, "archivo", "archivos")} · `
      + `${plural(totals.findings, "hallazgo", "hallazgos")}`;
  } catch (err) {
    project = null;
    projectItems = [];
    selectedFile = null;
    selectedItem = -1;
    clearAnalysisView();
    renderFileList();
    statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    folderInput.disabled = false;
    filesInput.disabled = false;
    dropZone.classList.remove("busy");
    scanProgress.hidden = true;
  }
}

/** Cambia de pestaña y vuelve a dibujar lo que corresponde a cada una. */
function setMode(next: Mode) {
  mode = next;
  tabProject.setAttribute("aria-selected", String(next === "project"));
  tabExamples.setAttribute("aria-selected", String(next === "examples"));
  projectModeEl.hidden = next !== "project";
  examplesModeEl.hidden = next !== "examples";
  clearAnalysisView();
  if (next === "project") {
    if (project) showProject();
    else {
      renderStats();
      renderFindings();
    }
    return;
  }
  if (!examplesLoaded) {
    examplesLoaded = true;
    populateExamples();
    void runAnalysis();
  } else if (snippet) {
    showSnippet(snippet);
  } else {
    renderFindings();
  }
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

/** Vuelca un análisis de ejemplo en pantalla. */
function showSnippet(data: AnalysisPayload) {
  graph = data.graph;
  findings = data.findings;
  lastStats = data.stats;
  lastRules = data.rules;
  lastRoles = data.roles;
  lastCatalog = data.catalog;
  lastEngine = data.engine;
  lastVerdict = data.verdict;
  highlightIndex = 0;

  renderEngineBadge();
  renderCatalog();
  renderRules();
  renderStats();
  renderFindings();
  renderGraph();
}

async function runAnalysis() {
  const submittedCode = codeInput.value;
  statusEl.textContent = "Analizando…";
  analyzeBtn.disabled = true;
  nodeDetail.textContent = "";
  try {
    const data = await analyzeSnippet(submittedCode, "demo.ts");
    // Si el usuario cambió de pestaña mientras tanto, el resultado queda
    // guardado para cuando vuelva, pero no pisa lo que está mirando.
    snippet = data;
    analyzedCode = submittedCode;
    if (mode !== "examples") return;
    showSnippet(data);

    const roleHint = `${lastRoles.sourceIds.length} source(s) · ${lastRoles.sinkIds.length} sink(s)`;
    statusEl.textContent = lastVerdict && !lastVerdict.conclusive
      ? `${lastVerdict.title} · ${lastStats?.elapsedMs ?? "?"} ms`
      : `Análisis en ${lastStats?.elapsedMs ?? "?"} ms · ${findings.length} hallazgo(s) · ${roleHint}`;
  } catch (err) {
    snippet = null;
    analyzedCode = null;
    if (mode !== "examples") return;
    clearAnalysisView();
    statusEl.textContent = `Error: ${err}`;
  } finally {
    analyzeBtn.disabled = false;
  }
}

exampleSelect.addEventListener("change", () => {
  if (exampleSelect.value === CUSTOM_EXAMPLE_ID) {
    loadCustom();
    return;
  }
  loadExample(exampleSelect.value);
  void runAnalysis();
});
analyzeBtn.addEventListener("click", () => void runAnalysis());
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

tabProject.addEventListener("click", () => setMode("project"));
tabExamples.addEventListener("click", () => setMode("examples"));

folderInput.addEventListener("change", () => {
  const uploads = filesFromInput(folderInput.files!);
  folderInput.value = "";
  void scanUploads(uploads);
});
filesInput.addEventListener("change", () => {
  const uploads = filesFromInput(filesInput.files!);
  filesInput.value = "";
  void scanUploads(uploads);
});

// Sin esto, soltar un archivo fuera de la zona hace que el navegador lo abra
// y se pierda la página.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragging");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragging");
  if (!e.dataTransfer || folderInput.disabled) return;
  void filesFromDrop(e.dataTransfer)
    .then(scanUploads)
    .catch((err) => {
      statusEl.textContent = `No se pudieron leer los archivos: ${err}`;
    });
});

setMode("project");
statusEl.textContent = "Elegí una carpeta o archivos de tu proyecto para empezar.";
