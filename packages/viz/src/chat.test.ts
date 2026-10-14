import { describe, it, expect } from "vitest";
import { analyzeGraph, analyzeTaint, getCatalogBundle } from "@graphsast/core";
import { explainFinding } from "./explain.js";
import { CHAT_LIMITS, chatContext, chatMessages, validateChatRequest } from "./chat.js";
import { POST, allowRequest } from "./chat-server.js";

const SQLI = [
  'app.get("/usuarios", (req, res) => {',
  "  const id = req.query.id;",
  '  db.query("SELECT * FROM usuarios WHERE id = " + id);',
  "});",
].join("\n");

function context(): string {
  const graph = analyzeGraph(SQLI, "demo.ts");
  const [finding] = analyzeTaint(graph);
  const entry = getCatalogBundle().entries.find((e) => e.cwe === finding!.cwe);
  return chatContext(explainFinding(graph, finding!, entry)!);
}

describe("chatContext", () => {
  it("lleva el tipo, la entrada, el destino con su código y cada paso del camino", () => {
    const text = context();
    expect(text).toContain("SQL Injection (CWE-89)");
    expect(text).toContain("De dónde viene el dato: req (demo.ts:1)");
    expect(text).toContain('db.query("SELECT * FROM usuarios WHERE id = " + id)');
    expect(text).toMatch(/1\. req · demo\.ts:1/);
    expect(text).toMatch(/Corrección sugerida: /);
  });
});

describe("validateChatRequest", () => {
  const ok = { context: "hallazgo", messages: [{ role: "user", content: "¿Por qué?" }] };

  it("acepta una conversación que alterna y termina en una pregunta", () => {
    const r = validateChatRequest({
      context: "hallazgo",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it.each([
    ["sin cuerpo", null],
    ["sin hallazgo", { ...ok, context: " " }],
    ["sin mensajes", { ...ok, messages: [] }],
    ["roles que no alternan", { ...ok, messages: [{ role: "assistant", content: "x" }] }],
    ["un rol inventado", { ...ok, messages: [{ role: "system", content: "x" }] }],
    ["termina en una respuesta", { ...ok, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }],
    ["una pregunta demasiado larga", { ...ok, messages: [{ role: "user", content: "x".repeat(CHAT_LIMITS.question + 1) }] }],
    ["un hallazgo demasiado largo", { ...ok, context: "x".repeat(CHAT_LIMITS.context + 1) }],
    ["demasiados mensajes", { ...ok, messages: Array.from({ length: CHAT_LIMITS.messages + 1 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" })) }],
  ])("rechaza %s", (_name, body) => {
    expect(validateChatRequest(body).ok).toBe(false);
  });
});

describe("chatMessages", () => {
  it("pone el hallazgo entre etiquetas en la primera pregunta y deja el resto igual", () => {
    const msgs = chatMessages({
      context: "CTX",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
    });
    expect(msgs[0]!.content).toBe("<hallazgo>\nCTX\n</hallazgo>\n\na");
    expect(msgs.slice(1)).toEqual([{ role: "assistant", content: "b" }, { role: "user", content: "c" }]);
  });
});

describe("allowRequest", () => {
  it("deja 20 preguntas cada 10 minutos por IP", () => {
    const t = 1_000_000;
    for (let i = 0; i < 20; i++) expect(allowRequest("1.1.1.1", t + i)).toBe(true);
    expect(allowRequest("1.1.1.1", t + 20)).toBe(false);
    expect(allowRequest("2.2.2.2", t + 20)).toBe(true);
    expect(allowRequest("1.1.1.1", t + 10 * 60_000 + 1)).toBe(true);
  });
});

describe("POST /api/chat", () => {
  const url = "https://graph-sast.vercel.app/api/chat";
  const req = (body: unknown, origin = "https://graph-sast.vercel.app", ip = "9.9.9.9") =>
    new Request(url, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("rechaza otro origen antes de hacer nada", async () => {
    expect((await POST(req({}, "https://otro-sitio.com"))).status).toBe(403);
  });

  it("rechaza un cuerpo que no es JSON o no es válido", async () => {
    expect((await POST(req("no es json", undefined, "9.9.9.1"))).status).toBe(400);
    expect((await POST(req({ context: "x" }, undefined, "9.9.9.2"))).status).toBe(400);
  });

  it("sin clave configurada responde 503 y no llama a la API", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await POST(req({ context: "x", messages: [{ role: "user", content: "hola" }] }, undefined, "9.9.9.3"));
      expect(res.status).toBe(503);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
