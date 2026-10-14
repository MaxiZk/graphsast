import type { FindingExplanation } from "./explain.js";

/**
 * Lo que la página necesita para el chat sobre un hallazgo. La función del
 * servidor (api/chat.ts) valida con los mismos límites; un test los compara.
 */

export const CHAT_LIMITS = {
  /** Mensajes de la conversación (pregunta y respuesta cuentan por separado). */
  messages: 16,
  /** Caracteres por pregunta. */
  question: 2000,
  /** Caracteres por respuesta anterior de Claude que se reenvía. */
  answer: 8000,
  /** Caracteres del contexto del hallazgo. */
  context: 12000,
} as const;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** El hallazgo como texto para Claude: lo mismo que muestra la explicación de la página. */
export function chatContext(explanation: FindingExplanation): string {
  const { source, sink } = explanation;
  const lines = [
    `Vulnerabilidad: ${explanation.title}`,
    `Resumen: ${explanation.summary}`,
    "",
    `De dónde viene el dato: ${source.label} (${source.where}). ${source.why}`,
    `A dónde llega: ${sink.label} (${sink.where}): ${sink.code}`,
    `Por qué es peligroso: ${sink.why}`,
    ...(sink.attack ? [`Ejemplo de ataque: ${sink.attack}`] : []),
    `Por qué nada lo frenó: ${explanation.missing}`,
    ...(explanation.fix ? [`Corrección sugerida: ${explanation.fix}`] : []),
    "",
    "Camino del dato, paso a paso:",
    ...explanation.steps.map(
      (s, i) => `${i + 1}. ${s.label} · ${s.file}:${s.line} · ${s.code}`,
    ),
  ];
  const text = lines.join("\n");
  // shortcut: corta caminos muy largos al límite; si hiciera falta más, resumir los pasos del medio.
  return text.length > CHAT_LIMITS.context ? `${text.slice(0, CHAT_LIMITS.context - 1)}…` : text;
}
