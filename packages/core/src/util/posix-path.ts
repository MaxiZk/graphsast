/**
 * Rutas absolutas con `/`, sin tocar el disco. El escaneo identifica cada
 * archivo por su ruta relativa a la raíz y la resolución de imports trabaja
 * sobre esas rutas, así que no depende de `node:path`: la misma lógica corre
 * en el CLI y en el navegador, donde los archivos llegan subidos.
 */

function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `/${out.join("/")}`;
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

/** Como `path.extname`: `.ts` de `a.ts`, vacío para `.eslintrc`. */
export function extname(p: string): string {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i);
}

export function join(...parts: string[]): string {
  return normalize(parts.join("/"));
}

/** `rel` resuelto contra el directorio `dir`. */
export function resolve(dir: string, rel: string): string {
  return normalize(rel.startsWith("/") ? rel : `${dir}/${rel}`);
}
