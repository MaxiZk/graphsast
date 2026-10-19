import cytoscape, { type Core } from "cytoscape";
import { GRAPHSAST_IGNORE_FILE, VERSION } from "@graphsast/core/browser";
import type {
  AnalysisPayload,
  IRGraph,
  TaintFinding,
  SourceMode,
  TaintRoles,
  Verdict,
} from "@graphsast/core/browser";
import { analyzeProject, analyzeSnippet } from "./analysis-client.js";
import { renderCodeLines } from "./code-lines.js";
import {
  PATH_MARGIN,
  axisPan,
  graphExport,
  linesOnPath,
  nodeMatchesQuery,
  toCytoscapeElements,
} from "./cytoscape.js";
import {
  DEFAULT_EXAMPLE_ID,
  DEMO_EXAMPLES,
  getExample,
} from "./examples.js";
import { loadCatalogBundle } from "./catalog-browser.js";
import { explainFinding, groupBySink, stepLabel, whereOf } from "./explain.js";
import { chatContext } from "./chat.js";
import { createChatPanel } from "./chat-panel.js";
import { EDGE_KIND_LABEL, NODE_KIND_LABEL, describeNoFinding, plural } from "./labels.js";
import {
  filesForList,
  focusGraph,
  graphIndexOfFile,
  linesInFile,
  projectFindings,
  projectVerdict,
  type ProjectFinding,
} from "./project-view.js";
import {
  graphPalette,
  nodeLimitValue,
  resolveNodeLimit,
  resolveTheme,
  shortcutFor,
  stepIndex,
  type ShortcutAction,
  type Theme,
} from "./preferences.js";
import type { CatalogSummary, ProjectAnalysis, UploadedFile } from "./protocol.js";
import {
  describeSelection,
  gitignoreFilter,
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
const graphNote = document.querySelector<HTMLParagraphElement>("#graph-note")!;
const graphEmpty = document.querySelector<HTMLDivElement>("#graph-empty")!;
const graphEmptyText = document.querySelector<HTMLParagraphElement>("#graph-empty-text")!;
const GRAPH_EMPTY_TEXT = graphEmptyText.textContent!;
const pipeCode = document.querySelector<HTMLLIElement>("#pipe-code")!;
const pipeGraph = document.querySelector<HTMLLIElement>("#pipe-graph")!;
const pipeResult = document.querySelector<HTMLLIElement>("#pipe-result")!;
const graphSearch = document.querySelector<HTMLInputElement>("#graph-search")!;
const graphSearchCount = document.querySelector<HTMLSpanElement>("#graph-search-count")!;
const exportPngBtn = document.querySelector<HTMLButtonElement>("#export-png")!;
const exportJsonBtn = document.querySelector<HTMLButtonElement>("#export-json")!;
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
const onlyVulnerable = document.querySelector<HTMLInputElement>("#only-vulnerable")!;
const sourceModeSelect = document.querySelector<HTMLSelectElement>("#source-mode")!;
const onlyVulnerableLabel = document.querySelector<HTMLSpanElement>("#only-vulnerable-label")!;
const fileViewLabel = document.querySelector<HTMLParagraphElement>("#file-view-label")!;
const projectCode = document.querySelector<HTMLDivElement>("#project-code")!;
const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
const nodeLimitSelect = document.querySelector<HTMLSelectElement>("#node-limit")!;
const nodeTooltip = document.querySelector<HTMLDivElement>("#node-tooltip")!;
const explainEl = document.querySelector<HTMLElement>("#explain")!;
const chatPanel = createChatPanel({
  section: document.querySelector<HTMLElement>("#chat")!,
  log: document.querySelector<HTMLOListElement>("#chat-log")!,
  form: document.querySelector<HTMLFormElement>("#chat-form")!,
  input: document.querySelector<HTMLTextAreaElement>("#chat-input")!,
  send: document.querySelector<HTMLButtonElement>("#chat-send")!,
  suggestions: document.querySelector<HTMLElement>("#chat-suggestions")!,
  reset: document.querySelector<HTMLButtonElement>("#chat-reset")!,
});
const explainSummary = document.querySelector<HTMLParagraphElement>("#explain-summary")!;
const explainSource = document.querySelector<HTMLDivElement>("#explain-source")!;
const explainSink = document.querySelector<HTMLDivElement>("#explain-sink")!;
const explainMissing = document.querySelector<HTMLDivElement>("#explain-missing")!;
const explainFix = document.querySelector<HTMLDivElement>("#explain-fix")!;
const explainFixItem = document.querySelector<HTMLLIElement>("#explain-fix-item")!;
const explainOthers = document.querySelector<HTMLDivElement>("#explain-others")!;
const explainPathSummary = document.querySelector<HTMLElement>("#explain-path-summary")!;
const explainPath = document.querySelector<HTMLOListElement>("#explain-path")!;

/**
 * El catálogo en la página, para explicar cada hallazgo (riesgo, ataque,
 * corrección, sanitizers). Son los mismos JSON que usa el worker; no arrastra
 * el motor.
 */
const CATALOG = new Map(loadCatalogBundle().entries.map((e) => [e.cwe, e]));

/**
 * Preferencias guardadas en el navegador. Puede no haber almacenamiento
 * (modo privado, bloqueado): entonces valen las de siempre.
 */
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento, la preferencia dura lo que la pestaña */
  }
}

