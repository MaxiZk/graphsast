import Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL, SYSTEM_PROMPT, chatMessages, validateChatRequest } from "./chat.js";

/**
 * Función de Vercel del chat (`api/chat.ts` la reexporta). La clave de
 * Anthropic vive solo acá, en la variable de entorno ANTHROPIC_API_KEY.
 * Responde texto plano en streaming: la página lo muestra a medida que llega.
 */

const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 20;
const hits = new Map<string, number[]>();

/**
 * ¿Puede esta IP preguntar de nuevo? Hasta RATE_MAX preguntas cada 10 minutos.
 * shortcut: en memoria, por instancia de la función; con tráfico real, pasar a
 * un almacén compartido (Upstash, Vercel KV) y fijar un tope de gasto en Anthropic.
 */
export function allowRequest(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Solo desde la propia página: otro sitio no puede usar la clave desde el navegador de sus visitantes. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && new URL(origin).host === new URL(request.url).host;
}

/** Mensaje para quien usa la página; el detalle técnico queda en los logs de Vercel. */
function userMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "El chat no está configurado en el servidor.";
  if (err instanceof Anthropic.RateLimitError) return "Hay muchas consultas en este momento: probá en un minuto.";
  if (err instanceof Anthropic.APIError) return "El servicio de IA no respondió. Probá de nuevo.";
  return "No se pudo completar la respuesta.";
}

let client: Anthropic | null = null;

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return plain(403, "Origen no permitido.");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
  if (!allowRequest(ip)) return plain(429, "Llegaste al límite de preguntas: probá en unos minutos.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return plain(400, "El pedido no es JSON.");
  }
  const parsed = validateChatRequest(body);
  if (!parsed.ok) return plain(400, parsed.error);

  if (!process.env.ANTHROPIC_API_KEY) return plain(503, "El chat no está configurado en el servidor.");
  client ??= new Anthropic();

  const stream = client.beta.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 4096,
    // Chat: respuestas rápidas; la explicación del hallazgo ya hace el trabajo pesado.
    output_config: { effort: "low" },
    // Preguntas sobre ataques pueden activar los filtros de ciberseguridad: con
    // "default" un rechazo se reintenta en el modelo que Anthropic recomienda.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: chatMessages(parsed.value),
  });

  const encoder = new TextEncoder();
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\nNo puedo responder esa pregunta. Probá preguntarlo de otra forma."));
        } else if (final.stop_reason === "max_tokens") {
          controller.enqueue(encoder.encode("\n\n(La respuesta quedó cortada por largo.)"));
        }
      } catch (err) {
        console.error("chat:", err);
        controller.enqueue(encoder.encode(`\n\n${userMessage(err)}`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body$, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
