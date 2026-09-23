import type { ScanResult } from "@graphsast/core/browser";
import { projectReportToHtml, reportToHtml, type VizAnalysisReport } from "./report-html.js";

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadHtml(html: string) {
  downloadText(`graphsast-report-${Date.now()}.html`, html, "text/html;charset=utf-8");
}

function printHtml(html: string) {
  // Sin `noopener`: con él `window.open` devuelve null siempre y no hay
  // ventana donde escribir el informe. La ventana es un about:blank propio.
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    throw new Error("El navegador bloqueó la ventana emergente.");
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export function downloadHtmlReport(report: VizAnalysisReport) {
  downloadHtml(reportToHtml(report));
}

export function printHtmlReport(report: VizAnalysisReport) {
  printHtml(reportToHtml(report));
}

export function downloadProjectReport(result: ScanResult) {
  downloadHtml(projectReportToHtml(result));
}

export function printProjectReport(result: ScanResult) {
  printHtml(projectReportToHtml(result));
}