const THEME_KEY = "graphsast-theme";
const NODE_LIMIT_KEY = "graphsast-node-limit";
let theme: Theme = resolveTheme(
  readPref(THEME_KEY),
  window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false,
);
/** Nodos a partir de los cuales el grafo de un proyecto se recorta. */
let nodeLimit = resolveNodeLimit(readPref(NODE_LIMIT_KEY));

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
/** Lo último que se subió: cambiar el modo de entradas lo vuelve a analizar. */
let lastUploads: UploadedFile[] | null = null;
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
  const palette = graphPalette(theme);
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": NODE_FONT_SIZE,
        // Más chico que esto en pantalla no se lee: mejor no dibujarlo que una mancha.
        "min-zoomed-font-size": 6,
        "text-wrap": "wrap",
        "text-max-width": "80px",
        "background-color": "#475569",
        color: "#f8fafc",
        "text-outline-color": "#1e293b",
        "text-outline-width": palette.nodeLabelOutline,
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
      selector: "node.search-hit",
      style: {
        opacity: 1,
        "border-width": 5,
        "border-color": "#facc15",
        "z-index": 10,
      },
    },
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": palette.edge,
        "target-arrow-color": palette.edge,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": 10,
        "min-zoomed-font-size": 6,
        color: palette.edgeLabel,
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
        color: palette.riskLabel,
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
        d.kind ? `tipo: ${kindLabel(d.kind)}` : "",
        d.line ? `línea: ${d.line}` : "",
        d.code ? `código: ${d.code}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });
    cy.on("mouseover", "node", (evt) => showNodeTooltip(evt.target));
    cy.on("mouseout", "node", () => {
      nodeTooltip.hidden = true;
    });
    cy.on("viewport", () => {
      nodeTooltip.hidden = true;
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

/** Nombre del tipo de nodo para mostrar; un tipo desconocido queda como vino. */
function kindLabel(kind: string): string {
  return NODE_KIND_LABEL[kind as keyof typeof NODE_KIND_LABEL] ?? kind;
}

/** Tamaño de los rótulos de nodo, en px a zoom 1. */
const NODE_FONT_SIZE = 13;

/**
 * Zoom por debajo del cual los rótulos dejan de leerse: 13 px × 0.75 ≈ 10 px
 * en pantalla. Con 0.6 quedaban en 7 px; en un proyecto, un camino de diez
 * nodos encuadrado entero daba 0.27 (3 px) y no se leía nada.
 */
const MIN_READABLE_ZOOM = 0.75;

/**
 * Sin camino que mirar, el grafo entero se prefiere un poco chico (hasta
 * 13 px × 0.5 ≈ 6.5 px) antes que recortado: en los ejemplos corregidos
 * encuadrar todo da 0.6 y se lee; un archivo de un proyecto daba 0.34.
 */
const MIN_OVERVIEW_ZOOM = 0.5;

/**
 * Encuadra el grafo entero. Si así no se lee, encuadra lo que importa: el
 * camino del hallazgo elegido o, sin camino, las entradas, operaciones
 * peligrosas y filtros. Si eso tampoco entra legible, no lo achica más: lo
 * deja a zoom legible desde su entrada (`startId`, la primera entrada o el
 * rincón del grafo). Lo demás se recorre arrastrando. Devuelve si algo
 * quedó afuera de la vista.
 */
function fitGraph(instance: Core, startId: string | undefined): boolean {
  const path = instance.$(".risk-path");
  const onPath = !!startId && path.nonempty();
  instance.fit(undefined, 36);
  if (instance.zoom() >= (onPath ? MIN_READABLE_ZOOM : MIN_OVERVIEW_ZOOM)) return false;

  const roles = instance.nodes(".source, .sink, .sanitizer");
  const focus = onPath ? path : roles.nonempty() ? roles : null;
  if (focus) {
    instance.fit(focus, PATH_MARGIN);
    if (instance.zoom() >= MIN_READABLE_ZOOM) return false;
  }
  const target = focus ?? instance.elements();
  const box = target.boundingBox();
  const sources = onPath
    ? instance.nodes(".risk-path").filter((n) => n.id() === startId)
    : instance.nodes(".source");
  const anchor = sources.nonempty()
    ? (sources.first() as cytoscape.NodeSingular).position()
    : { x: box.x1, y: box.y1 };

  const zoom = MIN_READABLE_ZOOM;
  instance.zoom(zoom);
  instance.pan({
    x: axisPan(box.x1, box.x2, anchor.x, instance.width(), zoom),
    y: axisPan(box.y1, box.y2, anchor.y, instance.height(), zoom),
  });
  // Un camino apenas más grande que el mínimo entra igual: entonces no se avisa.
  return box.w * zoom > instance.width() || box.h * zoom > instance.height();
}

/**
 * Código completo del nodo bajo el puntero: la etiqueta del grafo es solo el
 * nombre o el callee. Texto, no HTML: es código del usuario.
 */
function showNodeTooltip(node: cytoscape.NodeSingular) {
  const d = node.data() as { kind?: string; code?: string; file?: string; line?: number };
  const head = document.createElement("strong");
  head.textContent = [d.kind && kindLabel(d.kind), d.file && d.line ? `${d.file}:${d.line}` : d.line ? `línea ${d.line}` : ""]
    .filter(Boolean)
    .join(" · ");
  const code = document.createElement("code");
  code.textContent = d.code ?? "";
  nodeTooltip.replaceChildren(head, code);
  nodeTooltip.hidden = false;

  // Al lado del nodo, sin salirse del grafo.
  const pos = node.renderedPosition();
  const wrap = nodeTooltip.parentElement!.getBoundingClientRect();
  const box = nodeTooltip.getBoundingClientRect();
  const offset = node.renderedOuterWidth() / 2 + 8;
  let left = pos.x + offset;
  if (left + box.width > wrap.width) left = Math.max(0, pos.x - offset - box.width);
  const top = Math.min(Math.max(0, pos.y - box.height / 2), Math.max(0, wrap.height - box.height));
  nodeTooltip.style.left = `${left}px`;
  nodeTooltip.style.top = `${top}px`;
}

/**
 * Título del veredicto para la web: el del motor dice "source → sink", que es
 * jerga; "detectadas" mantiene que no se afirma que el código sea seguro.
 */
function verdictTitle(verdict: Verdict): string {
  return verdict.kind === "clean" ? "Sin vulnerabilidades detectadas" : verdict.title;
}

type PipeState = "idle" | "active" | "done" | "alert";

function setPipe(step: HTMLLIElement, state: PipeState, status: string) {
  step.dataset.state = state;
  step.querySelector(".pipe-status")!.textContent = status;
}

/** Hay un análisis en curso: la barra de proceso lo muestra en el paso 2. */
let analyzing = false;

/** Barra de proceso: en qué paso está el usuario y qué dio cada uno. */
function renderPipeline() {
  const loaded = mode === "project" ? project !== null : graph !== null;
  const source = mode === "project"
    ? project
      ? plural(project.output.result.totals.files, "archivo", "archivos")
      : "Esperando una carpeta o archivos"
    : graph ? "Ejemplo cargado" : "Esperando un ejemplo";
  setPipe(pipeCode, loaded && !analyzing ? "done" : "active", source);

  if (analyzing) setPipe(pipeGraph, "active", "Siguiendo los datos…");
  else if (loaded) {
    const totals = project?.output.result.totals;
    setPipe(pipeGraph, "done", mode === "project" && totals
      ? `${totals.lines.toLocaleString("es")} líneas recorridas`
        + (totals.crossFileCalls > 0
          ? ` · ${plural(totals.crossFileCalls, "llamada", "llamadas")} entre archivos`
          : "")
      : `${plural(graph!.nodes.length, "nodo", "nodos")} en el grafo`);
  } else setPipe(pipeGraph, "idle", "Sin analizar");

  const verdict = lastVerdict;
  if (analyzing || !loaded || !verdict) setPipe(pipeResult, "idle", "Sin analizar");
  else setPipe(pipeResult, verdict.kind === "vulnerable" ? "alert" : "done", verdictTitle(verdict));
}

/** El aviso sobre el grafo vacío: `null` lo oculta. */
function setGraphEmpty(text: string | null) {
  graphEmpty.hidden = text === null;
  if (text !== null) graphEmptyText.textContent = text;
}

function renderGraph() {
  if (!graph) return;
  setGraphEmpty(null);
  const finding = currentHighlight();
  const view = mode === "project"
    ? focusGraph(graph, { path: finding?.path, file: selectedFile }, nodeLimit)
    : { graph, total: graph.nodes.length };
  renderGraphNote(view.graph.nodes.length, view.total, !!finding);
  const instance = ensureCy();
  instance.json({
    elements: toCytoscapeElements(view.graph, {
      highlight: finding,
      roles: lastRoles,
      visibleEdges: visibleEdgeKinds(),
      dimNonPath: dimToggle.checked && !!finding,
    }),
  });
  const layout = {
    name: "breadthfirst",
    directed: true,
    padding: 36,
    // Sin contar la etiqueta, el layout separa círculos de 58px mientras el
    // texto ocupa hasta 80: en grafos de más de diez nodos los rótulos se
    // pisaban y no se leía cuál era cuál. La separación mínima sale del ancho
    // del rótulo y se aplica en los dos ejes, así que un rótulo más angosto
    // (en dos líneas) y 1.15 en vez de 1.3 compactan el grafo sin pisarse.
    nodeDimensionsIncludeLabels: true,
    avoidOverlap: true,
    spacingFactor: 1.15,
  } as const;
  const fitZoom = () => {
    const box = instance.elements().boundingBox();
    return Math.min(instance.width() / box.w, instance.height() / box.h);
  };
  // El breadthfirst apila los niveles hacia abajo: un camino largo quedaba
  // como una columna angosta en un recuadro apaisado (zoom 0.27). Se dibuja
  // también rotado (de izquierda a derecha) y queda el que entra más grande.
  instance.layout(layout).run();
  const asIs = fitZoom();
  instance.layout({ ...layout, transform: (_node, pos) => ({ x: pos.y, y: pos.x }) }).run();
  if (fitZoom() <= asIs * 1.1) instance.layout(layout).run();
  if (fitGraph(instance, finding?.path[0])) {
    graphNote.hidden = false;
    graphNote.textContent = `${graphNote.textContent} ${finding ? "El camino" : "El grafo"} no entra `
      .trimStart()
      + "entero a un tamaño legible: arrastrá para recorrerlo o tocá «Centrar» para verlo completo.";
  }
  applySearch(false);
  renderCodeHighlight();
}

/**
 * Marca los nodos dibujados que coinciden con la búsqueda; con `focus`,
 * encuadra la primera coincidencia y sus vecinos. Busca en lo dibujado: en un
 * proyecto grande es el recorte alrededor del hallazgo elegido.
 */
function applySearch(focus: boolean) {
  const query = graphSearch.value;
  if (!cy) {
    graphSearchCount.textContent = "";
    return;
  }
  cy.nodes().removeClass("search-hit");
  if (!query.trim()) {
    graphSearchCount.textContent = "";
    return;
  }
  const hits = cy.nodes().filter((n) => nodeMatchesQuery(n.data(), query));
  hits.addClass("search-hit");
  graphSearchCount.textContent = hits.empty()
    ? "Sin coincidencias en el grafo dibujado"
    : plural(hits.length, "coincidencia", "coincidencias");
  if (focus && hits.nonempty()) {
    cy.animate({ fit: { eles: hits.first().closedNeighborhood(), padding: 60 } }, { duration: 250 });
  }
}

/** Descarga un archivo generado en el navegador. */
function download(name: string, href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

function exportPng() {
  if (!cy || cy.elements().empty()) {
    statusEl.textContent = "No hay grafo para exportar todavía.";
    return;
  }
  download("graphsast-grafo.png", cy.png({ full: true, scale: 2, bg: graphPalette(theme).background }));
}

function exportJson() {
  if (!graph) {
    statusEl.textContent = "No hay grafo para exportar todavía.";
    return;
  }
  const data = graphExport(graph, findings, { generator: "GraphSAST", version: VERSION });
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  download("graphsast-grafo.json", url);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Avisa cuando el grafo dibujado es un recorte del que se analizó. */
function renderGraphNote(shown: number, total: number, onPath: boolean) {
  graphNote.hidden = shown === total;
  graphNote.textContent = shown === total
    ? ""
    : `Se muestran ${shown} de ${total} nodos: `
      + (onPath
        ? "el camino del dato y sus vecinos inmediatos."
        : `los de ${selectedFile ?? "este archivo"}.`)
      + " El análisis recorrió el grafo completo.";
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
  setGraphEmpty(GRAPH_EMPTY_TEXT);
  graphNote.hidden = true;
  verdictEl.hidden = true;
  readingEl.textContent = "";
  findingsList.innerHTML = "";
  statsEl.hidden = true;
  codeLinesEl.innerHTML = "";
  projectCode.innerHTML = "";
  nodeDetail.textContent = "";
  renderPipeline();
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
    .map(([k, v]) => `${EDGE_KIND_LABEL[k as keyof typeof EDGE_KIND_LABEL] ?? k}: ${v}`)
    .join(" · ");
  statsEl.innerHTML = `
    <dt>Tiempo</dt><dd>${lastStats.elapsedMs} ms</dd>
    <dt>Líneas</dt><dd>${lastStats.lineCount}</dd>
    <dt>Partes del código</dt><dd>${lastStats.nodeCount}</dd>
    <dt>Conexiones</dt><dd>${lastStats.edgeCount}</dd>
    <dt>Por tipo</dt><dd>${kinds}</dd>
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
    conteo.textContent = `${plural(entry.sinks, "operación peligrosa", "operaciones peligrosas")} · `
      + `${plural(entry.sanitizers, "filtro conocido", "filtros conocidos")}`;
    li.appendChild(conteo);
    catalogList.appendChild(li);
  }
}

