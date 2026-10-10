import { realpathSync } from "node:fs";
import path from "node:path";

/** Ruta pedida a la API que no se puede servir; `status` es el código HTTP. */
export class PathRejectedError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
  }
}

function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === ""
    || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Resuelve `requested` dentro de `root` y devuelve su ruta real.
 *
 * Se rechaza con 400 todo lo que salga de `root`: `../`, rutas absolutas
 * externas y enlaces simbólicos que apunten afuera. El chequeo léxico va antes
 * de tocar el disco, para que una ruta externa no revele si existe o no.
 */
export function resolveInsideRoot(root: string, requested: unknown): string {
  if (typeof requested !== "string" || requested.trim() === "" || requested.includes("\0")) {
    throw new PathRejectedError("Ruta inválida.", 400);
  }

  const lexicalRoot = path.resolve(root);
  const realRoot = realpathSync.native(lexicalRoot);
  const candidate = path.resolve(lexicalRoot, requested);
  if (!isInside(lexicalRoot, candidate) && !isInside(realRoot, candidate)) {
    throw new PathRejectedError("La ruta está fuera del directorio permitido.", 400);
  }

  let real: string;
  try {
    real = realpathSync.native(candidate);
  } catch {
    throw new PathRejectedError("La ruta no existe.", 404);
  }
  if (!isInside(realRoot, real)) {
    throw new PathRejectedError(
      "La ruta resuelve fuera del directorio permitido (enlace simbólico).",
      400,
    );
  }
  return real;
}
