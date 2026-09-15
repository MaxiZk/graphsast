import { fetchAdvisories, fetchPackageVersions, versionBefore } from "./registry.js";
import type { CveCase, CveCorpus } from "./types.js";

/** CWE que el catálogo actual de GraphSAST puede, en principio, detectar. */
export const SUPPORTED_CWES = [89, 78, 79];

/** Paquetes que no tiene sentido escanear (binarios, bundles enormes). */
const SKIP_PACKAGES = new Set(["electron", "puppeteer", "playwright"]);

/**
 * Construye el manifiesto de casos a partir de advisories reales.
 *
 * Para cada advisory con versión corregida conocida, resuelve la última
 * versión estable anterior al arreglo. Ese par (vulnerable, corregida) es la
 * unidad de evaluación: la etiqueta proviene del advisory, no del autor.
 */
export async function buildCveCorpus(
  cwes: number[] = SUPPORTED_CWES,
  perCwe = 30,
): Promise<CveCorpus> {
  const cases: CveCase[] = [];
  const seen = new Set<string>();

  for (const cwe of cwes) {
    let advisories: Awaited<ReturnType<typeof fetchAdvisories>>;
    try {
      advisories = await fetchAdvisories(cwe, perCwe);
    } catch (err) {
      process.stderr.write(`  aviso: no se pudieron traer advisories CWE-${cwe}: ${err}\n`);
      continue;
    }

    const candidates = advisories
      .map((adv) => {
        const vuln = adv.vulnerabilities?.find(
          (v) => v.package?.ecosystem === "npm" && v.first_patched_version,
        );
        return {
          adv,
          name: vuln?.package?.name,
          fixedVersion: vuln?.first_patched_version ?? null,
        };
      })
      .filter((c) => c.name && c.fixedVersion && !SKIP_PACKAGES.has(c.name)
        && !seen.has(c.adv.ghsa_id));

    // Resolver versiones en paralelo acotado: el cuello de botella es la red.
    const BATCH = 8;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const resolved = await Promise.all(
        batch.map(async (c) => {
          try {
            const pkg = await fetchPackageVersions(c.name!, { timeoutMs: 20_000 });
            const vulnerableVersion = versionBefore(pkg.versions, c.fixedVersion!);
            if (!vulnerableVersion) return null;
            if (!pkg.tarballs[vulnerableVersion] || !pkg.tarballs[c.fixedVersion!]) {
              return null;
            }
            return { ...c, vulnerableVersion };
          } catch {
            return null;
          }
        }),
      );

      for (const r of resolved) {
        if (!r) continue;
        if (seen.has(r.adv.ghsa_id)) continue;
        seen.add(r.adv.ghsa_id);
        cases.push({
          ghsaId: r.adv.ghsa_id,
          cveId: r.adv.cve_id,
          package: r.name!,
          vulnerableVersion: r.vulnerableVersion,
          fixedVersion: r.fixedVersion!,
          cwe,
          severity: r.adv.severity,
          summary: r.adv.summary,
          advisoryUrl: r.adv.html_url,
        });
      }
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    source: "GitHub Security Advisories (api.github.com/advisories, ecosystem=npm)",
    cases,
  };
}