function renderEngineBadge() {
  engineBadge.textContent = lastEngine === "neo4j" ? "Neo4j" : "Memoria";
  engineBadge.className = `engine-badge ${lastEngine}`;
  // En el navegador siempre es el motor en memoria: la etiqueta solo informa con Neo4j.
  engineBadge.hidden = lastEngine !== "neo4j";
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
  renderPipeline();
  verdictEl.hidden = false;
  const verdict = lastVerdict;
  if (!verdict) {
    // Solo se llega acá sin analizar; tras un análisis hay fallback.
    verdictEl.className = "verdict unknown";
    verdictEl.textContent = mode === "project"
      ? "Subí una carpeta o archivos. Acá vas a ver si hay vulnerabilidades, por qué son peligrosas y cómo corregirlas."
      : "Sin analizar todavía.";
    return;
  }
  verdictEl.className = VERDICT_CLASS[verdict.kind];
  verdictEl.innerHTML = "";
  const title = document.createElement("strong");
  title.textContent = verdictTitle(verdict);
  const detail = document.createElement("p");
  detail.className = "verdict-detail";
  detail.textContent = verdict.detail;
  verdictEl.append(title, detail);
}

/**
 * Sin hallazgos, una frase que dice por qué no lo hay en vez de dejar el
 * panel en blanco. Con un hallazgo elegido, la explicación lo reemplaza.
 */
