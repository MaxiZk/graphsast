/**
 * Validación externa: la etiqueta NO la escribe el autor del analizador, sino
 * el advisory de seguridad publicado (GitHub Security Advisory / CVE) y el
 * mantenedor que publicó la versión corregida.
 */
export interface CveCase {
  /** Identificador del advisory de GitHub (p. ej. GHSA-xxxx-xxxx-xxxx). */
  ghsaId: string;
  /** CVE asociado, si el advisory lo tiene. */
  cveId: string | null;
  /** Paquete npm afectado. */
  package: string;
  /** Última versión publicada ANTES del arreglo (vulnerable por definición). */
  vulnerableVersion: string;
  /** Primera versión con el arreglo, según el advisory. */
  fixedVersion: string;
  /** CWE declarado por el advisory. */
  cwe: number;
  severity: string;
  summary: string;
  advisoryUrl: string;
}

export interface CveCorpus {
  /** Cuándo se congeló el manifiesto (reproducibilidad). */
  fetchedAt: string;
  source: string;
  cases: CveCase[];
}

export type CveOutcome =
  /** Reportó un hallazgo del CWE correcto en la versión vulnerable. */
  | "detected"
  /** No reportó nada del CWE correcto en la versión vulnerable. */
  | "missed"
  /** No se pudo evaluar (descarga o extracción fallida). */
  | "error";

export interface CveCaseResult {
  ghsaId: string;
  cveId: string | null;
  package: string;
  cwe: number;
  vulnerableVersion: string;
  fixedVersion: string;
  outcome: CveOutcome;
  /** Hallazgos del CWE del advisory en la versión vulnerable. */
  findingsVulnerable: number;
  /** Hallazgos del CWE del advisory en la versión corregida. */
  findingsFixed: number;
  /**
   * El arreglo hizo desaparecer al menos un hallazgo. Evidencia de que lo
   * detectado se relaciona con la vulnerabilidad y no es ruido de fondo.
   */
  discriminated: boolean;
  filesScanned: number;
  linesScanned: number;
  elapsedMs: number;
  error?: string;
}

export interface CveMetrics {
  total: number;
  evaluated: number;
  detected: number;
  missed: number;
  errors: number;
  discriminated: number;
  /** detected / evaluated — recall sobre vulnerabilidades reales. */
  detectionRate: number;
  /** discriminated / detected — cuántas detecciones desaparecen con el fix. */
  discriminationRate: number;
}

export interface CveReport {
  analyzedAt: string;
  results: CveCaseResult[];
  metrics: CveMetrics;
  byCwe: Record<number, { evaluated: number; detected: number }>;
}
