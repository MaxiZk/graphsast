export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderCodeLines(
  container: HTMLElement,
  code: string,
  highlightLines: ReadonlySet<number>,
): void {
  const lines = code.split("\n");
  container.innerHTML = lines
    .map((line, i) => {
      const n = i + 1;
      const risk = highlightLines.has(n) ? " risk" : "";
      return `<div class="code-line${risk}"><span class="ln">${n}</span><code class="text">${escapeHtml(line) || " "}</code></div>`;
    })
    .join("");
}