function renderReading() {
  const finding = currentHighlight();
  renderExplanation();
  if (!graph || finding) {
    readingEl.textContent = "";
    return;
  }
  // En un proyecto, los totales del proyecto, igual que el veredicto: el grafo
  // dibujado es el de un archivo y contaría otra cosa.
  readingEl.textContent = mode === "project" && project
    ? describeNoFinding(project.sources, project.sinks)
    : describeNoFinding(lastRoles.sourceIds.length, lastRoles.sinkIds.length);
}

function renderFindings() {
  findingsList.innerHTML = "";
  renderVerdict();
  renderReading();

  if (mode === "project") {
    if (projectItems.length === 0) {
      // Sin proyecto, el veredicto ya dice qué hacer.
      if (!project) return;
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Sin hallazgos en el proyecto.";
      findingsList.appendChild(li);
      return;
    }
    renderFindingGroups();
    return;
  }

  if (!graph || findings.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    const sinks = lastRoles.sinkIds.length;
    const sources = lastRoles.sourceIds.length;
    li.textContent = graph
      ? `Ningún dato del usuario llega a una operación peligrosa (${plural(sources, "entrada", "entradas")}, ${plural(sinks, "operación peligrosa", "operaciones peligrosas")} en el grafo).`
      : "Todavía no hay resultados.";
    findingsList.appendChild(li);
    return;
  }
  renderFindingGroups();
}

