import type { ScanResult } from "../scan/types.js";

/** Códigos de salida del CLI: lo que un pipeline de CI usa para cortar un merge. */
export const EXIT = {
  /** Análisis completo, sin hallazgos. */
  CLEAN: 0,
  /** Análisis completo, con hallazgos. */
  FINDINGS: 1,
  /** Error de ejecución: el análisis no fue completo. */
  ERROR: 2,
} as const;

export interface ExitPolicy {
  /** Con hallazgos, salir igual con 0. No enmascara el código 2. */
  exitZero?: boolean;
  /** Solo estos CWE provocan el código 1 (ausente o vacío = todos). */
  failOn?: number[];
}

/**
 * Un análisis sin archivos o con archivos que no se pudieron analizar no es
 * completo: da 2, aunque también haya hallazgos. Un verde sobre un análisis
 * parcial dejaría pasar el merge sin haber mirado todo el código.
 */
export function exitCodeFor(result: ScanResult, policy: ExitPolicy = {}): number {
  if (result.totals.files === 0 || result.totals.errors > 0) return EXIT.ERROR;
  if (policy.exitZero) return EXIT.CLEAN;
  const failOn = policy.failOn ?? [];
  const failing = failOn.length
    ? result.findings.filter((f) => f.cwe !== undefined && failOn.includes(f.cwe))
    : result.findings;
  return failing.length > 0 ? EXIT.FINDINGS : EXIT.CLEAN;
}

/** `cwe-89`, `CWE-89` o `89` → 89; cualquier otra cosa → null. */
export function parseCweFamily(raw: string): number | null {
  const match = /^(?:cwe-)?(\d+)$/i.exec(raw.trim());
  return match ? Number(match[1]) : null;
}
