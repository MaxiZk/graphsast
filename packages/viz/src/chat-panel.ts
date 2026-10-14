import { CHAT_LIMITS, type ChatTurn } from "./chat.js";

/**
 * Chat con Claude sobre el hallazgo elegido. Cada hallazgo tiene su propia
 * conversación: al cambiar de hallazgo se empieza de nuevo. Las respuestas se
 * muestran como texto, nunca como HTML: pueden citar código del usuario.
 */

export interface ChatPanelElements {
  section: HTMLElement;
  log: HTMLOListElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  suggestions: HTMLElement;
  reset: HTMLButtonElement;
}

export interface ChatPanel {
  /** El hallazgo en texto, o null si no hay ninguno elegido. */
  setContext(context: string | null): void;
}

/** Texto con bloques ``` como párrafos y bloques de código, armado sin innerHTML. */
function renderAnswer(target: HTMLElement, text: string) {
  // Entre marcas ``` alternan texto y código: los impares son código.
  const parts = text.split(/```[\w-]*\n?/).map((part, i) => ({ part, isCode: i % 2 === 1 }));
  target.replaceChildren(
    ...parts.filter(({ part }) => part.trim() !== "").map(({ part, isCode }) => {
      const el = document.createElement(isCode ? "pre" : "p");
      el.className = isCode ? "chat-code" : "chat-text";
      el.textContent = isCode ? part.replace(/\n$/, "") : part.trim();
      return el;
    }),
  );
}

export function createChatPanel(el: ChatPanelElements): ChatPanel {
  let context: string | null = null;
  let history: ChatTurn[] = [];
  let pending: AbortController | null = null;

  function bubble(role: ChatTurn["role"], text: string): HTMLElement {
    const li = document.createElement("li");
    li.className = `chat-msg ${role}`;
    const who = document.createElement("span");
    who.className = "chat-who";
    who.textContent = role === "user" ? "Vos" : "Claude";
    const body = document.createElement("div");
    body.className = "chat-body";
    if (role === "user") body.textContent = text;
    else renderAnswer(body, text);
    li.append(who, body);
    el.log.append(li);
    li.scrollIntoView({ block: "nearest" });
    return body;
  }

  function setBusy(busy: boolean) {
    const full = history.length >= CHAT_LIMITS.messages - 1;
    el.input.disabled = busy || full;
    el.send.disabled = busy || full;
    for (const b of el.suggestions.querySelectorAll("button")) b.disabled = busy || full;
    el.reset.hidden = history.length === 0;
    el.input.placeholder = full
      ? "La conversación llegó a su largo máximo: empezá otra."
      : "Preguntá lo que no te quedó claro…";
  }

  function clear() {
    pending?.abort();
    pending = null;
    history = [];
    el.log.replaceChildren();
    setBusy(false);
  }

  async function ask(question: string) {
    const text = question.trim().slice(0, CHAT_LIMITS.question);
    if (!text || !context || pending) return;
    history.push({ role: "user", content: text });
    bubble("user", text);
    const answer = bubble("assistant", "…");
    answer.classList.add("waiting");
    const controller = new AbortController();
    pending = controller;
    setBusy(true);

    let received = "";
    let ok = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, messages: history }),
        signal: controller.signal,
      });
      if (res.status === 404) {
        received = "El chat necesita el servidor de la página publicada: en esta copia local no está disponible.";
      } else if (!res.ok || !res.body) {
        received = (await res.text()) || `El chat respondió con un error (${res.status}).`;
      } else {
        ok = true;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        answer.classList.remove("waiting");
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += decoder.decode(value, { stream: true });
          renderAnswer(answer, received);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      received = `No se pudo conectar con el chat: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (pending === controller) pending = null;
    }

    answer.classList.remove("waiting");
    renderAnswer(answer, received);
    if (ok && received.trim()) {
      history.push({ role: "assistant", content: received.slice(0, CHAT_LIMITS.answer) });
    } else {
      // Una pregunta sin respuesta no queda en la historia: se puede volver a hacer.
      history.pop();
      answer.parentElement!.classList.add("error");
    }
    setBusy(false);
  }

  el.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = el.input.value;
    el.input.value = "";
    void ask(question);
  });
  el.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      el.form.requestSubmit();
    }
  });
  for (const b of el.suggestions.querySelectorAll("button")) {
    b.addEventListener("click", () => void ask(b.textContent ?? ""));
  }
  el.reset.addEventListener("click", clear);

  return {
    setContext(next) {
      el.section.hidden = next === null;
      if (next === context) return;
      context = next;
      clear();
    },
  };
}