/** Lo que muestra la tarjeta de un hallazgo, igual en un ejemplo y en un proyecto. */
interface FindingEntry {
  /** `highlightIndex` en un ejemplo; índice de `projectItems` en un proyecto. */
  index: number;
  /** Mismo destino ⇔ misma clave. */
  key: string;
  heading: string;
  where: string;
  file: string;
  sinkCode: string;
  sourceLabel: string;
  length: number;
}

function headingOf(cwe: number | undefined, cweName: string | undefined): string {
  return cwe ? `${cweName ?? "Vulnerabilidad"} · CWE-${cwe}` : "Flujo sin sanitizar";
}

function findingEntries(): FindingEntry[] {
  if (mode === "project") {
    return projectItems.map(({ finding: f }, index) => ({
      index,
      key: `${f.file}:${f.sink.line}:${f.sink.col}`,
      heading: headingOf(f.cwe, f.cweName),
      where: `${f.file.slice(f.file.lastIndexOf("/") + 1)}:${f.sink.line}`,
      file: f.file,
      sinkCode: f.sink.code,
      sourceLabel: f.source.name,
      length: f.steps.length,
    }));
  }
  const byId = new Map(graph!.nodes.map((n) => [n.id, n]));
  return findings.flatMap((f, index) => {
    const sink = byId.get(f.sinkId);
    const source = byId.get(f.sourceId);
    if (!sink || !source) return [];
    return [{
      index,
      key: f.sinkId,
      heading: headingOf(f.cwe, f.cweName),
      where: whereOf(sink),
      file: sink.loc.file,
      sinkCode: sink.code,
      sourceLabel: stepLabel(source),
      length: f.path.length,
    }];
  });
}

