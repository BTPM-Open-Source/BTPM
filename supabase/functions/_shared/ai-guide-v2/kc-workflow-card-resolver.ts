// AI-GUIDE.V2.GUIDE-MODE.0.7E — KC workflow-card resolver.
//
// Selects a verified workflow from the full visible KC workflow catalog and
// parses the selected article body into GuideV2WorkflowRecord steps.
//
// Hard rules:
//   - Workflow existence comes from KC workflow metadata, not vector ranking.
//   - Workflow steps come only from the selected KC workflow-card body.
//   - No action execution. No operational data reads. No invented controls.

import type {
  GuideV2IntentClassification,
  GuideV2WorkflowRecord,
  GuideV2WorkflowStep,
} from "./types.ts";
import {
  buildCatalog,
  dispatchFromMatch,
  findCompatible,
  type KcWorkflowDoc,
  type WorkflowCatalogEntry,
  type WorkflowMetadataV1,
} from "./workflow-catalog.ts";
import { extractWorkflowFrame, type WorkflowFrame } from "./workflow-frame.ts";

export interface KcWorkflowCardArticle {
  article_id: string;
  slug: string;
  title: string;
  related_route: string | null;
  feature_area?: string | null;
  body: string | null;
  workflow_metadata?: WorkflowMetadataV1 | null;
}

export function workflowSlugFor(workflow_id: string): string {
  return `workflow-${workflow_id.replaceAll("_", "-")}`;
}

export function workflowIdFromSlug(slug: string): string | null {
  if (!slug || !slug.startsWith("workflow-")) return null;
  return slug.slice("workflow-".length).replaceAll("-", "_");
}

export function isWorkflowCardSlug(slug: string | null | undefined): boolean {
  return !!slug && slug.startsWith("workflow-");
}

interface ParsedCard {
  path: string[];
  before: string[];
  steps: GuideV2WorkflowStep[];
  expected: string[];
  not_supported: string[];
  if_missing: string[];
}

