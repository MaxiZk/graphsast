import type { AnalysisReport } from "./json.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function reportToHtml(report: AnalysisReport): string {
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

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>GraphSAST — Informe</title>
  <style>
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
  </style>
</head>
<body>
  <h1>GraphSAST — Informe de análisis</h1>
  <p class="meta">Generado: ${esc(report.analyzedAt)} · Motor: ${report.engine} · Archivo: ${esc(report.file)}</p>
  <p class="meta">${report.stats.elapsedMs} ms · ${report.stats.lineCount} líneas · ${report.stats.nodeCount} nodos · ${report.stats.edgeCount} aristas</p>

  <div class="${report.findings.length ? "warn" : "ok"}">
    ${report.findings.length
      ? `<strong>${report.findings.length} vulnerabilidad(es)</strong> detectada(s).`
      : "Sin caminos source → sink sin sanitizar."}
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
