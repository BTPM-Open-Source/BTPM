/**
 * AI.8.1a — Deterministic markdown → structured Decision Brief field
 * extractor. Used for legacy brief versions that pre-date the structured
 * handoff contract, and as a fallback when AI structured parse fails.
 *
 * No AI/backend call. Pure text parsing of markdown headings and
 * label-style sections.
 */
export type ExtractedBriefFields = {
  executive_intro_text?: string;
  options_summary?: string;
  requested_decision_text?: string;
  recommendation_text?: string;
  guardrails_text?: string;
  residual_risks_text?: string;
  open_questions_text?: string;
};

type Rule = { key: keyof ExtractedBriefFields; rx: RegExp };

const RULES: Rule[] = [
  { key: "executive_intro_text", rx: /executive\s+(summary|intro|overview)/i },
  { key: "options_summary", rx: /options?(\s+summary|\s+considered)?\b/i },
  { key: "requested_decision_text", rx: /requested\s+decision|decision\s+requested/i },
  { key: "recommendation_text", rx: /recommendation/i },
  { key: "guardrails_text", rx: /conditions|guardrails/i },
  { key: "residual_risks_text", rx: /residual\s+risks?/i },
  { key: "open_questions_text", rx: /open\s+questions|missing\s+information/i },
];

function matchRule(title: string): keyof ExtractedBriefFields | null {
  for (const r of RULES) if (r.rx.test(title)) return r.key;
  return null;
}

export function extractBriefFieldsFromMarkdown(
  md: string | null | undefined,
): ExtractedBriefFields {
  if (!md || !md.trim()) return {};
  const lines = md.split(/\r?\n/);
  const sections: { key: keyof ExtractedBriefFields; bodyStart: number }[] = [];

  lines.forEach((line, i) => {
    // Markdown heading: # ... ###### ...
    const h = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (h) {
      const k = matchRule(h[1]);
      if (k) sections.push({ key: k, bodyStart: i + 1 });
      return;
    }
    // Label style: "Executive summary:" possibly bolded "**Executive summary:**"
    const lbl = /^\s*\**\s*([A-Za-z][A-Za-z /]+?)\s*\**\s*:\s*(.*)$/.exec(line);
    if (lbl) {
      const k = matchRule(lbl[1]);
      if (k) {
        // If inline content after colon, treat as one-line section.
        if (lbl[2] && lbl[2].trim()) {
          sections.push({ key: k, bodyStart: i });
        } else {
          sections.push({ key: k, bodyStart: i + 1 });
        }
      }
    }
  });

  const out: ExtractedBriefFields = {};
  sections.forEach((s, idx) => {
    const end = sections[idx + 1]?.bodyStart
      ? Math.min(
          sections[idx + 1].bodyStart - 1,
          lines.length,
        )
      : lines.length;
    let bodyLines = lines.slice(s.bodyStart, end);
    // Strip leading inline-label colon prefix on first line.
    if (bodyLines.length > 0) {
      bodyLines = [...bodyLines];
      bodyLines[0] = bodyLines[0].replace(
        /^\s*\**\s*[A-Za-z][A-Za-z /]+?\s*\**\s*:\s*/,
        "",
      );
    }
    const body = bodyLines.join("\n").trim();
    if (body && !out[s.key]) out[s.key] = body;
  });

  return out;
}

/**
 * AI.8.1b — Merge AI structured fields with deterministic markdown extraction.
 *
 * - Keeps any value already present in `structured`.
 * - Fills missing text fields from markdown extraction when available.
 * - Confidence / readiness are NOT inferred from markdown — only kept if
 *   already provided in structured.
 */
export type MergedBriefFields = {
  executive_intro_text: string | null;
  options_summary: string | null;
  requested_decision_text: string | null;
  recommendation_text: string | null;
  guardrails_text: string | null;
  residual_risks_text: string | null;
  open_questions_text: string | null;
  confidence_level: "high" | "medium" | "low" | null;
  decision_readiness:
    | "ready_for_decision"
    | "needs_clarification"
    | "not_ready"
    | null;
};

type AnyStructured = {
  executive_intro_text?: string | null;
  options_summary?: string | null;
  requested_decision_text?: string | null;
  recommendation_text?: string | null;
  guardrails_text?: string | null;
  residual_risks_text?: string | null;
  open_questions_text?: string | null;
  confidence_level?: "high" | "medium" | "low" | null;
  decision_readiness?:
    | "ready_for_decision"
    | "needs_clarification"
    | "not_ready"
    | null;
};

export function mergeStructuredBriefFieldsWithMarkdownFallback(
  structured: AnyStructured | null | undefined,
  markdown: string | null | undefined,
): {
  fields: MergedBriefFields;
  filledFromMarkdown: (keyof ExtractedBriefFields)[];
  usedMarkdownFallback: boolean;
} {
  const s = structured ?? {};
  const extracted = extractBriefFieldsFromMarkdown(markdown);
  const filled: (keyof ExtractedBriefFields)[] = [];

  const pick = (k: keyof ExtractedBriefFields): string | null => {
    const sv = (s as any)[k];
    if (typeof sv === "string" && sv.trim().length > 0) return sv;
    const ev = extracted[k];
    if (typeof ev === "string" && ev.trim().length > 0) {
      filled.push(k);
      return ev;
    }
    return (typeof sv === "string" ? sv : null) ?? null;
  };

  const fields: MergedBriefFields = {
    executive_intro_text: pick("executive_intro_text"),
    options_summary: pick("options_summary"),
    requested_decision_text: pick("requested_decision_text"),
    recommendation_text: pick("recommendation_text"),
    guardrails_text: pick("guardrails_text"),
    residual_risks_text: pick("residual_risks_text"),
    open_questions_text: pick("open_questions_text"),
    confidence_level: s.confidence_level ?? null,
    decision_readiness: s.decision_readiness ?? null,
  };

  return {
    fields,
    filledFromMarkdown: filled,
    usedMarkdownFallback: filled.length > 0,
  };
}