function stripMd(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/(?<!\w)\*(?!\s)/g, "")
    .replace(/(?<!\s)\*(?!\w)/g, "")
    .replace(/`/g, "")
    .trim();
}

const HEADERS: Array<[keyof ParsedCard | "where", RegExp]> = [
  ["where", /^where to go\s*:\s*/i],
  ["before", /^before you start\s*:\s*$/i],
  ["steps", /^steps\s*:\s*$/i],
  ["expected", /^expected result\s*:\s*$/i],
  ["not_supported", /^not supported in this workflow\s*:\s*$/i],
  ["if_missing", /^if something is missing or disabled\s*:\s*$/i],
];

function parseCard(body: string): ParsedCard | null {
  const lines = body.split(/\r?\n/);
  const buf: Record<string, string[]> = {};
  let current = "";
  for (const raw of lines) {
    const line = raw.trimEnd();
    let matched = false;
    for (const [key, re] of HEADERS) {
      if (re.test(line.trim())) {
        current = key as string;
        buf[current] = buf[current] ?? [];
        if (key === "where") {
          const rest = line.replace(/^where to go\s*:\s*/i, "").trim();
          if (rest) buf[current].push(rest);
        }
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (!current) continue;
    if (!line.trim()) continue;
    buf[current].push(line);
  }

  let path: string[] = [];
  if (buf.where && buf.where.length > 0) {
    const joined = stripMd(buf.where.join(" "));
    path = joined.split(/\s*(?:→|->|\u2192)\s*/).map((s) => s.trim()).filter(Boolean);
  }

  const steps: GuideV2WorkflowStep[] = [];
  for (const ln of buf.steps ?? []) {
    const m = ln.match(/^\s*(\d+)\.\s+(.*)$/);
    if (!m) continue;
    const order = Number(m[1]);
    const raw = m[2];
    const ctlMatch = raw.match(/\*\*([^*]+)\*\*/);
    const instruction = stripMd(raw);
    if (!instruction) continue;
    steps.push({
      order,
      instruction,
      ui_control: ctlMatch ? ctlMatch[1].trim() : undefined,
    });
  }

  const bullets = (key: string): string[] => {
    return (buf[key] ?? [])
      .map((ln) => ln.replace(/^\s*[-*+]\s+/, "").trim())
      .filter(Boolean)
      .map(stripMd);
  };

  return {
    path,
    before: bullets("before"),
    steps,
    expected: bullets("expected"),
    not_supported: bullets("not_supported"),
    if_missing: bullets("if_missing"),
  };
}

const PERMISSION_KEYWORDS = /(permission|role|authority|workspace|access|admin)/i;

export interface ResolveKcWorkflowInput {
  classification: GuideV2IntentClassification;
  candidates: KcWorkflowCardArticle[];
  canonicalObjects?: string[];
  userGoal?: string | null;
  question?: string | null;
  contextRoute?: string | null;
  contextLabel?: string | null;
}

export interface WorkflowSelectionResult {
  selected: KcWorkflowCardArticle | null;
  selected_entry: WorkflowCatalogEntry | null;
  dispatch_kind: "verified_workflow" | "unsupported_safe_guidance" | "action_refusal" | "clarification_needed" | "no_candidates";
  semantic_frame: WorkflowFrame | null;
  rejected_candidates: Array<{ slug: string; reason: string }>;
  catalog_total: number;
  catalog_metadata_ready_count: number;
  catalog_metadata_missing_slugs: string[];
  alternatives: WorkflowCatalogEntry[];
  same_family_matches: WorkflowCatalogEntry[];
}

export interface ResolveKcWorkflowResult {
  matched: GuideV2WorkflowRecord | null;
  object_mismatch_detected: boolean;
  modifier_mismatch_detected: boolean;
  requested_modifier: string;
  rejected_candidates: Array<{
    slug: string;
    title: string;
    candidate_family: string;
    candidate_modifier: string;
    requested_families: string[];
    requested_modifier: string;
    reason: string;
  }>;
  requested_families: string[];
  selection: WorkflowSelectionResult;
}

function docsFromCandidates(candidates: KcWorkflowCardArticle[]): KcWorkflowDoc[] {
  return candidates.map((c) => ({
    article_id: c.article_id,
    slug: c.slug,
    title: c.title,
    related_route: c.related_route,
    feature_area: c.feature_area ?? null,
    body: c.body,
    workflow_metadata: c.workflow_metadata ?? null,
  }));
}

function titleFor(candidates: KcWorkflowCardArticle[], slug: string): string {
  return candidates.find((c) => c.slug === slug)?.title ?? slug;
}

function requestedFamiliesFromFrame(frame: WorkflowFrame | null): string[] {
  return frame && frame.object_family !== "unknown" ? [frame.object_family] : [];
}

export function selectKcWorkflowCardDetailed(input: ResolveKcWorkflowInput): WorkflowSelectionResult {
  const candidates = input.candidates.filter((c) => isWorkflowCardSlug(c.slug));
  if (candidates.length === 0) {
    return {
      selected: null,
      selected_entry: null,
      dispatch_kind: "no_candidates",
      semantic_frame: null,
      rejected_candidates: [],
      catalog_total: 0,
      catalog_metadata_ready_count: 0,
      catalog_metadata_missing_slugs: [],
      alternatives: [],
      same_family_matches: [],
    };
  }

  const frame = extractWorkflowFrame(input.question ?? input.userGoal ?? input.classification.user_goal ?? "", {
    route: input.contextRoute ?? null,
    routeLabel: input.contextLabel ?? null,
  });
  const catalog = buildCatalog(docsFromCandidates(candidates));
  const match = findCompatible(frame, catalog);
  const dispatch = dispatchFromMatch(frame, match);

  // Dedupe by slug: the catalog can produce multiple rows per slug (one per
  // metadata frame), and downstream consumers want a unique workflow list.
  const sameFamilyRaw = frame.object_family !== "unknown"
    ? match.supported_matches.filter((c) => c.object_family === frame.object_family)
    : [];
  const sameFamily: typeof sameFamilyRaw = [];
  const seenSameFamily = new Set<string>();
  for (const c of sameFamilyRaw) {
    if (seenSameFamily.has(c.workflow_slug)) continue;
    seenSameFamily.add(c.workflow_slug);
    sameFamily.push(c);
  }


  if (dispatch.kind === "verified_workflow") {
    const selected = candidates.find((c) => c.slug === dispatch.entry.workflow_slug) ?? null;
    return {
      selected,
      selected_entry: dispatch.entry,
      dispatch_kind: "verified_workflow",
      semantic_frame: frame,
      rejected_candidates: match.rejected,
      catalog_total: catalog.length,
      catalog_metadata_ready_count: match.gate_diagnostics.metadata_ready_count,
      catalog_metadata_missing_slugs: match.gate_diagnostics.metadata_missing_slugs,
      alternatives: dispatch.alternatives,
      same_family_matches: sameFamily,
    };
  }

  // 0.7H: classification.workflow_id salvage. If the LLM classifier already
  // identified a concrete known workflow_id and that workflow exists in the
  // visible catalog as supported, prefer it over an "unsupported safe
  // guidance" or "clarification_needed" verdict caused by a weak semantic
  // frame. Never overrides action refusals or perform_action_request intent.
  const classifiedWorkflowId = input.classification.workflow_id;
  if (
    classifiedWorkflowId &&
    frame.intent_type !== "perform_action_request" &&
    (dispatch.kind === "unsupported_safe_guidance" || dispatch.kind === "clarification_needed")
  ) {
    const classifiedSlug = workflowSlugFor(classifiedWorkflowId);
    const catalogEntry = catalog.find((c) => c.workflow_slug === classifiedSlug && c.supported);
    const candidateCard = candidates.find((c) => c.slug === classifiedSlug);
    if (catalogEntry && candidateCard) {
      return {
        selected: candidateCard,
        selected_entry: catalogEntry,
        dispatch_kind: "verified_workflow",
        semantic_frame: frame,
        rejected_candidates: match.rejected,
        catalog_total: catalog.length,
        catalog_metadata_ready_count: match.gate_diagnostics.metadata_ready_count,
        catalog_metadata_missing_slugs: match.gate_diagnostics.metadata_missing_slugs,
        alternatives: [],
        same_family_matches: sameFamily,
      };
    }
  }

  return {
    selected: null,
    selected_entry: null,
    dispatch_kind: dispatch.kind,
    semantic_frame: frame,
    rejected_candidates: match.rejected,
    catalog_total: catalog.length,
    catalog_metadata_ready_count: match.gate_diagnostics.metadata_ready_count,
    catalog_metadata_missing_slugs: match.gate_diagnostics.metadata_missing_slugs,
    alternatives: [],
    same_family_matches: sameFamily,
  };
}

export function buildKcWorkflowRecordFromCard(args: {
  classification: GuideV2IntentClassification;
  candidate: KcWorkflowCardArticle;
  selected_entry?: WorkflowCatalogEntry | null;
}): GuideV2WorkflowRecord | null {
  const { classification, candidate, selected_entry } = args;
  if (!candidate.body) return null;
  const parsed = parseCard(candidate.body);
  if (!parsed || parsed.steps.length === 0) return null;

  const workflow_id =
    selected_entry?.workflow_id ||
    candidate.workflow_metadata?.workflow_id ||
    workflowIdFromSlug(candidate.slug) ||
    classification.workflow_id ||
    "knowledge_center_workflow";

  const feature_area =
    classification.feature_area ||
    candidate.feature_area ||
    selected_entry?.object_family ||
    workflowIdFromSlug(candidate.slug)?.split("_")[0] ||
    "knowledge_center_workflow";

  const permission_notes = parsed.before.filter((b) => PERMISSION_KEYWORDS.test(b));
  const if_missing_control = parsed.if_missing.length > 0
    ? parsed.if_missing.join(" ")
    : "If the expected control is missing, check your workspace/project access or ask an admin.";

  return {
    workflow_id,
    title: candidate.title,
    feature_area,
    status: "verified",
    route_patterns: selected_entry?.route ? [selected_entry.route] : (candidate.related_route ? [candidate.related_route] : []),
    path: parsed.path,
    steps: parsed.steps,
    not_supported: parsed.not_supported,
    permission_notes,
    if_missing_control,
    next_suggestions: [],
    source_articles: [candidate.slug],
    verification_source: "knowledge_center_workflow_metadata_card",
    last_verified_step: "KC workflow metadata v1",
  };
}

export function resolveKcWorkflowCardDetailed(input: ResolveKcWorkflowInput): ResolveKcWorkflowResult {
  const selection = selectKcWorkflowCardDetailed(input);
  const matched = selection.selected
    ? buildKcWorkflowRecordFromCard({
        classification: input.classification,
        candidate: selection.selected,
        selected_entry: selection.selected_entry,
      })
    : null;
  const rejected = selection.rejected_candidates.map((r) => ({
    slug: r.slug,
    title: titleFor(input.candidates, r.slug),
    candidate_family: String(r.reason.match(/^object_family:([^!]+)/)?.[1] ?? "unknown"),
    candidate_modifier: String(r.reason.match(/^modifier:([^!]+)/)?.[1] ?? "none"),
    requested_families: requestedFamiliesFromFrame(selection.semantic_frame),
    requested_modifier: selection.semantic_frame?.modifier ?? "none",
    reason: r.reason,
  }));

  return {
    matched,
    object_mismatch_detected: selection.rejected_candidates.some((r) => r.reason.startsWith("object_family:")),
    modifier_mismatch_detected: selection.rejected_candidates.some((r) => r.reason.startsWith("modifier:")),
    requested_modifier: selection.semantic_frame?.modifier ?? "none",
    rejected_candidates: rejected,
    requested_families: requestedFamiliesFromFrame(selection.semantic_frame),
    selection,
  };
}

export function resolveKcWorkflowCard(input: ResolveKcWorkflowInput): GuideV2WorkflowRecord | null {
  return resolveKcWorkflowCardDetailed(input).matched;
}
