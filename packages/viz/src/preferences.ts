/**
 * Preferencias de la interfaz que no dependen del DOM: tema, límite de nodos
 * del grafo de un proyecto y atajos de teclado.
 */

export type Theme = "dark" | "light";

/** Tema guardado si es válido; si no, el del sistema. */
export function resolveTheme(stored: string | null, prefersLight: boolean): Theme {
  if (stored === "dark" || stored === "light") return stored;
  return prefersLight ? "light" : "dark";
}

/** Colores del grafo que dependen del fondo (los nodos se leen igual en los dos). */
export interface GraphPalette {
  background: string;
  edge: string;
  edgeLabel: string;
  riskLabel: string;
  /**
   * Contorno de la etiqueta de un nodo. La etiqueta es blanca y puede ser más
   * ancha que el círculo: sobre el fondo claro, sin contorno no se lee.
   */
  nodeLabelOutline: number;
}

export function graphPalette(theme: Theme): GraphPalette {
  return theme === "light"
    ? { background: "#f5f7fb", edge: "#94a3b8", edgeLabel: "#334155", riskLabel: "#c2410c", nodeLabelOutline: 2 }
    : { background: "#070a10", edge: "#64748b", edgeLabel: "#cbd5e1", riskLabel: "#fdba74", nodeLabelOutline: 0 };
}

/**
 * Opciones de nodos dibujados para un proyecto. Con unos cientos el
 * breadthfirst todavía se lee; "Todos" puede dejar un grafo ilegible en un
 * proyecto grande, pero es decisión de quien lo elige.
 */
export const NODE_LIMITS = [100, 250, 500, 1000, Number.POSITIVE_INFINITY] as const;
export const DEFAULT_NODE_LIMIT = 250;

/** Límite guardado si es una de las opciones; si no, el de siempre. */
export function resolveNodeLimit(stored: string | null): number {
  if (stored === "all") return Number.POSITIVE_INFINITY;
  const n = Number(stored);
  return (NODE_LIMITS as readonly number[]).includes(n) ? n : DEFAULT_NODE_LIMIT;
}

export function nodeLimitValue(limit: number): string {
  return Number.isFinite(limit) ? String(limit) : "all";
}

export type ShortcutAction =
  | "next-finding"
  | "prev-finding"
  | "fit"
  | "search"
  | "toggle-dim"
  | "toggle-theme";

/** Lo que importa de un `KeyboardEvent` para decidir el atajo. */
export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Nombre del elemento con foco (`INPUT`, `TEXTAREA`...) y si es editable. */
  targetTag?: string;
  targetEditable?: boolean;
}

const SHORTCUTS: Record<string, ShortcutAction> = {
  n: "next-finding",
  j: "next-finding",
  p: "prev-finding",
  k: "prev-finding",
  f: "fit",
  "/": "search",
  h: "toggle-dim",
  t: "toggle-theme",
};

/**
 * Atajo de una tecla, o `null`. Nunca mientras se escribe (un `n` en el
 * editor de código es una `n`) ni con modificadores, que son del navegador.
 */
export function shortcutFor(input: KeyInput): ShortcutAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  if (input.targetEditable) return null;
  if (input.targetTag && ["INPUT", "TEXTAREA", "SELECT"].includes(input.targetTag)) return null;
  return SHORTCUTS[input.key] ?? null;
}

/** Índice siguiente o anterior con vuelta al principio; -1 si no hay elementos. */
export function stepIndex(current: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}
