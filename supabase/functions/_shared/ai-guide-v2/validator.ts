// AI-GUIDE.V2.6 — Validator and fail-closed gate.
//
// Final safety check. Inspects the rendered answer against the classification,
// knowledge pack, routing result, and answer plan. Decides whether the answer
// may be returned, must be regenerated once with stricter instructions, or
// must be replaced with a deterministic safe fallback.
//
// The validator is the final guardrail. It must fail closed.
//
// Hard separation:
//   - No LLM calls (deterministic only).
//   - No imports from v1 runtime.
//   - No persistence.
//   - No operational/SharePoint/Power BI access.

import type {
  GuideV2AnswerMode,
  GuideV2AnswerPlan,
  GuideV2IntentClassification,
  GuideV2KnowledgePack,
  GuideV2ValidationResult,
} from "./types.ts";
import type { GuideV2RoutingResult } from "./router.ts";

export interface ValidateGuideV2AnswerInput {
  question: string;
  classification: GuideV2IntentClassification;
  knowledgePack: GuideV2KnowledgePack;
  routingResult: GuideV2RoutingResult;
  answerPlan: GuideV2AnswerPlan;
  renderedAnswer: string;
  renderSafety?: unknown;
  // If true, fail-closed instead of asking for another regeneration.
  alreadyRegenerated?: boolean;
}

// ---------------------------------------------------------------------------
// Pattern banks (deterministic; align with renderer safety patterns)
// ---------------------------------------------------------------------------

