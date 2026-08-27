// AI.6b.1 — Minimal .eml -> plaintext extractor for Decision Case AI.
//
// The OpenAI Responses API counts the full base64-encoded `input_file`
// payload against the context window. Real-world .eml exports include
// embedded base64 attachments (images, PDFs, signatures) that inflate a
// 50 KB email into a 1-2 MB blob and blow past the context window.
//
// For evidence purposes we only need the human-readable email content:
// key headers + the text body. Embedded attachments are NOT separately
// extracted — that limitation is already disclosed to the model.

function decodeQuotedPrintable(input: string): string {
  // Join soft line breaks then decode =XX sequences.
  const joined = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const c = joined.charCodeAt(i);
    if (c === 0x3d /* = */ && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(c & 0xff);
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function decodeBase64ToText(b64: string, charset: string): string {
  try {
    const clean = b64.replace(/\s+/g, "");
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseHeaders(raw: string): { headers: Record<string, string>; body: string } {
  // Find header/body boundary (CRLF CRLF, or LF LF).
  let idx = raw.indexOf("\r\n\r\n");
  let sepLen = 4;
  if (idx < 0) { idx = raw.indexOf("\n\n"); sepLen = 2; }
  const headerBlock = idx < 0 ? raw : raw.slice(0, idx);
  const body = idx < 0 ? "" : raw.slice(idx + sepLen);
  // Unfold headers
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const m = line.match(/^([!-9;-~]+)\s*:\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return { headers, body };
}

function getContentType(headers: Record<string, string>): {
  type: string;
  boundary: string | null;
  charset: string;
} {
  const ct = headers["content-type"] || "text/plain";
  const type = ct.split(";")[0].trim().toLowerCase();
  const boundaryMatch = ct.match(/boundary\s*=\s*"?([^";]+)"?/i);
  const charsetMatch = ct.match(/charset\s*=\s*"?([^";]+)"?/i);
  return {
    type,
    boundary: boundaryMatch ? boundaryMatch[1] : null,
    charset: (charsetMatch ? charsetMatch[1] : "utf-8").toLowerCase(),
  };
}

function decodePartBody(body: string, encoding: string, charset: string): string {
  const enc = (encoding || "7bit").toLowerCase();
  if (enc === "base64") return decodeBase64ToText(body, charset);
  if (enc === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

type Part = { text?: string; html?: string };

function walk(raw: string): Part {
  const { headers, body } = parseHeaders(raw);
  const { type, boundary, charset } = getContentType(headers);
  const disposition = (headers["content-disposition"] || "").toLowerCase();
  const isAttachment = disposition.startsWith("attachment");

  if (boundary && type.startsWith("multipart/")) {
    const sep = `--${boundary}`;
    const parts = body.split(sep).slice(1, -1); // drop preamble + closing
    const acc: Part = {};
    for (const p of parts) {
      const trimmed = p.replace(/^\r?\n/, "");
      const sub = walk(trimmed);
      if (sub.text && !acc.text) acc.text = sub.text;
      if (sub.html && !acc.html) acc.html = sub.html;
    }
    return acc;
  }

  if (isAttachment) return {};
  const encoding = headers["content-transfer-encoding"] || "7bit";
  const decoded = decodePartBody(body, encoding, charset);
  if (type === "text/plain") return { text: decoded };
  if (type === "text/html") return { html: decoded };
  return {};
}

function decodeRfc2047(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs, enc, data) => {
    if (enc.toUpperCase() === "B") return decodeBase64ToText(data, cs);
    return decodeQuotedPrintable(data.replace(/_/g, " "));
  });
}

export interface EmlExtractResult {
  text: string;
  bytes: number;
}

export function extractEmlAsText(bytes: Uint8Array, fileName: string, maxChars = 60000): EmlExtractResult {
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const { headers } = parseHeaders(raw);
  const part = walk(raw);
  let body = part.text || (part.html ? stripHtml(part.html) : "");
  if (!body) body = "(No readable text body found in this .eml file.)";

  const subject = decodeRfc2047(headers["subject"] || "");
  const from = decodeRfc2047(headers["from"] || "");
  const to = decodeRfc2047(headers["to"] || "");
  const cc = decodeRfc2047(headers["cc"] || "");
  const date = headers["date"] || "";

  const head = [
    `# Email evidence: ${fileName}`,
    from ? `From: ${from}` : null,
    to ? `To: ${to}` : null,
    cc ? `Cc: ${cc}` : null,
    date ? `Date: ${date}` : null,
    subject ? `Subject: ${subject}` : null,
    "",
    "--- BODY ---",
  ].filter(Boolean).join("\n");

  let combined = `${head}\n${body}`.trim();
  if (combined.length > maxChars) {
    combined = combined.slice(0, maxChars) + `\n\n[... truncated, original ${combined.length} chars ...]`;
  }
  return { text: combined, bytes: new TextEncoder().encode(combined).byteLength };
}
