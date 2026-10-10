import { existsSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fetchPackageVersions } from "./registry.js";

const MAX_TARBALL_BYTES = 25 * 1024 * 1024;

export interface ExtractedPackage {
  dir: string;
  cached: boolean;
}

function tarballCacheDir(root: string, name: string, version: string): string {
  return path.join(root, `${name.replace(/[/@]/g, "_")}@${version}`);
}

/**
 * Descarga y extrae `name@version` bajo `cacheRoot`. Reutiliza la copia si ya
 * existe, de modo que una segunda corrida no dependa de la red.
 */
export async function fetchAndExtract(
  name: string,
  version: string,
  cacheRoot: string,
): Promise<ExtractedPackage> {
  const dir = tarballCacheDir(cacheRoot, name, version);
  const marker = path.join(dir, ".graphsast-ok");
  if (existsSync(marker)) return { dir: path.join(dir, "package"), cached: true };

  const pkg = await fetchPackageVersions(name);
  const url = pkg.tarballs[version];
  if (!url) throw new Error(`sin tarball para ${name}@${version}`);

  const res = await fetch(url, { headers: { "User-Agent": "graphsast-cve-eval" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} al bajar ${name}@${version}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_TARBALL_BYTES) {
    throw new Error(`tarball demasiado grande (${buf.byteLength} bytes)`);
  }

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tgz = path.join(dir, "package.tgz");
  writeFileSync(tgz, buf);

  const untar = spawnSync("tar", ["-xzf", tgz, "-C", dir], { encoding: "utf8" });
  if (untar.status !== 0) {
    throw new Error(`tar falló: ${untar.stderr?.trim() ?? untar.status}`);
  }
  rmSync(tgz, { force: true });

  const inner = path.join(dir, "package");
  if (!existsSync(inner)) throw new Error("el tarball no contiene package/");
  writeFileSync(marker, new Date().toISOString());
  return { dir: inner, cached: false };
}

/**
 * ¿El archivo parece código minificado o bundleado?
 *
 * Analizarlo no aporta: las líneas larguísimas destruyen la ubicación de los
 * hallazgos y el código generado no refleja las decisiones del autor.
 */
export function looksMinified(code: string, filePath: string): boolean {
  if (/\.min\.[cm]?js$/.test(filePath)) return true;
  const lines = code.split("\n");
  if (lines.length === 0) return false;
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
  if (longest > 1000) return true;
  const avg = code.length / lines.length;
  return avg > 250;
}

export function isTooBig(file: string, maxBytes: number): boolean {
  try {
    return statSync(file).size > maxBytes;
  } catch {
    return true;
  }
}
