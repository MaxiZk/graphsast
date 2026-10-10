import type { ScanFinding, ScanResult } from "../types.js";

interface TextOptions {
  color?: boolean;
  /** Mostrar el camino completo, no solo source y sink. */
  showPath?: boolean;
  /** Un bloque por hallazgo, con línea y código de cada paso. */
  verbose?: boolean;
}

const CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  cyan: "\u001b[36m",
};

function painter(enabled: boolean) {
  return (code: keyof typeof CODES, text: string): string =>
    enabled ? `${CODES[code]}${text}${CODES.reset}` : text;
}

function findingBlock(
  f: ScanFinding,
  index: number,
  c: ReturnType<typeof painter>,
  showPath: boolean,
): string[] {
  const cwe = cweLabel(f);
  const title = f.cweName ?? "Flujo no sanitizado";
  const lines: string[] = [];

  lines.push(
    `${c("red", `${index}. ${cwe}`)} ${c("bold", title)}`,
  );
  lines.push(
    `   ${c("dim", "en")} ${c("cyan", `${f.file}:${f.sink.line}:${f.sink.col}`)}`,
  );

  const steps = showPath ? f.steps : [f.source, f.sink];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const arrow = i === 0 ? "source" : i === steps.length - 1 ? "sink  " : "      ";
    const label = c("dim", arrow);
    // Un paso en otro archivo que el del sink lleva su ruta.
    const loc = c("dim", s.file === f.file ? `L${String(s.line).padStart(3)}` : `${s.file}:${s.line}`);
    const code = s.code.length > 88 ? `${s.code.slice(0, 85)}...` : s.code;
    lines.push(`   ${label} ${loc}  ${code}`);
  }

  if (f.ruleId) lines.push(`   ${c("dim", `regla: ${f.ruleId}`)}`);
  return lines;
}

/**
 * `req → data → Finance.create`, sin repetir pasos consecutivos iguales.
 * Cuando el camino cambia de archivo, el paso lleva `(archivo:línea)`:
 * `req (src/controller.ts:3) → findUser → id (src/service.ts:1) → db.query`.
 */
function pathLabel(f: ScanFinding, showPath: boolean): string {
  const steps = showPath ? f.steps : [f.source, f.sink];
  const parts: string[] = [];
  let prevName: string | null = null;
  steps.forEach((s, i) => {
    const name = s.name || s.code;
    const moved = s.file !== (i === 0 ? f.file : steps[i - 1]!.file);
    if (!moved && name === prevName) return;
    parts.push(moved ? `${name} (${s.file}:${s.line})` : name);
    prevName = name;
  });
  return parts.join(" → ");
}

/** Una línea por hallazgo: `  L12  CWE-943  req.body → data → Finance.create`. */
function findingLines(
  findings: ScanFinding[],
  c: ReturnType<typeof painter>,
  showPath: boolean,
): string[] {
  const lineWidth = Math.max(...findings.map((f) => `L${f.sink.line}`.length));
  const cweWidth = Math.max(...findings.map((f) => cweLabel(f).length));
  return findings.map((f) => {
    const line = c("cyan", `L${f.sink.line}`.padEnd(lineWidth));
    const cwe = c("red", cweLabel(f).padEnd(cweWidth));
    return `  ${line}  ${cwe}  ${pathLabel(f, showPath)}`;
  });
}

function cweLabel(f: ScanFinding): string {
  return f.cwe ? `CWE-${f.cwe}` : "sin CWE";
}

export function reportToText(
  result: ScanResult,
  options: TextOptions = {},
): string {
  const c = painter(options.color ?? false);
  const showPath = options.showPath ?? true;
  const verbose = options.verbose ?? false;
  const out: string[] = [];

  out.push(c("bold", "GraphSAST — análisis estático de flujo de datos"));
  out.push(c("dim", `raíz: ${result.root}`));
  out.push("");

  if (result.findings.length === 0) {
    out.push(c("green", "Sin hallazgos."));
  } else {
    const byFile = new Map<string, ScanFinding[]>();
    for (const f of result.findings) {
      const list = byFile.get(f.file);
      if (list) list.push(f);
      else byFile.set(f.file, [f]);
    }
    let index = 1;
    for (const [file, findings] of byFile) {
      out.push(c("bold", file));
      if (verbose) {
        for (const f of findings) {
          out.push(...findingBlock(f, index++, c, showPath));
          out.push("");
        }
      } else {
        out.push(...findingLines(findings, c, showPath), "");
      }
    }
  }

  const t = result.totals;
  const msPerLine = t.lines === 0 ? 0 : t.elapsedMs / t.lines;
  out.push(c("dim", "─".repeat(60)));
  out.push(
    `${t.findings} hallazgo(s) en ${t.filesWithFindings}/${t.files} archivo(s) · `
    + `${t.lines} líneas · ${t.elapsedMs.toFixed(0)} ms (${msPerLine.toFixed(2)} ms/línea)`
    + ((t.crossFileCalls ?? 0) > 0 ? ` · ${t.crossFileCalls} llamada(s) entre archivos` : ""),
  );
  if (t.errors > 0) {
    out.push(c("yellow", `${t.errors} archivo(s) no pudieron analizarse.`));
    for (const f of result.files.filter((r) => r.error)) {
      out.push(c("dim", `  ${f.file}: ${f.error}`));
    }
  }
  return out.join("\n");
}