const ACTION_COMPLETION_PATTERNS: RegExp[] = [
  /\bi (?:have |')?(?:just )?(?:created|updated|submitted|generated|granted|deleted|sent|invited|added|removed|changed|set|saved)\b/i,
  /\bi['’]ve (?:created|updated|submitted|generated|granted|deleted|sent|invited|added|removed|changed|set|saved)\b/i,
  /\bdone[.!]?\s*$/i,
  /\baction (?:was|has been) completed\b/i,
  /\bcompleted (?:the|this) action\b/i,
];

const OPERATIONAL_DATA_PATTERNS: RegExp[] = [
  /\bcurrently open blockers (?:are|in|include)\b/i,
  /\bthe kpi value is\b/i,
  /\bi found in power bi\b/i,
  /\bi read the sharepoint\b/i,
  /\bi opened (?:power bi|sharepoint|the project)\b/i,
  /\bi looked up your (?:project|task|kpi|blocker|phase)\b/i,
  /\bi checked (?:your )?(?:project|btpm|the data|the system)\b/i,
  /\baccording to (?:power bi|sharepoint)\b/i,
  /\bthe (?:open )?blockers (?:are|include|right now)\b/i,
];

const SPECULATIVE_UI_PATTERNS: RegExp[] = [
  /\blook for an option (?:like|labeled|called)\b/i,
  /\bmay be (?:under|in|on|located)\b/i,
  /\bmight be (?:under|in|on|located)\b/i,
  /\btypically (?:located|found|under|in|shown|labeled|called)\b/i,
  /\busually (?:located|found|under|in|shown)\b/i,
  /\bsomewhere (?:under|in|on)\b/i,
  /\bsimilar button\b/i,
  /\bsomething like\b/i,
  /\bsometimes shown as\b/i,
];

// QA.RC1: stricter speculative-location patterns reserved for unverified
// safe-limit answers, where ANY hedged "typically/usually/look for" wording
// is unsafe because the exact UI is, by definition, not verified.
const STRICT_SPECULATIVE_UI_PATTERNS: RegExp[] = [
  /\btypically\b/i,
  /\busually\b/i,
  /\bfind the option\b/i,
  /\blook for (?:the |an? )?(?:option|button|control|setting|tab|menu|page)\b/i,
  /\bthere should be\b/i,
  /\bit['’]?s (?:usually|typically)\b/i,
];

const INTERNAL_LEAKAGE_PATTERNS: RegExp[] = [
  /\bsystem prompt\b/i,
  /\bdeveloper message\b/i,
  /\bhidden (?:instruction|message)\b/i,
  /\bprovider log\b/i,
  /\bembedding(?:s)?\b/i,
  /\bvector database\b/i,
  /\bpgvector\b/i,
  /\brpc\b/i,
  /\bedge function\b/i,
  /\bservice role\b/i,
  /\bdebug\b/i,
  /\bworkflow_id\b/i,
  /\bAI[- ]GUIDE\b/i,
  /\bV2(?:\.\d+)?\b/,
  /\bclassifier\b/i,
  /\bknowledge pack\b/i,
  /\banswer plan\b/i,
  /\brenderer\b/i,
  /\bvalidator\b/i,
  /\bmanual UI verification\b/i,
  /\blast verified\b/i,
  /\bverified against\b/i,
  /^title:/im,
  /\btitle:\s/i,
  // Route placeholders
  /\/:[a-zA-Z]+/,
  /:projectId\b/,
  /:workspaceId\b/,
  /:phaseId\b/,
  /:taskId\b/,
  /\/:id\b/,
  /\{[a-zA-Z_]+Id\}/,
  // V2.8-FIX: raw user-facing app paths
  /(?<![\w./-])\/(?:knowledge|files|projects|project|roadmap|admin|workspace|workspaces|programs|program|tasks|my-work|account)(?:\/[a-zA-Z0-9_\-/]*)?\b/i,
];

// Add-dependency–specific UI claims that are not in verified registry.
const DEPENDENCY_UNSUPPORTED_CLAIMS: RegExp[] = [
  /\bcreate (?:the )?dependency (?:from|in) (?:the )?gantt\b/i,
  /\bdependency from (?:the )?gantt view\b/i,
  /\bcross[- ]level dependenc/i,
];

// V2.8-FIX.2: procedural-hint phrases banned only in action-refusal mode.
const ACTION_REFUSAL_PROCEDURAL_PHRASES: RegExp[] = [
  /\blook for (?:an? )?option\b/i,
  /\bfind (?:the |an? )?option\b/i,
  /\buse (?:the |an? )?option\b/i,
  /\bselect (?:the |an? )?option\b/i,
  /\bthere,? you (?:should |will |can )?(?:find|see)\b/i,
  /\bfollow (?:the )?(?:appropriate )?steps?\b/i,
  /\bfollow the procedure\b/i,
  /\bnavigate to (?:the )?relevant (?:area|page|section)\b/i,
  /\bwhere you manage\b/i,
  /\bwhere you can\b/i,
  /\bgo to (?:the )?relevant (?:page|area|section)\b/i,
  /\bto do this,? (?:go|navigate|open|head)\b/i,
  /\bfor more information,? (?:go|navigate|open)\b/i,
  /\bclick\b/i,
  /\bsave\b/i,
  /\bconfirm the action\b/i,
  /\bupload (?:files? )?directly\b/i,
  /\bsend it via\b/i,
  /\brun the sync\b/i,
  /\bretry the submission\b/i,
  /\barchive the project\b/i,
  /\bmark as done\b/i,
  /\bassign it\b/i,
];

// Approved-baseline-date-change unsupported claims.
const BASELINE_UNSUPPORTED_CLAIMS: RegExp[] = [
  /\bbaseline settings page\b/i,
  /\bedit (?:the )?approved baseline (?:date|in place)\b/i,
  /\bparallel new baseline\b/i,
  /\bprevious baselines? (?:remain|are still) recoverable\b/i,
];

// Out-of-scope Paris content
const OUT_OF_SCOPE_PARIS_PATTERNS: RegExp[] = [
  /\beiffel\b/i,
  /\blouvre\b/i,
  /\bmontmartre\b/i,
  /\bnotre[- ]dame\b/i,
  /\bseine\b/i,
];

function findMatches(patterns: RegExp[], text: string): string[] {
  const hits: string[] = [];
  for (const re of patterns) {
    if (re.test(text)) hits.push(re.source);
  }
  return hits;
}

function countNumberedSteps(text: string): number {
  const matches = text.match(/^\s*\d+\.\s+/gm);
  return matches ? matches.length : 0;
}

// QA.1: identify procedural UI/action steps (vs conceptual checklists).
// Returns the count of numbered/bulleted items that contain forbidden UI verbs
// such as click/save/select/open/navigate/press/submit/upload/sync/delete.
const PROCEDURAL_UI_VERB_RE =
  /\b(click|press|tap|select|choose|open|navigate (?:to|into)|go to|head to|head over to|head into|head back to|hit|toggle|drag|drop|save|submit|upload|download|sync|delete|remove|archive|create|add|update|edit|invite|grant|send|run the sync|retry the submission|mark as done|assign it)\b/i;

function countProceduralStepLines(text: string): number {
  const lines = (text || "").split(/\r?\n/);
  let n = 0;
  for (const raw of lines) {
    const line = raw.replace(/^\s*(?:\d+[.)]|[-*•·])\s+/, "");
    if (line === raw) continue; // not a list item
    if (PROCEDURAL_UI_VERB_RE.test(line)) n++;
  }
  return n;
}

// QA.1: source-line normalization for safer plan-source matching.
// Strips leading bullets/dashes, surrounding quotes, trailing punctuation,
// "(slug)" parens, smart-quote/whitespace normalization. Returns title + slug.
function normalizeCitedSource(raw: string): { title: string; slug: string | null } {
  let s = (raw || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/^\s*(?:[-*•·\u2013\u2014]+|\d+[.)])\s+/, "")
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .replace(/[.;:,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let slug: string | null = null;
  const m = s.match(/^(.*?)\s*\(([a-z0-9][a-z0-9-]+)\)\s*$/i);
  if (m) {
    s = m[1].trim().replace(/[.;:,]+$/g, "");
    slug = m[2].toLowerCase();
  }
  return { title: s, slug };
}

// QA.1: split a Sources section into individual citation strings WITHOUT
// breaking on " and " (real titles contain it), commas inside parens, or
// commas inside a title that's part of the plan's source list.
function splitSourceCitations(text: string, planTitlesLc: string[]): string[] {
  if (!text) return [];
  // Prefer per-line split when there are multiple lines.
  const lines = text.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.flatMap((l) => splitSingleLineSources(l, planTitlesLc));
  }
  return splitSingleLineSources(lines[0] ?? text, planTitlesLc);
}

function splitSingleLineSources(line: string, planTitlesLc: string[]): string[] {
  // Strip a leading "Sources:"/"Relevant Knowledge Center articles:"/etc.
  const cleaned = line.replace(
    /^\s*(?:sources?|relevant knowledge center articles?|for more information|see also)\s*:\s*/i,
    "",
  );
  // Try plan-title aware split first: if a known title contains commas,
  // protect those commas while splitting on the rest.
  let working = cleaned;
  const placeholders: string[] = [];
  for (const t of planTitlesLc) {
    if (!t.includes(",")) continue;
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const found = working.match(re);
    if (found) {
      const tok = `__SRC_${placeholders.length}__`;
      placeholders.push(found[0]);
      working = working.replace(re, tok);
    }
  }
  // Split on commas/semicolons/bullets only — never on " and ".
  const parts = working
    .split(/\s*[,;\u2022]\s*|\s+•\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      let out = p;
      placeholders.forEach((orig, i) => {
        out = out.replace(`__SRC_${i}__`, orig);
      });
      return out;
    });
  return parts;
}

// V2.8-FIX.3: Split rendered answer into structured sections so the validator
// only scans the main body for forbidden claims. Sections like "Sources:",
// "Relevant Knowledge Center articles:", "Next suggestions:", and trailing
// "Notes:" are user-facing meta and must NOT be treated as factual claims or
// internal leakage.
export interface ParsedAnswerSections {
  body: string;
  sources_text: string;
  next_text: string;
  notes_text: string;
}

const SECTION_HEADER_RE =
  /(^|\n)\s*(sources?|relevant knowledge center articles?|next suggestions?|notes?|limitation notes?)\s*:\s*/i;

export function parseAnswerSections(answer: string): ParsedAnswerSections {
  const a = answer || "";
  const lines = a.split(/\r?\n/);
  type Bucket = "body" | "sources" | "next" | "notes";
  let cur: Bucket = "body";
  const buckets: Record<Bucket, string[]> = { body: [], sources: [], next: [], notes: [] };
  for (const line of lines) {
    const m = line.match(/^\s*(sources?|relevant knowledge center articles?|next suggestions?|notes?|limitation notes?)\s*:\s*(.*)$/i);
    if (m) {
      const header = m[1].toLowerCase();
      if (header.startsWith("source") || header.startsWith("relevant knowledge")) cur = "sources";
      else if (header.startsWith("next")) cur = "next";
      else cur = "notes";
      if (m[2]) buckets[cur].push(m[2]);
      continue;
    }
    buckets[cur].push(line);
  }
  return {
    body: buckets.body.join("\n").trim(),
    sources_text: buckets.sources.join("\n").trim(),
    next_text: buckets.next.join("\n").trim(),
    notes_text: buckets.notes.join("\n").trim(),
  };
}

// V2.8-FIX.3: in prompt_injection_refusal mode the answer naturally includes
// phrases like "I cannot share the system prompt" — these are correct refusals,
// not leakage. Only flag when the phrase appears WITHOUT a refusal verb nearby.
function isContextualRefusalMention(body: string, phrase: RegExp): boolean {
  const m = body.match(phrase);
  if (!m) return false;
  const idx = m.index ?? 0;
  const window = body.slice(Math.max(0, idx - 80), idx + 80).toLowerCase();
  return /\b(cannot|can't|can not|won['’]t|will not|unable to|do not|don['’]t)\s+(reveal|share|disclose|expose|tell|show|provide|leak|return|output|repeat)\b/.test(
    window,
  ) || /\b(i (?:can|will) only (?:answer|help))\b/.test(window);
}

// ---------------------------------------------------------------------------
// Safe fallback answers (deterministic)
// ---------------------------------------------------------------------------

const FALLBACKS: Record<GuideV2AnswerMode, string> = {
  verified_workflow:
    "I cannot safely render this workflow answer right now. Please refer to the relevant Knowledge Center article or ask an admin to review the guidance.",
  unverified_workflow_safe_limit:
    "I do not have verified click-by-click BTPM guidance for this action yet. I can only point you to the related Knowledge Center article.",
  unsupported_workflow:
    "This action is not supported in BTPM today. Please check the Knowledge Center for related guidance.",
  kc_concept:
    "I found the relevant Knowledge Center article, but I do not have enough verified text to explain it safely.",
  troubleshooting:
    "I do not have enough verified troubleshooting guidance for this in BTPM. Please check the Knowledge Center.",
  data_refusal_with_navigation:
    "I cannot read live BTPM data. Please open the relevant project in BTPM and check the appropriate page directly.",
  action_refusal_with_guidance:
    "I cannot perform this action for you. Ask how to do it yourself, or contact an admin if you need permission.",
  prompt_injection_refusal:
    "I can only answer using approved BTPM guidance.",
  out_of_scope_refusal:
    "I can help with BTPM questions only.",
  insufficient_knowledge:
    "I do not have enough verified BTPM guidance to answer this safely.",
};

function safeFallbackFor(mode: GuideV2AnswerMode): string {
  return FALLBACKS[mode] ?? FALLBACKS.insufficient_knowledge;
}

// ARCH.1B-REFINE.1: fallback selection is now based on structured signals
// only (answer_plan mode + diagnosis_situation from knowledge pack metadata).
// No raw-question regex; no blocker-specific deterministic prose.
function pickFailClosedFallback(args: {
  mode: GuideV2AnswerMode;
}): string {
  return safeFallbackFor(args.mode);
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

export function validateGuideV2Answer(
  input: ValidateGuideV2AnswerInput,
): GuideV2ValidationResult {
  const { answerPlan, renderedAnswer, routingResult } = input;
  const a = (renderedAnswer || "").trim();
  const mode = answerPlan.answer_mode;

  // V2.8-FIX.3: scan ONLY the main body for forbidden claims. Sources, Next
  // suggestions, and Notes sections are user-facing meta and not factual
  // claims. This eliminates false positives where source titles or next-step
  // hints (e.g. "open Roadmap") were treated as internal leakage / mismatches.
  const sections = parseAnswerSections(a);
  // QA.RC1: additionally strip any body line whose plain text equals a
  // plan-source title (case-insensitive, light normalization). This prevents
  // bare citation lines (no "Sources:" header) from being scored as claims
  // in baseline / must_not_say checks.
  const planTitlesLcSet = new Set(
    (answerPlan.sources || [])
      .map((s) => (s.title || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const bodyLines = (sections.body || a).split(/\r?\n/);
  const filteredBodyLines = bodyLines.filter((raw) => {
    const t = raw
      .replace(/^\s*(?:[-*•·\u2013\u2014]+|\d+[.)])\s+/, "")
      .replace(/[\s"'`.;,:]+$/g, "")
      .trim()
      .toLowerCase();
    if (!t) return true;
    return !planTitlesLcSet.has(t);
  });
  const body = filteredBodyLines.join("\n").trim() || sections.body || a;

  const violations: string[] = [];
  const unsupported_claims: string[] = [];
  const speculative_ui_claims: string[] = [];
  const operational_data_claims: string[] = [];
  const action_completion_claims: string[] = [];
  const internal_leakage_claims: string[] = [];
  const source_mismatch_claims: string[] = [];
  const warnings: string[] = [];

  // V2.8-FIX.4: empty / dash-only / whitespace-only / sources-only answers
  // must NEVER pass validation. Strip section markers + punctuation/whitespace;
  // if fewer than 8 meaningful characters remain, the answer is non-substantive.
  const bodyMeaningful = body.replace(/[\s\-\u2013\u2014—•·.]+/g, "");
  if (bodyMeaningful.length < 8) {
    violations.push("empty_or_dash_answer_body");
  }

  // ---------- Category 8: Internal terminology / route placeholder leakage
  // V2.8-FIX.3: in prompt_injection_refusal mode the answer naturally mentions
  // "system prompt" / "hidden instructions" while refusing to reveal them.
  // Treat such mentions as safe when surrounded by refusal wording.
  for (const re of INTERNAL_LEAKAGE_PATTERNS) {
    if (!re.test(body)) continue;
    if (
      mode === "prompt_injection_refusal" &&
      (re.source.includes("system prompt") ||
        re.source.includes("hidden") ||
        re.source.includes("developer message") ||
        re.source.includes("debug"))
    ) {
      if (isContextualRefusalMention(body, re)) continue;
    }
    internal_leakage_claims.push(re.source);
  }

  // ---------- Category 5: Action completion (forbidden in all modes; especially refusal)
  for (const m of findMatches(ACTION_COMPLETION_PATTERNS, body)) {
    action_completion_claims.push(m);
  }

  // ---------- Category 4: Operational/live data claims (forbidden everywhere)
  for (const m of findMatches(OPERATIONAL_DATA_PATTERNS, body)) {
    operational_data_claims.push(m);
  }

  // ---------- Category 2/3: Speculative UI wording in workflow-shaped answers
  if (mode === "verified_workflow" || mode === "unverified_workflow_safe_limit") {
    for (const m of findMatches(SPECULATIVE_UI_PATTERNS, body)) {
      speculative_ui_claims.push(m);
    }
  }

  // ---------- Category 1: Plan compliance — extra steps / mode mismatch
  const stepCount = countNumberedSteps(body);
  if (answerPlan.allowed_steps.length === 0 && stepCount > 0) {
    violations.push(`steps_present_when_plan_allows_none(${stepCount})`);
  } else if (
    answerPlan.allowed_steps.length > 0 &&
    stepCount > answerPlan.allowed_steps.length
  ) {
    violations.push(
      `more_steps_than_plan(${stepCount}>${answerPlan.allowed_steps.length})`,
    );
  }
  if (routingResult.answer_mode !== mode) {
    violations.push(
      `mode_mismatch(plan=${mode}, routing=${routingResult.answer_mode})`,
    );
  }

  // ---------- must_not_say
  const bodyLc = body.toLowerCase();
  for (const phrase of answerPlan.must_not_say) {
    if (phrase && bodyLc.includes(phrase.toLowerCase())) {
      if (phrase.length >= 8) {
        violations.push(`contradicts_must_not_say:${phrase.slice(0, 60)}`);
      } else {
        warnings.push(`weak_must_not_say_hit:${phrase}`);
      }
    }
  }

  // ---------- Category 2: Verified workflow step compliance
  if (mode === "verified_workflow") {
    for (const m of findMatches(DEPENDENCY_UNSUPPORTED_CLAIMS, body)) {
      if (routingResult.workflow_id === "add_dependency") {
        unsupported_claims.push(`dependency_ui_not_in_registry:${m}`);
      }
    }
    for (const m of findMatches(BASELINE_UNSUPPORTED_CLAIMS, body)) {
      if (routingResult.workflow_id === "approved_baseline_date_change") {
        unsupported_claims.push(`baseline_claim_not_in_registry:${m}`);
      }
    }
  }

  // ---------- Category 3: Unverified safe-limit compliance
  if (mode === "unverified_workflow_safe_limit") {
    if (stepCount > 0) {
      violations.push("steps_in_safe_limit_mode");
    }
    // QA.RC1.A4: hedged "typically / usually / look for / there should be"
    // wording is unsafe for unverified exact-location answers.
    for (const m of findMatches(STRICT_SPECULATIVE_UI_PATTERNS, body)) {
      speculative_ui_claims.push(`unverified_hedged_location:${m}`);
    }
  }

  // ---------- Category 4: Data refusal compliance
  if (mode === "data_refusal_with_navigation") {
    const claimsCheck = /\bi (?:checked|opened|read|looked up|found)\b/i;
    if (claimsCheck.test(body)) {
      operational_data_claims.push("claims_assistant_inspected_data");
    }
    const requiresBtpmRef =
      /btpm/i.test(a) || /knowledge center/i.test(a) || /check (?:the )?project/i.test(a);
    if (!requiresBtpmRef) {
      warnings.push("data_refusal_missing_btpm_navigation");
    }
  }

  // ---------- Category 5: Action refusal compliance
  if (mode === "action_refusal_with_guidance") {
    const acknowledgesLimit =
      /\bcannot\s+(?:perform|do|run|execute|create|update|delete|submit|invite|generate|change|modify)\b/i.test(body) ||
      /\bcan(?:not|['’]t)\s+(?:do (?:it|this|that) for you|perform this action|change (?:any )?records?|update (?:any )?records?)\b/i.test(body) ||
      /\bunable to\s+(?:perform|do|run|execute|create|update|delete|submit|invite|generate|change)\b/i.test(body);
    if (!acknowledgesLimit) {
      warnings.push("action_refusal_missing_explicit_limit");
    }
    for (const m of findMatches(ACTION_REFUSAL_PROCEDURAL_PHRASES, body)) {
      unsupported_claims.push(`action_refusal_procedural_hint:${m}`);
    }
  }

  // ---------- Category 7: Out of scope compliance
  if (mode === "out_of_scope_refusal") {
    for (const m of findMatches(OUT_OF_SCOPE_PARIS_PATTERNS, body)) {
      violations.push(`out_of_scope_answered_content:${m}`);
    }
    if (a.length > 320) {
      warnings.push("out_of_scope_answer_too_long");
    }
  }


  // ---------- Category 1 (continued): steps when plan allows none.
  // QA.1: for safe-concept modes, bullets/numbered items are only treated as
  // a violation when they contain procedural UI/action verbs. Conceptual
  // checklists (e.g. "Check whether…", "Confirm the reporting period.") are
  // allowed, but still surfaced via warnings if abundant.
  if (answerPlan.allowed_steps.length === 0 && stepCount > 0) {
    const isSafeMode =
      mode === "kc_concept" ||
      mode === "troubleshooting" ||
      mode === "unverified_workflow_safe_limit" ||
      mode === "unsupported_workflow" ||
      mode === "insufficient_knowledge" ||
      mode === "data_refusal_with_navigation" ||
      mode === "action_refusal_with_guidance";
    if (isSafeMode) {
      const procedural = countProceduralStepLines(body);
      if (procedural > 0) {
        // Already flagged by violations.push above — keep as a fail.
      } else {
        // Replace the hard violation with a warning.
        const idx = violations.indexOf(`steps_present_when_plan_allows_none(${stepCount})`);
        if (idx >= 0) violations.splice(idx, 1);
        warnings.push(`non_procedural_checklist_detected(${stepCount})`);
      }
    }
  }

  // ---------- Category 9: Source discipline
  // QA.1: bullet/quote/parens-slug normalization + slug-aware matching.
  // Source titles legitimately contain commas and " and " — preserve them.
  const planTitles = answerPlan.sources.map((s) => s.title.trim());
  const planTitlesLc = planTitles.map((t) => t.toLowerCase());
  const planSlugsLc = answerPlan.sources.map((s) => (s.slug || "").toLowerCase()).filter(Boolean);
  const sourcesText = sections.sources_text || "";
  if (sourcesText && (planTitlesLc.length > 0 || planSlugsLc.length > 0)) {
    const cited = splitSourceCitations(sourcesText, planTitlesLc)
      .map((c) => normalizeCitedSource(c))
      .filter((c) => c.title.length >= 3 || (c.slug && c.slug.length >= 3));
    for (const c of cited) {
      const cLc = c.title.toLowerCase();
      const slugOk = c.slug ? planSlugsLc.includes(c.slug) : false;
      const titleOk =
        cLc.length >= 3 &&
        planTitlesLc.some((t) => t === cLc || t.includes(cLc) || cLc.includes(t));
      if (!slugOk && !titleOk) {
        source_mismatch_claims.push(c.title.slice(0, 80) || c.slug || "");
      }
    }
  }

  // ---------- Category 10: Generic / weak answer quality
  if (mode === "kc_concept" || mode === "troubleshooting") {
    const hasSnippets = (answerPlan.grounding_snippets?.length ?? 0) > 0;
    const acknowledgesGap =
      /not (?:enough|sufficient) verified|don['’]t have enough verified|do not have enough verified|not verified|exact task-level controls are not verified/i.test(
        body,
      );
    if (!hasSnippets && !acknowledgesGap && body.length > 40) {
      // QA.1: when at least one visible plan source exists and the body is
      // non-empty + safe, demote to a warning so safe BTPM concept answers
      // are not fail-closed solely because grounding snippets were not picked.
      if (answerPlan.sources.length > 0) {
        warnings.push("concept_without_grounding_snippets_soft");
      } else {
        violations.push("concept_without_grounding_or_acknowledgment");
      }
    }
    if (hasSnippets) {
      const stripped = body;
      const meaningful = stripped
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 12).length;
      if (meaningful < 2 || stripped.length < 140) {
        warnings.push("concept_too_thin");
      }
      const qLc = (input.question || "").toLowerCase();
      const lc = stripped.toLowerCase();
      if (qLc.includes("baseline") && qLc.includes("current plan")) {
        if (!(lc.includes("baseline") && lc.includes("current plan"))) {
          warnings.push("baseline_concept_missing_both_terms");
        }
      }
      // ARCH.1B-REFINE.1: lifecycle distinction (status / stage / health / progress).
      // If the user asked for the difference between several of these four,
      // require every term they asked about to appear in the body.
      const lifecycleTerms = ["status", "stage", "health", "progress"] as const;
      const askedAbout = lifecycleTerms.filter((t) => qLc.includes(t));
      if (askedAbout.length >= 3 && /\bdifference\b|\bvs\.?\b|\bversus\b/.test(qLc)) {
        const missing = askedAbout.filter((t) => !lc.includes(t));
        if (missing.length > 0) {
          warnings.push(`lifecycle_concept_missing_terms:${missing.join("/")}`);
        }
      }
    }

    // QA.4 — concept-answer shape quality warnings (warnings only, not fails).
    const shape = (answerPlan as unknown as { concept_answer_shape?: string }).concept_answer_shape ?? null;
    const bodyLcQa4 = body.toLowerCase();
    const genericFiller =
      /\b(effective project management|features and functionalities|various tools and features|provides various tools)\b/i;
    if (genericFiller.test(body)) warnings.push("concept_answer_generic_filler");
    if (shape === "definition") {
      if (body.length < 100 || countNumberedSteps(body) === 0 && body.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length >= 12).length < 2) {
        warnings.push("thin_definition_answer");
      }
    }
    if (shape === "comparison") {
      const terms = ((answerPlan as unknown as { key_definitions?: { term: string }[] }).key_definitions ?? [])
        .map((k) => (k.term || "").toLowerCase()).filter((t) => t.length >= 2);
      const missing = terms.filter((t) => !bodyLcQa4.includes(t));
      if (terms.length >= 2 && missing.length > 0) {
        warnings.push(`comparison_missing_compared_term:${missing.join("/")}`);
      }
      const hasDecisionRule = /\bwhen (?:to use|you should|to choose|to pick)|\buse .+ when\b|\bif .+ then\b|\buse .+ for\b|\buse .+ if\b/i.test(body);
      if (!hasDecisionRule) warnings.push("missing_decision_rule_for_comparison");
    }
    if (shape === "page_purpose") {
      const hasPagePurpose = /\b(use this page|the .+ page is for|this page (?:shows|lets you|is where|is for)|on this page you (?:can|see|manage))\b/i.test(body);
      if (!hasPagePurpose) warnings.push("page_purpose_answer_too_generic");
    }
    if (shape === "safe_unverified_workflow_guidance") {
      const sg = ((answerPlan as unknown as { safe_guidance_points?: string[] }).safe_guidance_points ?? []);
      if (sg.length === 0) warnings.push("safe_guidance_missing_useful_points");
    }
  }


  // ---------- ARCH.1B-FIX.1: Diagnosis-aware consistency checks ----------
  // Pull diagnosis from the knowledge pack's metadata_signals (knowledge-pack
  // sets diagnosis_situation when ARCH.1B diagnosis was used). These checks
  // never fabricate violations on their own — they only enforce that an
  // already-rendered answer matches the BTPM domain situation it was planned
  // against.
  const sigs = (input.knowledgePack.metadata_signals as Record<string, unknown>) || {};
  const diagSituation =
    typeof sigs.diagnosis_situation === "string" ? (sigs.diagnosis_situation as string) : null;
  const bodyLcAll = (body || "").toLowerCase();
  const mentionsBlocker = /\bblocker(?:s)?\b/.test(bodyLcAll);
  const mentionsRisk = /\brisk(?:s)?\b/.test(bodyLcAll);
  const mentionsDependency = /\bdependenc(?:y|ies)\b/.test(bodyLcAll);
  const mentionsRecord =
    /\brecord\b|\bcapture\b|\bdocument\b|\bnote\b|\blog\b|\btrack\b|\bupdate\b/.test(bodyLcAll);

  if (diagSituation === "blocked_work" && mode !== "action_refusal_with_guidance" &&
      mode !== "data_refusal_with_navigation" && mode !== "prompt_injection_refusal" &&
      mode !== "out_of_scope_refusal") {
    // HUMANQA.1 — relaxed substance check. Accept useful blocker guidance
    // when AT LEAST TWO of these substance signals are present, instead of
    // requiring each one individually. Keeps fail-closed for empty / off-topic
    // answers while not penalising answers that simply phrase things differently.
    const substanceSignals = [
      mentionsBlocker,
      mentionsRisk,
      mentionsRecord,
      /\bowner|assignee|responsible|accountable\b/.test(bodyLcAll),
      /\bnext (?:action|step|decision)|decision needed|action needed|what to do next\b/.test(bodyLcAll),
      /\b(remove|resolve|unblock|clear|address)\b/.test(bodyLcAll),
      /\b(current obstacle|already (?:stopping|blocking|preventing)|preventing progress)\b/.test(bodyLcAll),
    ].filter(Boolean).length;
    if (substanceSignals < 2) {
      violations.push("blocked_work_insufficient_substance_signals");
    }
    if (/dependenc(?:y|ies)\s+is\s+the\s+main\s+solution|use\s+a\s+dependency\s+to\s+(?:fix|resolve|unblock)/i.test(body)) {
      violations.push("blocked_work_misuses_dependency_as_solution");
    }
    if (/\bi (?:have |')?(?:just )?created (?:a |the )?blocker\b/i.test(body)) {
      violations.push("blocked_work_claims_blocker_created");
    }
  }

  if (diagSituation === "future_risk" && mode !== "action_refusal_with_guidance" &&
      mode !== "data_refusal_with_navigation") {
    if (mentionsBlocker && !mentionsRisk) {
      violations.push("future_risk_treated_only_as_blocker");
    }
    if (!(mentionsBlocker && mentionsRisk)) {
      warnings.push("future_risk_missing_risk_vs_blocker_distinction");
    }
  }

  if (diagSituation === "dependency_sequencing" && mode !== "action_refusal_with_guidance") {
    // ARCH.1B-FIX.2: only flag positive claims that dependencies can be
    // created/added/edited from Gantt. Limitation notes like "dependencies
    // cannot be created from the Gantt view" are correct guardrails and must
    // not trigger this violation.
    const positiveGantt =
      /\b(?:can|you can|users can)\s+(?:create|add|make|edit)\s+(?:a |the )?dependenc(?:y|ies)[^.]{0,40}\bfrom\s+(?:the\s+)?gantt\b/i.test(body) ||
      /\bcreate\s+(?:a |the )?dependenc(?:y|ies)\s+(?:from|in)\s+(?:the\s+)?gantt\s+view\b/i.test(body);
    if (positiveGantt) {
      violations.push("dependency_sequencing_claims_gantt_creation");
    }
    if (routingResult.workflow_id === "add_dependency" && mode === "verified_workflow" &&
        !mentionsDependency) {
      violations.push("dependency_sequencing_missing_dependency_flow");
    }
    // HUMANQA.1 — automatic rescheduling must not be claimed unless verified.
    const autoReschedule =
      /\b(?:will|gets|is|are)\s+(?:automatically|auto[- ]?)\s*(?:moved?|shift(?:ed)?|reschedul\w*|adjust\w*|updated?|pushed?)\b/i.test(body) ||
      /\b(?:auto[- ]?(?:move|shift|reschedul\w*|adjust|update|push))\b/i.test(body) ||
      /\b(?:cascad\w+\s+date\s+chang\w+|cascade(?:s|d)?\s+(?:automatically|to)|dates?\s+(?:will|automatically)\s+(?:shift|move|update))\b/i.test(body);
    if (autoReschedule) {
      unsupported_claims.push("dependency_claims_automatic_rescheduling");
    }
  }

  // ARCH.1B-FIX.2: explicit forbidden blocker wording check (post-sanitizer
  // should have rewritten this, but enforce as final guardrail).
  if (diagSituation === "blocked_work" && mode !== "action_refusal_with_guidance" &&
      mode !== "data_refusal_with_navigation" && mode !== "prompt_injection_refusal" &&
      mode !== "out_of_scope_refusal") {
    if (/\brisks[\s\-\u2013\u2014\/]?blockers\s+section\b/i.test(body) ||
        /\brisks\s+and\s+blockers\s+section\b/i.test(body)) {
      violations.push("blocked_work_uses_forbidden_section_wording");
    }
  }


  // ---------- ARCH.1C: predecessor_or_dependency_blocked_work
  if (
    diagSituation === "predecessor_or_dependency_blocked_work" &&
    mode !== "action_refusal_with_guidance" &&
    mode !== "data_refusal_with_navigation" &&
    mode !== "prompt_injection_refusal" &&
    mode !== "out_of_scope_refusal" &&
    mode !== "insufficient_knowledge"
  ) {
    const mentionsPredecessor =
      mentionsDependency ||
      /\bpredecessor|previous task|prior task|earlier task|finish first|complete first|before this task\b/i.test(bodyLcAll);
    if (!mentionsPredecessor) {
      violations.push("predecessor_blocked_missing_dependency_or_predecessor_concept");
    }
    if (/\b(?:you can|users can)\s+create\s+(?:a |the )?dependenc(?:y|ies)\s+(?:from|in)\s+(?:the\s+)?gantt\b/i.test(body)) {
      violations.push("predecessor_blocked_claims_gantt_creation");
    }
    if (!mentionsBlocker) {
      warnings.push("predecessor_blocked_missing_blocker_alternative");
    }
    if (/\bi (?:have |')?(?:just )?(?:created|added) (?:a |the )?dependency\b/i.test(body)) {
      violations.push("predecessor_blocked_claims_dependency_created");
    }
  }

  // ---------- ARCH.1C: progress_or_contribution_reporting
  if (
    diagSituation === "progress_or_contribution_reporting" &&
    mode !== "action_refusal_with_guidance" &&
    mode !== "data_refusal_with_navigation" &&
    mode !== "prompt_injection_refusal" &&
    mode !== "out_of_scope_refusal"
  ) {
    const mentionsExecOrProgress =
      /\bexecution update|progress|status update|report (?:the )?(?:work|update|progress|contribution)|update the task|update progress|update execution\b/i.test(bodyLcAll);
    if (!mentionsExecOrProgress) {
      violations.push("contribution_reporting_missing_execution_or_progress_concept");
    }
    if (/\bi (?:have |')?(?:just )?reported\b/i.test(body)) {
      violations.push("contribution_reporting_claims_assistant_reported");
    }
    // Warn if sources appear to be admin/evaluation grounding only.
    const planSlugs = answerPlan.sources.map((s) => s.slug.toLowerCase());
    if (planSlugs.length > 0) {
      const adminish = planSlugs.filter((s) =>
        /admin|evaluation|guide-evaluation|btpm-guide-admin/.test(s),
      );
      if (adminish.length === planSlugs.length) {
        warnings.push("contribution_reporting_grounding_admin_only");
      }
    }
  }

  // ---------- ARCH.1C: governance_event_reporting
  // 0.7G: carve-out — when the selected/matched workflow is the governance
  // cadence setup workflow, do NOT require evidence/record concepts. Cadence
  // setup (recurring SteerCo expectation) is semantically distinct from
  // recording governance evidence/minutes of a held meeting.
  const matchedWorkflowId =
    routingResult.workflow_id ?? answerPlan.guided_card?.title ?? "";
  const planSlugsLcAll = (answerPlan.sources || [])
    .map((s) => (s.slug || "").toLowerCase());
  const isCadenceWorkflow =
    /create_governance_cadence|governance.cadence/i.test(matchedWorkflowId) ||
    planSlugsLcAll.some((s) => s.includes("create-governance-cadence")) ||
    planSlugsLcAll.some((s) => s.includes("governance-cadence-vs-record"));
  if (
    diagSituation === "governance_event_reporting" &&
    !isCadenceWorkflow &&
    mode !== "action_refusal_with_guidance" &&
    mode !== "data_refusal_with_navigation" &&
    mode !== "prompt_injection_refusal" &&
    mode !== "out_of_scope_refusal"
  ) {
    const mentionsRecordEvidence =
      /\bgovernance (?:record|evidence)|record (?:the )?governance|governance event|record (?:the )?(?:steerco|meeting|review)\b/i.test(bodyLcAll);
    if (!mentionsRecordEvidence) {
      violations.push("governance_event_missing_record_or_evidence_concept");
    }
    const mentionsDetail =
      /\bdecision|outcome|follow[- ]?up|action item|owner|attach|note|evidence|topic\b/i.test(bodyLcAll);
    if (!mentionsDetail) {
      violations.push("governance_event_missing_decisions_or_followups_or_owners");
    }
    if (/\bbtpm (?:schedules|reads|reads from|opens)\b.*\b(?:meeting|outlook|teams|calendar)\b/i.test(bodyLcAll)) {
      violations.push("governance_event_claims_btpm_schedules_or_reads_meeting");
    }
    if (/\bi (?:have |')?(?:just )?(?:created|recorded) (?:a |the )?governance (?:record|entry|evidence)\b/i.test(body)) {
      violations.push("governance_event_claims_record_created");
    }
  }





  // ---------- Aggregate severity
  const failBuckets: string[] = [
    ...violations,
    ...unsupported_claims,
    ...speculative_ui_claims,
    ...operational_data_claims,
    ...action_completion_claims,
    ...internal_leakage_claims,
    ...source_mismatch_claims,
  ];

  let severity: "pass" | "warn" | "fail";
  if (failBuckets.length > 0) severity = "fail";
  else if (warnings.length > 0) severity = "warn";
  else severity = "pass";

  // QA.1: source-mismatch-only fail → warn downgrade for safe answer modes.
  // If the ONLY failures are source_mismatch_claims, and there are no hard
  // safety violations (action/data/leakage/speculative-UI/unsupported), do
  // not fail-close safe concept/troubleshooting/safe-limit/unsupported answers.
  const safeDowngradeMode =
    mode === "kc_concept" ||
    mode === "troubleshooting" ||
    mode === "unverified_workflow_safe_limit" ||
    mode === "unsupported_workflow" ||
    mode === "insufficient_knowledge";
  if (
    severity === "fail" &&
    safeDowngradeMode &&
    source_mismatch_claims.length > 0 &&
    violations.length === 0 &&
    unsupported_claims.length === 0 &&
    speculative_ui_claims.length === 0 &&
    operational_data_claims.length === 0 &&
    action_completion_claims.length === 0 &&
    internal_leakage_claims.length === 0
  ) {
    warnings.push("source_mismatch_only_downgraded");
    severity = "warn";
  }




  // ---------- Decide final action
  // ARCH.1E-FIX.3: hard block automatic-dependency-rescheduling claims.
  // If detected, override final_action to regenerate; if already regenerated,
  // fail-closed with a dependency-specific safe fallback (not a generic one).
  const hasAutoRescheduleClaim = unsupported_claims.some((c) =>
    c.includes("dependency_claims_automatic_rescheduling"),
  );
  let final_action: "return" | "regenerate_once" | "fail_closed";
  let safe_fallback_answer: string | undefined;
  if (severity === "pass" || severity === "warn") {
    final_action = "return";
  } else {
    const renderable =
      mode === "verified_workflow" ||
      mode === "unverified_workflow_safe_limit" ||
      mode === "kc_concept" ||
      mode === "troubleshooting" ||
      mode === "data_refusal_with_navigation" ||
      mode === "action_refusal_with_guidance" ||
      mode === "prompt_injection_refusal" ||
      mode === "out_of_scope_refusal" ||
      mode === "unsupported_workflow" ||
      mode === "insufficient_knowledge";
    if (renderable && !input.alreadyRegenerated) {
      final_action = "regenerate_once";
    } else {
      final_action = "fail_closed";
      if (hasAutoRescheduleClaim) {
        safe_fallback_answer =
          "Dependencies in BTPM should be treated as sequencing guidance and impact visibility. " +
          "Do not assume dependent task dates move automatically unless BTPM explicitly confirms that behavior. " +
          "If a predecessor slips, review the dependent task and update the current plan or task dates as needed.";
      } else {
        safe_fallback_answer = pickFailClosedFallback({ mode });
      }
    }
  }

  return {
    ok: severity !== "fail",
    severity,
    violations,
    unsupported_claims,
    speculative_ui_claims,
    operational_data_claims,
    action_completion_claims,
    internal_leakage_claims,
    source_mismatch_claims,
    final_action,
    safe_fallback_answer,
    diagnostics: {
      warnings,
      step_count: stepCount,
      already_regenerated: !!input.alreadyRegenerated,
      mode,
      workflow_id: routingResult.workflow_id,
      // QA.1: split signal so admin UI can show real safety failures
      // separately from quality warnings (e.g. source-list cosmetic noise).
      safety_violations: {
        action_completion_claims,
        operational_data_claims,
        internal_leakage_claims,
        speculative_ui_claims,
        unsupported_claims,
      },
      quality_warnings: {
        source_mismatch_claims,
        violations,
        warnings,
      },
    },
  };
}

// Public helper so callers can ask for the deterministic fallback directly.
export function guideV2SafeFallbackAnswer(mode: GuideV2AnswerMode): string {
  return safeFallbackFor(mode);
}

// Backwards-compatible wrapper for earlier callers (e.g. the V2.5 skeleton).
export function validateRenderedAnswer(args: {
  plan: GuideV2AnswerPlan;
  rendered: string;
}): GuideV2ValidationResult {
  // Build a minimal stand-in routing result.
  const synthRouting: GuideV2RoutingResult = {
    answer_mode: args.plan.answer_mode,
    workflow_id: null,
    workflow_status: null,
    matched_workflow: null,
    route_reason: "compat-shim",
    can_generate_procedural_steps: args.plan.allowed_steps.length > 0,
    must_refuse_data_access: false,
    must_refuse_action_execution: false,
    requires_safe_limit: false,
    knowledge_sufficiency: "partial",
    source_confidence: "low",
    next_required_layer: "none",
  };
  return validateGuideV2Answer({
    question: "",
    classification: {
      intent_type: "unknown",
      feature_area: null,
      workflow_id: null,
      user_goal: "",
      is_user_asking_assistant_to_act: false,
      is_user_asking_for_actual_data: false,
      needs_verified_ui_steps: false,
      confidence: 0,
      clarification_needed: false,
    },
    knowledgePack: {
      primary_articles: [],
      supporting_articles: [],
      metadata_signals: {},
      route_context: { route: null, label: null },
      matched_workflow: null,
      source_confidence: "low",
      knowledge_sufficiency: "partial",
      retrieval_strategy: "fallback",
      excluded_sources: [],
    },
    routingResult: synthRouting,
    answerPlan: args.plan,
    renderedAnswer: args.rendered,
  });
}
