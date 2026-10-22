/**
 * A deliberately small markdown renderer for model output. Everything is
 * HTML-escaped before any formatting is applied, so raw HTML in a response is
 * displayed as text rather than parsed.
 */

type CodeBlock = { lang: string; code: string };
type ListState = { tag: "ul" | "ol"; items: string[] };

export function renderMarkdown(source: string): string {
  const codeBlocks: CodeBlock[] = [];
  const text = source.replace(
    /```([^\n`]*)\n?([\s\S]*?)```/g,
    (_, lang: string, code: string) => {
      codeBlocks.push({ lang: lang.trim(), code });
      return `\u0000${codeBlocks.length - 1}\u0000`;
    },
  );

  const lines = text.split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: ListState | null = null;

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };

  const flushList = (): void => {
    if (!list) return;
    out.push(
      `<${list.tag}>${list.items
        .map((item) => `<li>${inline(item)}</li>`)
        .join("")}</${list.tag}>`,
    );
    list = null;
  };

  for (const line of lines) {
    const codeRef = /^\u0000(\d+)\u0000$/.exec(line.trim());
    if (codeRef) {
      flushParagraph();
      flushList();
      const block = codeBlocks[Number(codeRef[1])];
      const body = block.code.replace(/\n$/, "");
      out.push(
        `<pre><span class="codeLang">${escapeHtml(
          block.lang || "code",
        )}</span><code>${escapeHtml(body)}</code></pre>`,
      );
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, heading[1].length);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      flushList();
      out.push("<hr>");
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const itemMatch = unordered ?? ordered;
    if (itemMatch) {
      flushParagraph();
      const tag: "ul" | "ol" = unordered ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      const target = list;
      if (target) target.items.push(itemMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return out.join("");
}

function inline(source: string): string {
  return escapeHtml(source)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] as string,
  );
}
