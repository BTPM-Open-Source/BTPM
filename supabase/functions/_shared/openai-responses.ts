// Phase 4D.14A.8E.2 — Provider-neutral Responses API output parsing helpers.
//
// This module contains only pure, provider-agnostic parsing utilities used
// to interpret the shape of an OpenAI-compatible Responses API body. It
// performs no network I/O, holds no credentials, does not know about any
// provider base URL or authentication scheme, and does not enqueue or poll
// remote calls. All provider transport for Tenant AI now lives inside the
// canonical Tenant AI runtime and its transport clients.

/** Extract concatenated text output from a Responses API body. */
export function extractResponseText(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const direct = (body as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct;
  const out = (body as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }).output;
  if (!Array.isArray(out)) return null;
  const parts: string[] = [];
  for (const item of out) {
    const cs = item?.content;
    if (!Array.isArray(cs)) continue;
    for (const c of cs) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  const joined = parts.join("").trim();
  return joined || null;
}

/** Strip accidental ```json fences and parse first JSON object found. */
export function tryParseStructuredJson(text: string): unknown | null {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```$/m, "").trim();
  }
  try { return JSON.parse(t); } catch { /* fall through */ }
  // Fallback: locate first balanced {...} block.
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}
