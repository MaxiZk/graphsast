/** Subconjunto del informe que devuelve /api/analyze (sin depender de @graphsast/core en el browser). */
export interface VizAnalysisReport {
  analyzedAt: string;
  engine: string;
  code: string;
  file: string;
  findings: {
    sourceId: string;
    sinkId: string;
    path: string[];
    sanitized: boolean;
    cwe?: number;
    cweName?: string;
    ruleId?: string;
  }[];
  stats: {
    elapsedMs: number;
    lineCount: number;
    nodeCount: number;
    edgeCount: number;
    findingCount: number;
  };
  catalog?: { cwe: number; name: string }[];
}

import type { ScanResult } from "@graphsast/core/browser";
import { plural } from "./labels.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `<style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
    h1 { font-size: 1.4rem; }
    .meta { color: #555; font-size: 0.9rem; }
    .warn { background: #fef3c7; border: 1px solid #f59e0b; padding: 0.75rem; border-radius: 6px; }
    .ok { background: #dcfce7; border: 1px solid #22c55e; padding: 0.75rem; border-radius: 6px; }
    pre { background: #f4f4f5; padding: 1rem; overflow: auto; font-size: 0.8rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; font-size: 0.85rem; }
    th { background: #f4f4f5; }
    @media print { body { margin: 1cm; } }
    .muted { color: #555; }
  </style>`;

export function reportToHtml(report: VizAnalysisReport): string {
  const findingRows = report.findings.length
    ? report.findings
        .map((f, i) => {
          const cwe = f.cwe ? `CWE-${f.cwe}` : "—";
          const path = f.path.map((id) => esc(id)).join(" → ");
          return `<tr>
            <td>${i + 1}</td>
            <td>${cwe}</td>
            <td>${esc(f.cweName ?? "")}</td>
            <td><code>${path}</code></td>
          </tr>`;
        })
        .join("\n")
    : `<tr><td colspan="4">Sin hallazgos</td></tr>`;

  const catalogRows = (report.catalog ?? [])
    .map((c) => `<li>CWE-${c.cwe}: ${esc(c.name)}</li>`)
    .join("\n");

  const resumen = report.findings.length === 0
    ? "Sin caminos source → sink sin sanitizar."
    : report.findings.length === 1
      ? "<strong>1 vulnerabilidad</strong> detectada."
      : `<strong>${report.findings.length} vulnerabilidades</strong> detectadas.`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>GraphSAST — Informe</title>
  ${STYLE}
</head>
<body>
  <h1>GraphSAST — Informe de análisis</h1>
  <p class="meta">Generado: ${esc(report.analyzedAt)} · Motor: ${report.engine} · Archivo: ${esc(report.file)}</p>
  <p class="meta">${report.stats.elapsedMs} ms · ${plural(report.stats.lineCount, "línea", "líneas")} · ${plural(report.stats.nodeCount, "nodo", "nodos")} · ${plural(report.stats.edgeCount, "arista", "aristas")}</p>

  <div class="${report.findings.length ? "warn" : "ok"}">
    ${resumen}
  </div>

  <h2>Hallazgos</h2>
  <table>
    <thead><tr><th>#</th><th>CWE</th><th>Nombre</th><th>Camino</th></tr></thead>
    <tbody>${findingRows}</tbody>
  </table>

  <h2>Catálogo CWE activo</h2>
  <ul>${catalogRows || "<li>—</li>"}</ul>

  <h2>Código analizado</h2>
  <pre>${esc(report.code)}</pre>
</body>
</html>`;
}

/** Informe de un proyecto subido: hallazgos por archivo, con el camino completo. */
export function projectReportToHtml(result: ScanResult): string {
  const { totals } = result;
  const findingRows = result.findings.length
    ? result.findings
        .map((f, i) => {
          const cwe = f.cwe ? `CWE-${f.cwe}` : "—";
          const path = f.steps
            .map((s) => `${esc(s.file)}:${s.line} <code>${esc(s.name)}</code>`)
            .join("<br>→ ");
          return `<tr>
            <td>${i + 1}</td>
            <td>${cwe}</td>
            <td>${esc(f.cweName ?? "")}</td>
            <td>${esc(f.file)}:${f.sink.line}</td>
            <td>${path}</td>
          </tr>`;
        })
        .join("\n")
    : `<tr><td colspan="5">Sin hallazgos</td></tr>`;

  const errorRows = result.files
    .filter((f) => f.error)
    .map((f) => `<li>${esc(f.file)}: ${esc(f.error!)}</li>`)
    .join("\n");

  const resumen = totals.findings === 0
    ? "Sin caminos source → sink sin sanitizar."
    : `<strong>${plural(totals.findings, "vulnerabilidad", "vulnerabilidades")}</strong> `
      + `en ${plural(totals.filesWithFindings, "archivo", "archivos")}.`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>GraphSAST — Informe del proyecto</title>
  ${STYLE}
</head>
<body>
  <h1>GraphSAST — Informe del proyecto</h1>
  <p class="meta">Generado: ${esc(result.analyzedAt)} · Análisis en el navegador</p>
  <p class="meta">${plural(totals.files, "archivo", "archivos")} · ${plural(totals.lines, "línea", "líneas")} · ${plural(totals.crossFileCalls, "llamada", "llamadas")} entre archivos · ${Math.round(totals.elapsedMs)} ms</p>

  <div class="${totals.findings ? "warn" : "ok"}">
    ${resumen}
  </div>

  <h2>Hallazgos</h2>
  <table>
    <thead><tr><th>#</th><th>CWE</th><th>Nombre</th><th>Ubicación</th><th>Camino</th></tr></thead>
    <tbody>${findingRows}</tbody>
  </table>

  ${errorRows ? `<h2>Archivos no analizados</h2>\n  <ul class="muted">${errorRows}</ul>` : ""}
</body>
</html>`;
}