function selectedIndex(): number {
  return mode === "project" ? selectedItem : highlightIndex;
}

function selectEntry(index: number) {
  if (mode === "project") {
    selectProjectItem(index);
    return;
  }
  highlightIndex = index;
  renderFindings();
  renderGraph();
}

/** Grupos de caminos al mismo destino, en el orden de la lista. */
function findingGroups(): FindingEntry[][] {
  return groupBySink(findingEntries(), (e) => e.key, (e) => e.length);
}

function uniqueSources(group: FindingEntry[]): string[] {
  return [...new Set(group.map((e) => e.sourceLabel))];
}

/**
 * Una tarjeta por destino. Texto, no HTML: el destino y las entradas son
 * código del usuario (`o["<img onerror=...>"]()` es un callee válido).
 */
function renderFindingGroups() {
  const selected = selectedIndex();
  for (const group of findingGroups()) {
    const first = group[0]!;
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = group.some((e) => e.index === selected) ? "active" : "";
    const title = document.createElement("strong");
    title.textContent = first.heading;
    const where = document.createElement("span");
    where.className = "finding-location";
    where.textContent = first.where;
    where.title = first.file;
    const sink = document.createElement("span");
    sink.className = "finding-sink";
    sink.textContent = first.sinkCode.split("\n")[0]!.trim();
    const sources = document.createElement("span");
    sources.className = "finding-sources";
    const names = uniqueSources(group);
    sources.textContent = group.length === 1
      ? `Entra por ${names[0]}`
      : `${group.length} caminos llegan acá, desde ${names.join(", ")}`;
    btn.append(title, where, sink, sources);
    btn.addEventListener("click", () => {
      if (!group.some((e) => e.index === selectedIndex())) selectEntry(first.index);
    });
    li.appendChild(btn);
    findingsList.appendChild(li);
  }
}

function textBlock(tag: "p" | "code", text: string, className?: string): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

/** `req` · demo.ts:1 */
function labelWithWhere(label: string, where: string): HTMLElement {
  const line = document.createElement("div");
  line.append(textBlock("code", label), ` · ${where}`);
  return line;
}

