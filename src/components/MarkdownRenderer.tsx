import React from "react";

// Very small, safe-ish Markdown renderer for our needs without external deps.
// Supports: headings, bold, italic, inline code, code blocks, links (http/https),
// unordered/ordered lists, checklists, and simple GitHub-style tables.
// It first escapes HTML, then applies Markdown transformations.

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isHttpUrl(u: string) {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function renderTables(text: string) {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const header = tableLines[0]
          .trim()
          .slice(1, -1)
          .split("|")
          .map((h) => h.trim());
        // Skip separator line if present
        let bodyStart = 1;
        if (/^\s*\|?\s*:?[-]+:?\s*(\|\s*:?[-]+:?\s*)*\|?\s*$/.test(tableLines[1])) {
          bodyStart = 2;
        }
        const bodyRows = tableLines.slice(bodyStart).map((row) =>
          row
            .trim()
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim())
        );
        const html = ["<table>", "<thead><tr>", ...header.map((h) => `<th>${h}</th>`), "</tr></thead>", "<tbody>"];
        for (const r of bodyRows) {
          html.push("<tr>");
          for (const c of r) html.push(`<td>${c}</td>`);
          html.push("</tr>");
        }
        html.push("</tbody></table>");
        out.push(html.join(""));
      } else {
        out.push(line);
      }
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

function renderLists(text: string) {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  const flush = (buffer: string[], type: "ul" | "ol") => {
    if (buffer.length === 0) return;
    const items = buffer
      .map((l) => l.replace(/^\s*([-*]|\d+\.)\s+/, ""))
      .map((l) => `<li>${l}</li>`) // items already escaped/processed upstream
      .join("");
    out.push(`<${type}>${items}</${type}>`);
  };
  let ulBuf: string[] = [];
  let olBuf: string[] = [];
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*[-*]\s+/.test(l) && !/^\s*-\s*\[[xX\s]\]\s+/.test(l)) {
      if (olBuf.length) {
        flush(olBuf, "ol");
        olBuf = [];
      }
      ulBuf.push(l);
    } else if (/^\s*\d+\.\s+/.test(l)) {
      if (ulBuf.length) {
        flush(ulBuf, "ul");
        ulBuf = [];
      }
      olBuf.push(l);
    } else {
      if (ulBuf.length) {
        flush(ulBuf, "ul");
        ulBuf = [];
      }
      if (olBuf.length) {
        flush(olBuf, "ol");
        olBuf = [];
      }
      out.push(l);
    }
    i++;
  }
  if (ulBuf.length) flush(ulBuf, "ul");
  if (olBuf.length) flush(olBuf, "ol");
  return out.join("\n");
}

function renderCheckboxes(text: string) {
  // Convert lines like "- [ ] Task" or "- [x] Task" to html list with checkboxes (view only)
  return text.replace(/^-\s*\[( |x|X)\]\s+(.*)$/gim, (_m, mark: string, body: string) => {
    const checked = /x/i.test(mark);
    return `<ul><li><input type="checkbox" disabled ${checked ? "checked" : ""}/> ${body}</li></ul>`;
  });
}

function renderInline(md: string) {
  // links [text](url)
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, u: string) => {
    const safeUrl = u.trim();
    if (!isHttpUrl(safeUrl)) return t; // fall back to text
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  });
  // auto-link bare URLs http/https
  md = md.replace(/(^|[\s\(\[])((https?:\/\/)[^\s<>()\[\]]+)/g, (_m, p1: string, url: string) => {
    return `${p1}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  // bold **text**
  md = md.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic *text*
  md = md.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  // inline code `code`
  md = md.replace(/`([^`]+)`/g, "<code>$1</code>");
  return md;
}

function renderHeadings(text: string) {
  return text
    .replace(/^######\s+(.+)$/gim, "<h6>$1</h6>")
    .replace(/^#####\s+(.+)$/gim, "<h5>$1</h5>")
    .replace(/^####\s+(.+)$/gim, "<h4>$1</h4>")
    .replace(/^###\s+(.+)$/gim, "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gim, "<h2>$1</h2>")
    .replace(/^#\s+(.+)$/gim, "<h1>$1</h1>");
}

function renderCodeBlocks(text: string) {
  // Extract triple backtick blocks and replace with placeholders
  const blocks: string[] = [];
  let out = text;
  out = out.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    const idx = blocks.length;
    blocks.push(`<pre><code>${code}</code></pre>`);
    return `@@CODEBLOCK_${idx}@@`;
  });
  return { out, blocks };
}

function restoreCodeBlocks(text: string, blocks: string[]) {
  let out = text;
  for (let i = 0; i < blocks.length; i++) {
    out = out.replaceAll(`@@CODEBLOCK_${i}@@`, blocks[i]);
  }
  return out;
}

function toHtml(markdown: string) {
  // Escape HTML first
  const escaped = escapeHtml(markdown);
  // Protect code blocks
  const { out: codeProtected, blocks } = renderCodeBlocks(escaped);
  // Headings
  let html = renderHeadings(codeProtected);
  // Checkboxes
  html = renderCheckboxes(html);
  // Tables (must run before lists, as they are line-based)
  html = renderTables(html);
  // Lists
  html = renderLists(html);
  // Inline formatting
  html = renderInline(html);
  // Paragraphs: split on blank lines
  const parts = html.split(/\n\s*\n/).map((p) => {
    // if already starts with a block tag, keep as is; otherwise wrap in <p>
    if (/^\s*<(h\d|ul|ol|pre|table|blockquote)/.test(p)) return p;
    return `<p>${p.replaceAll("\n", "<br/>")}</p>`;
  });
  html = parts.join("\n");
  // Restore code blocks
  html = restoreCodeBlocks(html, blocks);
  return html;
}

export function transformMarkdownToHtml(markdown: string) {
  return toHtml(markdown || "");
}

export const MarkdownRenderer: React.FC<{ markdown: string; className?: string }> = ({ markdown, className }) => {
  const html = toHtml(markdown || "");
  return (
    <div className={"prose max-w-none " + (className || "")} dangerouslySetInnerHTML={{ __html: html }} />
  );
};

export default MarkdownRenderer;
