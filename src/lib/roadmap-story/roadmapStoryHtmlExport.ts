/**
 * Phase 6B.8g — Standalone HTML export for Published Story Presentation.
 *
 * Produces a fully self-contained `.html` document from the already-
 * rendered Published Story DOM. Runs entirely in the browser using the
 * authorized view — no server call, no re-fetch, no secrets, no source
 * package / prompts / raw AI response / debug payloads.
 *
 * Security posture: the exported file is an offline copy. It is NOT
 * access-controlled by BTPM after download. Anyone with the file can
 * read the visible Story content. Object links back to BTPM still route
 * through protected BTPM URLs and require the recipient's own access.
 */

/** Attribute marking elements that must NEVER be included in an export. */
export const HTML_EXPORT_EXCLUDE_ATTR = "data-html-export-exclude";

/** Attribute marking the root element that IS the export payload. */
export const HTML_EXPORT_ROOT_ATTR = "data-published-story-export-root";

const REACT_ATTR_PREFIXES = ["data-reactroot", "data-react", "aria-live-off"];
const EVENT_HANDLER_PREFIX = "on";

/**
 * Extracts CSS from same-origin stylesheets. External and cross-origin
 * sheets are skipped (browser blocks `cssRules`), and Tailwind CDN /
 * remote deps must never be inlined for offline safety.
 */
function collectInlineCss(): string {
  if (typeof document === "undefined") return "";
  const chunks: string[] = [];
  const sheets = Array.from(document.styleSheets);
  for (const sheet of sheets) {
    try {
      const href = (sheet as CSSStyleSheet).href;
      if (href) {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) continue;
      }
      const rules = (sheet as CSSStyleSheet).cssRules;
      if (!rules) continue;
      const parts: string[] = [];
      for (let i = 0; i < rules.length; i++) parts.push(rules[i].cssText);
      chunks.push(parts.join("\n"));
    } catch {
      // Cross-origin or otherwise unreadable — skip silently.
    }
  }
  return chunks.join("\n");
}

/** Minimal fallback so the file stays readable if CSS extraction fails. */
const FALLBACK_CSS = `
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #F8F8F6; color: #1C1F3F;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px; line-height: 1.5; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 24px 0 8px; }
  h3 { font-size: 15px; margin: 16px 0 6px; }
  section, article { background: #fff; border: 1px solid #E1E1DC;
    border-radius: 8px; padding: 16px; margin: 12px 0; }
  a { color: #1C1F3F; text-decoration: underline; }
  .btpm-export-banner { background: #FFF7E0; border-bottom: 1px solid #EAC16D;
    padding: 10px 16px; font-size: 12px; color: #6B4E00; }
  .btpm-export-toolbar { position: sticky; top: 0; z-index: 10;
    background: #0B1020; color: #fff; padding: 8px 16px;
    display: flex; gap: 8px; align-items: center; }
  .btpm-export-toolbar button { background: rgba(255,255,255,0.1);
    color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;
    padding: 4px 10px; font-size: 12px; cursor: pointer; }
  .btpm-export-toolbar button:hover { background: rgba(255,255,255,0.2); }
  .btpm-export-footer { text-align: center; font-size: 11px;
    color: #516490; padding: 24px 16px; }
  @media print {
    .btpm-export-toolbar, .btpm-export-banner { display: none; }
    section, article { break-inside: avoid; box-shadow: none; }
  }
`;

/**
 * Strip a cloned element tree of anything unsafe or noisy for an
 * offline export.
 */