/** Explicación del hallazgo elegido: de dónde viene, a dónde llega, qué faltó, cómo se corrige. */
function renderExplanation() {
  const finding = currentHighlight();
  const explanation = graph && finding
    ? explainFinding(graph, finding, finding.cwe ? CATALOG.get(finding.cwe) : undefined)
    : null;
  explainEl.hidden = !explanation;
  chatPanel.setContext(explanation ? chatContext(explanation) : null);
  if (!explanation) return;

  explainSummary.textContent = `${explanation.title}: ${explanation.summary}`;

  explainSource.replaceChildren(
    labelWithWhere(explanation.source.label, explanation.source.where),
    textBlock("p", explanation.source.why),
  );

  const { sink } = explanation;
  explainSink.replaceChildren(
    labelWithWhere(sink.label, sink.where),
    textBlock("code", sink.code, "explain-code"),
    textBlock("p", sink.why),
    ...(sink.attack ? [textBlock("p", `Ejemplo de ataque: ${sink.attack}`, "explain-attack")] : []),
  );

  explainMissing.replaceChildren(textBlock("p", explanation.missing));
  explainFixItem.hidden = !explanation.fix;
  explainFix.replaceChildren(textBlock("p", explanation.fix ?? ""));

  // Otros caminos al mismo destino: cambian el resaltado sin salir de la explicación.
  const current = selectedIndex();
  const group = findingGroups().find((g) => g.some((e) => e.index === current)) ?? [];
  const others = group.filter((e) => e.index !== current);
  explainOthers.hidden = others.length === 0;
  explainOthers.replaceChildren();
  if (others.length > 0) {
    explainOthers.append(
      others.length === 1
        ? "Otro camino llega al mismo destino, desde: "
        : `Otros ${others.length} caminos llegan al mismo destino, desde: `,
    );
    for (const other of others) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = other.sourceLabel;
      btn.title = `Ver el camino que empieza en ${other.sourceLabel}`;
      btn.addEventListener("click", () => selectEntry(other.index));
      explainOthers.append(btn);
    }
  }

  explainPathSummary.textContent = `Ver el camino completo (${explanation.steps.length} nodos)`;
  explainPath.replaceChildren(
    ...explanation.steps.map((step) => {
      const li = document.createElement("li");
      li.append(textBlock("code", step.label), textBlock("code", ` · ${NODE_KIND_LABEL[step.kind]} · línea ${step.line}`, "step-where"));
      if (step.newFile) li.append(textBlock("code", `en ${step.file}`, "step-file"));
      return li;
    }),
  );
}

