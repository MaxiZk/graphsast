import { reportToHtml, type VizAnalysisReport } from "./report-html.js";

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadHtmlReport(report: VizAnalysisReport) {
  const html = reportToHtml(report);
  downloadText(`graphsast-report-${Date.now()}.html`, html, "text/html;charset=utf-8");
}

export function printHtmlReport(report: VizAnalysisReport) {
  const html = reportToHtml(report);
  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!win) {
    throw new Error("El navegador bloqueó la ventana emergente.");
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}
