// AI-GUIDE.V2-UX.1
// Normal-user presentation profile for V2 Guide answers.
//
// This is presentation-only sanitization for the user-facing BTPM Guide
// drawer. It does NOT change the V2 pipeline, the stored final_answer, or
// what admin diagnostic tools see. It removes two classes of artifacts that
// make the V2 answer feel like internal QA output rather than normal
// product UX:
//
//   1) Duplicated plain-text "Sources:" / "Relevant Knowledge Center
//      articles:" / "For more information..." trailing source lines, since
//      the drawer renders source links separately below the message.
//
//   2) "Verified click-by-click" defensive disclaimers, which should only
//      appear when the user explicitly asked for exact buttons / clicks /
//      menu paths.
//
// This file intentionally contains NO question-answer maps and NO
// canned-prose regexes that rewrite answer content. It only removes
// presentation artifacts at sentence/line granularity.

const SOURCE_LINE_PREFIXES: RegExp[] = [
  /^\s*sources?:\s*/i,
  /^\s*relevant knowledge center articles?:\s*/i,
  /^\s*related knowledge center articles?:\s*/i,
  /^\s*for more information[, ].*(refer|see|read|check)/i,
  /^\s*see also\s*:/i,
  /^\s*further reading\s*:/i,
];

const CLICK_DISCLAIMER_PATTERNS: RegExp[] = [
  /verified click[- ]by[- ]click/i,
  /exact ui controls have not been verified/i,
  /exact click path is not verified/i,
  /exact buttons? (?:and|or) menus? .* not (?:yet )?verified/i,
  /do not have verified (?:click|button|menu|control)/i,
  /cannot confirm the exact (?:button|menu|click|control)/i,
];

const EXPLICIT_CLICK_REQUEST_PATTERNS: RegExp[] = [
  /which (?:exact )?button/i,
  /what button/i,
  /click[- ]by[- ]click/i,
  /exact click/i,
  /exact clicks/i,
  /where (?:exactly )?is the button/i,
  /show me the (?:exact )?clicks/i,
  /what control do i use/i,
  /which control/i,
  /exact menu path/i,
  /menu path/i,
  /\bclick path\b/i,
  /button name/i,
  /exact ui steps/i,
  /exact steps to click/i,
];

export function userAskedForExactClicks(question: string): boolean {
  if (!question) return false;
  return EXPLICIT_CLICK_REQUEST_PATTERNS.some((re) => re.test(question));
}

function stripTrailingSourceLines(body: string): string {
  const lines = body.split(/\r?\n/);
  // Remove trailing blocks (possibly bullet list) that begin with a source-lead line.
  let end = lines.length;
  // Walk backward, skipping trailing blank lines.
  while (end > 0 && lines[end - 1].trim() === "") end--;

  // Find the start of the trailing source block, if any.
  let blockStart = -1;
  for (let i = end - 1; i >= 0; i--) {
    const line = lines[i];
    if (SOURCE_LINE_PREFIXES.some((re) => re.test(line))) {
      blockStart = i;
      break;
    }
    // Allow bullets/numbered list lines or short title lines to be part of the
    // trailing source block while scanning upward — stop on any line that
    // looks like real prose (>= 2 sentences, no leading bullet).
    const isListish = /^\s*([-*+•]|\d+[.)])\s+/.test(line) || line.trim().length === 0;
    if (!isListish) break;
  }

  if (blockStart === -1) return body;
  const kept = lines.slice(0, blockStart);
  // Trim trailing blanks left over.
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  return kept.join("\n");
}

function stripInlineSourceTail(body: string): string {
  // Handles cases like: "... and reporting. Sources: A, B, C"
  // Only collapse when the "Sources:" appears mid-paragraph at the end.
  return body.replace(
    /\s*(?:[—–-]\s*)?(?:sources?|relevant knowledge center articles?|related knowledge center articles?)\s*:\s*[^\n]*$/i,
    "",
  );
}

function stripClickDisclaimerSentences(body: string): string {
  // Split into sentences conservatively and drop any sentence matching a
  // disclaimer pattern. Preserve paragraph breaks.
  const paragraphs = body.split(/\n{2,}/);
  const cleanedParagraphs = paragraphs.map((para) => {
    const lines = para.split(/\n/);
    const cleanedLines = lines.map((line) => {
      // Split on sentence boundaries (., !, ?) while keeping delimiters.
      const parts = line.split(/(?<=[.!?])\s+/);
      const kept = parts.filter(
        (sentence) => !CLICK_DISCLAIMER_PATTERNS.some((re) => re.test(sentence)),
      );
      return kept.join(" ").replace(/\s{2,}/g, " ").trim();
    });
    return cleanedLines.filter((l) => l.length > 0).join("\n");
  });
  return cleanedParagraphs.filter((p) => p.length > 0).join("\n\n");
}

export interface PresentNormalAnswerInput {
  question: string;
  answer: string;
}

export function presentNormalGuideAnswer(input: PresentNormalAnswerInput): string {
  const original = (input.answer ?? "").trim();
  if (!original) return original;

  let out = original;

  // Always remove trailing/duplicated source listings — the drawer renders
  // clickable source links separately.
  out = stripTrailingSourceLines(out);
  out = stripInlineSourceTail(out);

  // Only remove click-by-click disclaimers when the user did not explicitly
  // ask for exact clicks/buttons/menu paths.
  if (!userAskedForExactClicks(input.question)) {
    out = stripClickDisclaimerSentences(out);
  }

  out = out.replace(/\n{3,}/g, "\n\n").trim();

  // Safety: never return empty after sanitation; fall back to original.
  if (out.length === 0) return original;
  return out;
}