/** Archivos subidos con su cantidad de hallazgos o el motivo por el que no se analizaron. */
function renderFileList() {
  fileList.innerHTML = "";
  if (!project) return;
  const { files } = project.output.result;
  const vulnerableCount = files.filter((f) => f.findings.length > 0).length;
  onlyVulnerableLabel.textContent = `Solo con vulnerabilidades (${vulnerableCount})`;
  onlyVulnerable.disabled = vulnerableCount === 0;
  for (const file of filesForList(files, onlyVulnerable.checked && vulnerableCount > 0)) {
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
    setGraphEmpty("Este archivo no tiene funciones ni datos que seguir.");
    graphNote.hidden = true;
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
  // El camino más corto del primer destino de ese archivo: es el que mejor se sigue.
  const group = findingGroups().find((g) => g[0]!.file === file);
  if (group) {
    selectProjectItem(group[0]!.index);
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
  if (projectItems.length > 0) selectProjectItem(findingGroups()[0]![0]!.index);
  else if (firstFile) selectProjectFile(firstFile);
  else {
    clearAnalysisView();
    renderFileList();
    renderFindings();
  }
}

async function scanUploads(uploads: UploadedFile[]) {
  const selection = selectUploads(
    uploads,
    await gitignoreFilter(uploads),
    await gitignoreFilter(uploads, GRAPHSAST_IGNORE_FILE),
  );
  selectionSummary.hidden = false;
  selectionSummary.textContent = describeSelection(selection);
  if (selection.accepted.length === 0) {
    statusEl.textContent = "No hay archivos JavaScript o TypeScript para analizar.";
    return;
  }

  lastUploads = uploads;
  folderInput.disabled = true;
  filesInput.disabled = true;
  sourceModeSelect.disabled = true;
  dropZone.classList.add("busy");
  scanProgress.hidden = false;
  scanProgress.max = selection.accepted.length;
  scanProgress.value = 0;
  statusEl.textContent = "Preparando el analizador…";
  analyzing = true;
  renderPipeline();
  const started = performance.now();
  try {
    project = await analyzeProject(selection.accepted, (done, total, file) => {
      scanProgress.value = done;
      statusEl.textContent = `Analizando ${done + 1} de ${total}: ${file}`;
    }, selection.configs, sourceModeSelect.value as SourceMode);
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
    sourceModeSelect.disabled = false;
    dropZone.classList.remove("busy");
    scanProgress.hidden = true;
    analyzing = false;
    renderPipeline();
  }
}

/** Cambia de pestaña y vuelve a dibujar lo que corresponde a cada una. */
function setMode(next: Mode) {
  mode = next;
  tabProject.setAttribute("aria-selected", String(next === "project"));
  tabExamples.setAttribute("aria-selected", String(next === "examples"));
  projectModeEl.hidden = next !== "project";
  examplesModeEl.hidden = next !== "examples";
  // Los ejemplos se dibujan enteros: el límite es solo para proyectos.
  nodeLimitSelect.parentElement!.hidden = next !== "project";
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
  analyzing = true;
  renderPipeline();
  try {
    const data = await analyzeSnippet(submittedCode, "demo.ts");
    // Si el usuario cambió de pestaña mientras tanto, el resultado queda
    // guardado para cuando vuelva, pero no pisa lo que está mirando.
    snippet = data;
    analyzedCode = submittedCode;
    if (mode !== "examples") return;
    showSnippet(data);

    const roleHint = `${plural(lastRoles.sourceIds.length, "entrada del usuario", "entradas del usuario")} · `
      + plural(lastRoles.sinkIds.length, "operación peligrosa", "operaciones peligrosas");
    statusEl.textContent = lastVerdict && !lastVerdict.conclusive
      ? `${lastVerdict.title} · ${lastStats?.elapsedMs ?? "?"} ms`
      : `Análisis en ${lastStats?.elapsedMs ?? "?"} ms · ${plural(findings.length, "hallazgo", "hallazgos")} · ${roleHint}`;
  } catch (err) {
    snippet = null;
    analyzedCode = null;
    if (mode !== "examples") return;
    clearAnalysisView();
    statusEl.textContent = `Error: ${err}`;
  } finally {
    analyzeBtn.disabled = false;
    analyzing = false;
    renderPipeline();
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
exportPngBtn.addEventListener("click", exportPng);
exportJsonBtn.addEventListener("click", exportJson);
graphSearch.addEventListener("input", () => applySearch(false));
graphSearch.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    applySearch(true);
  }
});
edgeFilters.addEventListener("change", () => renderGraph());
onlyVulnerable.addEventListener("change", () => renderFileList());
// Con un proyecto ya subido, el cambio se ve enseguida: no hace falta volver a elegir la carpeta.
sourceModeSelect.addEventListener("change", () => {
  if (lastUploads) void scanUploads(lastUploads);
});
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

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "Tema claro" : "Tema oscuro";
  cy?.style(cytoscapeStyle());
}

function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  writePref(THEME_KEY, theme);
  applyTheme();
}

/** Hallazgo siguiente o anterior, en el proyecto o en el ejemplo. */
function stepFinding(delta: 1 | -1) {
  // De destino en destino: los caminos al mismo destino se eligen desde la explicación.
  const groups = findingGroups();
  const current = groups.findIndex((g) => g.some((e) => e.index === selectedIndex()));
  const next = stepIndex(current, groups.length, delta);
  if (next >= 0) selectEntry(groups[next]![0]!.index);
}

function runShortcut(action: ShortcutAction) {
  switch (action) {
    case "next-finding":
      stepFinding(1);
      break;
    case "prev-finding":
      stepFinding(-1);
      break;
    case "fit":
      cy?.fit(undefined, 36);
      break;
    case "search":
      graphSearch.focus();
      graphSearch.select();
      break;
    case "toggle-dim":
      dimToggle.checked = !dimToggle.checked;
      renderGraph();
      break;
    case "toggle-theme":
      toggleTheme();
      break;
  }
}

themeToggle.addEventListener("click", toggleTheme);
nodeLimitSelect.value = nodeLimitValue(nodeLimit);
nodeLimitSelect.addEventListener("change", () => {
  nodeLimit = resolveNodeLimit(nodeLimitSelect.value);
  writePref(NODE_LIMIT_KEY, nodeLimitValue(nodeLimit));
  renderGraph();
});
graphSearch.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  graphSearch.value = "";
  applySearch(false);
  graphSearch.blur();
});
document.addEventListener("keydown", (e) => {
  const target = e.target instanceof HTMLElement ? e.target : null;
  const action = shortcutFor({
    key: e.key,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
    targetTag: target?.tagName,
    targetEditable: target?.isContentEditable,
  });
  if (!action) return;
  e.preventDefault();
  runShortcut(action);
});

applyTheme();
setMode("project");