function sanitizeClone(root: Element): void {
  // Remove scripts and forbidden export nodes first.
  root.querySelectorAll("script, noscript, template, style[data-vite-dev-id]").forEach(
    (n) => n.remove(),
  );
  root.querySelectorAll(`[${HTML_EXPORT_EXCLUDE_ATTR}]`).forEach((n) => n.remove());

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toProcess: Element[] = [];
  let current = walker.nextNode();
  while (current) {
    toProcess.push(current as Element);
    current = walker.nextNode();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  for (const el of toProcess) {
    // Remove event handler attributes and internal React data-* attrs.
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      if (name.startsWith(EVENT_HANDLER_PREFIX)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (REACT_ATTR_PREFIXES.some((p) => name.startsWith(p))) {
        el.removeAttribute(attr.name);
        continue;
      }
    }

    // Absolutize relative anchor URLs so they still resolve from disk.
    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (href && !/^([a-z]+:|#|mailto:|tel:)/i.test(href) && origin) {
        try {
          const abs = new URL(href, window.location.href).toString();
          el.setAttribute("href", abs);
        } catch {
          /* ignore */
        }
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }

    // Neutralise form controls — exported doc is static.
    if (el.tagName === "BUTTON") {
      el.setAttribute("disabled", "true");
      el.removeAttribute("type");
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      el.setAttribute("disabled", "true");
    }
  }
}

/**
 * Build a safe filename from a Story title.
 */
export function buildExportFilename(opts: {
  versionNumber?: number | null;
  versionId: string;
  title?: string | null;
}): string {
  const safe = (opts.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  const v = opts.versionNumber != null ? `v${opts.versionNumber}` : "vX";
  if (!safe) return `btpm-story-${opts.versionId}.html`;
  return `btpm-story-${v}-${safe}.html`;
}

export interface BuildStandaloneHtmlInput {
  title: string;
  subtitle?: string | null;
  versionNumber?: number | null;
  publishedAtLabel?: string | null;
  exportRoot: HTMLElement;
}

/**
 * Serializes the sanitized clone of the export root into a fully
 * standalone HTML document.
 */
export function buildStandaloneHtml(input: BuildStandaloneHtmlInput): string {
  const clone = input.exportRoot.cloneNode(true) as HTMLElement;
  clone.removeAttribute(HTML_EXPORT_ROOT_ATTR);
  sanitizeClone(clone);

  const inlineCss = collectInlineCss();
  const escapedTitle = escapeHtml(input.title || "Roadmap Story");
  const subtitleHtml = input.subtitle
    ? `<p style="margin:4px 0 0;color:#516490;font-size:13px">${escapeHtml(input.subtitle)}</p>`
    : "";
  const metaLine = [
    input.versionNumber != null ? `Version ${input.versionNumber}` : "",
    input.publishedAtLabel ? `Published ${escapeHtml(input.publishedAtLabel)}` : "",
    `Exported ${new Date().toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const bodyInner = clone.outerHTML;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapedTitle} · BTPM Story (exported)</title>
<style>${FALLBACK_CSS}</style>
<style>${inlineCss}</style>
</head>
<body>
<div class="btpm-export-toolbar" role="toolbar" aria-label="Exported story controls">
  <strong style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.7">BTPM Story · Offline copy</strong>
  <span style="flex:1"></span>
  <button type="button" onclick="try{document.documentElement.requestFullscreen()}catch(e){}">Full screen</button>
  <button type="button" onclick="window.print()">Print</button>
  <button type="button" onclick="window.scrollTo({top:0,behavior:'smooth'})">Back to top</button>
</div>
<div class="btpm-export-banner">
  This is a standalone offline copy of a BTPM Published Story. It is not access-controlled by BTPM. Links back to BTPM objects still require normal BTPM access.
</div>
<main>
  <header style="margin-bottom:16px">
    <h1 style="margin:0">${escapedTitle}</h1>
    ${subtitleHtml}
    <div style="margin-top:6px;font-size:11px;color:#516490">${escapeHtml(metaLine)}</div>
  </header>
  ${bodyInner}
</main>
<div class="btpm-export-footer">
  Generated from BTPM · Frozen snapshot · No live data
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Trigger a browser download of the given HTML string. */
export function downloadHtmlFile(filename: string, html: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
