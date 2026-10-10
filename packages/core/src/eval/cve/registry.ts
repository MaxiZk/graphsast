/** Cliente mínimo del registry de npm y de la API de advisories de GitHub. */

export interface FetchOptions {
  timeoutMs?: number;
}

async function getJson<T>(
  url: string,
  options: FetchOptions = {},
  accept = "application/vnd.github+json",
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: accept, "User-Agent": "graphsast-cve-eval" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Compara versiones semver estables. Devuelve <0, 0 o >0. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

/** ¿Es una versión estable (sin -alpha, -beta, -rc)? */
export function isStable(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

export interface PackageVersions {
  name: string;
  versions: string[];
  tarballs: Record<string, string>;
}

export async function fetchPackageVersions(
  name: string,
  options: FetchOptions = {},
): Promise<PackageVersions> {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}`;
  // Formato abreviado: omite READMEs y metadatos por versión. Para paquetes
  // populares la diferencia es de megabytes.
  const doc = await getJson<{
    versions: Record<string, { dist?: { tarball?: string } }>;
  }>(url, options, "application/vnd.npm.install-v1+json");
  const versions = Object.keys(doc.versions ?? {}).filter(isStable);
  const tarballs: Record<string, string> = {};
  for (const v of versions) {
    const tarball = doc.versions[v]?.dist?.tarball;
    if (tarball) tarballs[v] = tarball;
  }
  return { name, versions: versions.sort(compareSemver), tarballs };
}

/**
 * Última versión estable publicada ANTES de `fixedVersion`.
 * Es vulnerable por definición: precede al arreglo publicado por el mantenedor.
 */
export function versionBefore(
  versions: string[],
  fixedVersion: string,
): string | null {
  const earlier = versions.filter((v) => compareSemver(v, fixedVersion) < 0);
  return earlier.length > 0 ? earlier[earlier.length - 1]! : null;
}

export interface RawAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: string;
  html_url: string;
  cwes?: { cwe_id: string; name: string }[];
  vulnerabilities?: {
    package?: { ecosystem?: string; name?: string };
    first_patched_version?: string | null;
    vulnerable_version_range?: string | null;
  }[];
}

export async function fetchAdvisories(
  cwe: number,
  perPage = 30,
  options: FetchOptions = {},
): Promise<RawAdvisory[]> {
  const url = `https://api.github.com/advisories?ecosystem=npm&cwes=${cwe}`
    + `&per_page=${perPage}&type=reviewed`;
  return getJson<RawAdvisory[]>(url, options);
}
