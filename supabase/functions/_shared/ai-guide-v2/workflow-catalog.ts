// AI-GUIDE.V2.GUIDE-MODE.0.7F — KC workflow catalog with deterministic scoring.
//
// Builds a workflow catalog from visibility-resolved KC `workflow-*` articles
// and selects the best semantically compatible candidate via deterministic
// scoring. Helper / view-surface workflows (workflow-use-*) require explicit
// helper wording before they can win.
//
// Hard rules:
//   - Pure / deterministic. No I/O, no LLM.
//   - Vector ranking must not admit semantically incompatible workflows.
//   - Workflow steps remain in KC article bodies, not duplicated here.

import type {
  WorkflowAction,
  WorkflowFrame,
  WorkflowModifier,
  WorkflowObjectFamily,
  WorkflowScope,
  WorkflowSourceObject,
  WorkflowTargetObject,
} from "./workflow-frame.ts";

export interface WorkflowCatalogEntry {
  workflow_slug: string;
  workflow_id: string;
  object_family: WorkflowObjectFamily;
  action: WorkflowAction;
  modifier: WorkflowModifier;
  source_object: WorkflowSourceObject;
  target_object: WorkflowTargetObject;
  scope: WorkflowScope;
  supported: boolean;
  route: string | null;
  permission_scope: string | null;
  not_supported_boundaries: string[];
  kc_doc_id: string | null;
  frame_index: number;
  metadata_source: "workflow_metadata" | "slug_inference";
  selection_terms: string[];
  is_helper_view: boolean;
}

export interface WorkflowMetadataFrame {
  object_family?: WorkflowObjectFamily | string | null;
  action?: WorkflowAction | string | null;
  modifier?: WorkflowModifier | string | null;
  source_object?: WorkflowSourceObject | string | null;
  target_object?: WorkflowTargetObject | string | null;
  scope?: WorkflowScope | string | null;
}

export interface WorkflowMetadataV1 extends WorkflowMetadataFrame {
  version?: string | null;
  workflow_id?: string | null;
  supported?: boolean | null;
  route?: string | null;
  permission_scope?: string | null;
  not_supported_boundaries?: string[] | null;
  selection_terms?: string[] | null;
  reject_when?: string[] | null;
  helper_workflow?: boolean | null;
  selection_terms_required?: boolean | null;
  frames?: WorkflowMetadataFrame[] | null;
}

export interface KcWorkflowDoc {
  article_id?: string;
  slug: string;
  title?: string | null;
  related_route?: string | null;
  feature_area?: string | null;
  body?: string | null;
  workflow_metadata?: WorkflowMetadataV1 | null;
}

// Helper/view workflow slugs — these must NOT win unless the question
// explicitly mentions the corresponding view surface.
export const HELPER_VIEW_SLUGS = new Set<string>([
  "workflow-use-project-calendar",
  "workflow-use-project-gantt",
  "workflow-use-roadmap",
  "workflow-use-my-work",
  "workflow-use-files-module",
  "workflow-use-knowledge-center",
  "workflow-use-agile-board",
]);

const HELPER_TERM_PATTERNS: Record<string, RegExp> = {
  "workflow-use-project-calendar": /\bcalendar\b/i,
  "workflow-use-project-gantt": /\bgantt\b|\btimeline\b/i,
  "workflow-use-roadmap": /\broadmap\b/i,
  "workflow-use-my-work": /\bmy\s+work\b/i,
  "workflow-use-files-module": /\bfiles?\s+module\b|\bfiles?\s+page\b/i,
  "workflow-use-knowledge-center": /\bknowledge\s+(?:center|base)\b/i,
  "workflow-use-agile-board": /\bagile\s+board\b/i,
};

// Domain-action verbs — when the user asks one of these, helper "view_or_find"
// workflows must be heavily penalized.
const DOMAIN_ACTIONS = new Set<WorkflowAction>([
  "create", "edit", "update", "complete", "reopen", "record", "define",
  "connect", "disconnect", "generate", "resolve", "capture", "save_as_template",
  "create_from_template", "configure", "invite", "send", "enable", "manage",
]);

interface SlugInferenceRule {
  slug_re: RegExp;
  object_family: WorkflowObjectFamily;
  action: WorkflowAction;
  modifier?: WorkflowModifier;
  source_object?: WorkflowSourceObject;
  target_object?: WorkflowTargetObject;
  scope?: WorkflowScope;
}

const SLUG_RULES: SlugInferenceRule[] = [
  { slug_re: /^workflow-create-project-from-template$/, object_family: "project", action: "create_from_template", modifier: "from_template", source_object: "project_template", target_object: "project", scope: "workspace_level" },
  { slug_re: /^workflow-save-project-as-template$/, object_family: "project", action: "save_as_template", modifier: "as_template", source_object: "project", target_object: "project_template", scope: "project_level" },
  { slug_re: /^workflow-create-blank-project$/, object_family: "project", action: "create", target_object: "project", scope: "workspace_level" },
  { slug_re: /^workflow-edit-project-overview$/, object_family: "project", action: "edit", target_object: "project", scope: "project_level" },
  { slug_re: /^workflow-create-program$/, object_family: "program", action: "create", target_object: "program", scope: "workspace_level" },

  { slug_re: /^workflow-add-phase$/, object_family: "phase", action: "create", target_object: "phase", scope: "project_level" },
  { slug_re: /^workflow-edit-phase-plan$/, object_family: "phase", action: "edit", target_object: "phase", scope: "phase_level" },
  { slug_re: /^workflow-complete-phase$/, object_family: "phase", action: "complete", target_object: "phase", scope: "phase_level" },
  { slug_re: /^workflow-add-task-to-phase$/, object_family: "task", action: "create", target_object: "task", scope: "phase_level" },
  { slug_re: /^workflow-edit-task-plan$/, object_family: "task", action: "edit", target_object: "task", scope: "task_level" },
  { slug_re: /^workflow-complete-task$/, object_family: "task", action: "complete", target_object: "task", scope: "task_level" },
  { slug_re: /^workflow-reopen-task$/, object_family: "task", action: "reopen", target_object: "task", scope: "task_level" },

  { slug_re: /^workflow-add-execution-update$/, object_family: "execution_update", action: "create", target_object: "execution_update", scope: "task_level" },
  { slug_re: /^workflow-add-comment$/, object_family: "comment", action: "create", target_object: "comment" },
  { slug_re: /^workflow-add-dependency$/, object_family: "dependency", action: "create", target_object: "dependency", scope: "task_level" },

  { slug_re: /^workflow-create-project-risk$/, object_family: "risk", action: "create", modifier: "project_level", target_object: "risk", scope: "project_level" },
  { slug_re: /^workflow-update-project-risk$/, object_family: "risk", action: "update", modifier: "project_level", target_object: "risk", scope: "project_level" },
  { slug_re: /^workflow-create-project-blocker$/, object_family: "blocker", action: "create", modifier: "project_level", target_object: "blocker", scope: "project_level" },
  { slug_re: /^workflow-update-project-blocker$/, object_family: "blocker", action: "update", modifier: "project_level", target_object: "blocker", scope: "project_level" },
  { slug_re: /^workflow-add-task-or-phase-blocker$/, object_family: "blocker", action: "create", modifier: "task_level", target_object: "blocker", scope: "task_level" },
  { slug_re: /^workflow-resolve-blocker$/, object_family: "blocker", action: "complete", target_object: "blocker" },

  { slug_re: /^workflow-define-kpi$/, object_family: "kpi", action: "define", target_object: "kpi", scope: "project_level" },
  { slug_re: /^workflow-record-kpi-update$/, object_family: "kpi", action: "update", modifier: "value_update", target_object: "kpi", scope: "project_level" },
  { slug_re: /^workflow-capture-kpi-snapshot$/, object_family: "kpi_snapshot", action: "capture", scope: "project_level" },
  { slug_re: /^workflow-kpi-app-report-now$/, object_family: "kpi_app", action: "generate" },

  { slug_re: /^workflow-create-governance-cadence$/, object_family: "governance_cadence", action: "create", modifier: "cadence_expectation", target_object: "governance_cadence", scope: "project_level" },
  { slug_re: /^workflow-record-governance-evidence$/, object_family: "governance_evidence", action: "record", modifier: "evidence_record", target_object: "governance_record", scope: "project_level" },

  { slug_re: /^workflow-connect-project-sharepoint-folder$/, object_family: "sharepoint_folder", action: "connect", target_object: "sharepoint_folder", scope: "project_level" },
  { slug_re: /^workflow-disconnect-project-sharepoint-folder$/, object_family: "sharepoint_folder", action: "disconnect", target_object: "sharepoint_folder", scope: "project_level" },
  { slug_re: /^workflow-manage-sharepoint-files$/, object_family: "file", action: "manage" },
  { slug_re: /^workflow-use-files-module$/, object_family: "file", action: "use" },

  { slug_re: /^workflow-enable-agile-mode$/, object_family: "agile", action: "enable", scope: "project_level" },
  { slug_re: /^workflow-create-sprint$/, object_family: "sprint", action: "create", target_object: "sprint", scope: "project_level" },
  { slug_re: /^workflow-create-backlog-item$/, object_family: "backlog_item", action: "create", target_object: "backlog_item", scope: "project_level" },
  { slug_re: /^workflow-assign-backlog-item-to-sprint$/, object_family: "backlog_item", action: "add_to", target_object: "sprint", scope: "project_level" },
  { slug_re: /^workflow-use-agile-board$/, object_family: "agile", action: "use", scope: "project_level" },

  { slug_re: /^workflow-add-project-team-member$/, object_family: "team_member", action: "create", scope: "project_level" },
  { slug_re: /^workflow-add-raci-assignment$/, object_family: "raci", action: "create", scope: "project_level" },
  { slug_re: /^workflow-manage-project-access$/, object_family: "workspace_access", action: "manage", scope: "project_level" },
  { slug_re: /^workflow-invite-user$/, object_family: "user_invitation", action: "invite" },
  { slug_re: /^workflow-add-workspace-access$/, object_family: "workspace_access", action: "create", scope: "workspace_level" },
  { slug_re: /^workflow-manage-workspace-members$/, object_family: "workspace_member", action: "manage", scope: "workspace_level" },
  { slug_re: /^workflow-configure-sharepoint-admin$/, object_family: "sharepoint_folder", action: "configure", scope: "workspace_level" },
  { slug_re: /^workflow-configure-power-bi-admin$/, object_family: "power_bi", action: "configure" },

  { slug_re: /^workflow-use-roadmap$/, object_family: "roadmap", action: "use" },
  { slug_re: /^workflow-use-project-gantt$/, object_family: "project", action: "view_or_find" },
  { slug_re: /^workflow-use-project-calendar$/, object_family: "project", action: "view_or_find" },
  { slug_re: /^workflow-use-my-work$/, object_family: "my_work", action: "use" },
  { slug_re: /^workflow-use-knowledge-center$/, object_family: "knowledge_center", action: "use" },

  { slug_re: /^workflow-generate-project-charter$/, object_family: "export", action: "generate", target_object: "file", scope: "project_level" },
  { slug_re: /^workflow-generate-project-status-deck$/, object_family: "export", action: "generate", target_object: "file", scope: "project_level" },
  { slug_re: /^workflow-generate-roadmap-status-deck$/, object_family: "export", action: "generate", target_object: "file", scope: "workspace_level" },
  { slug_re: /^workflow-send-object-email$/, object_family: "email", action: "send" },
];

function inferFromSlug(slug: string): SlugInferenceRule | null {
  for (const r of SLUG_RULES) if (r.slug_re.test(slug)) return r;
  return null;
}

function normString<T extends string>(value: unknown, fallback: T): T {
  return (typeof value === "string" && value.length > 0 ? value : fallback) as T;
}

function normNullableString<T extends string | null>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  return (typeof value === "string" ? value : fallback) as T;
}

function arrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

export function buildCatalog(docs: KcWorkflowDoc[]): WorkflowCatalogEntry[] {
  const out: WorkflowCatalogEntry[] = [];
  for (const d of docs) {
    if (!d.slug || !d.slug.startsWith("workflow-")) continue;
    const inferred = inferFromSlug(d.slug);
    const meta = d.workflow_metadata ?? null;
    const metaFrames = Array.isArray(meta?.frames) && meta.frames.length > 0 ? meta.frames : null;
    const frames: WorkflowMetadataFrame[] = metaFrames ?? [{
      object_family: meta?.object_family,
      action: meta?.action,
      modifier: meta?.modifier,
      source_object: meta?.source_object,
      target_object: meta?.target_object,
      scope: meta?.scope,
    }];

    const isHelper = !!meta?.helper_workflow || HELPER_VIEW_SLUGS.has(d.slug);

    frames.forEach((frame, idx) => {
      const fromMetadata = !!meta;
      out.push({
        workflow_slug: d.slug,
        workflow_id: normString(meta?.workflow_id, d.slug.replace(/^workflow-/, "").replaceAll("-", "_")),
        object_family: normString(frame.object_family, inferred?.object_family ?? "unknown"),
        action: normString(frame.action, inferred?.action ?? "unknown"),
        modifier: normString(frame.modifier, inferred?.modifier ?? "none"),
        source_object: normNullableString(frame.source_object, inferred?.source_object ?? null),
        target_object: normNullableString(frame.target_object, inferred?.target_object ?? null),
        scope: normNullableString(frame.scope, inferred?.scope ?? null),
        supported: typeof meta?.supported === "boolean" ? meta.supported : true,
        route: typeof meta?.route === "string" && meta.route.length > 0 ? meta.route : (d.related_route ?? null),
        permission_scope: typeof meta?.permission_scope === "string" ? meta.permission_scope : null,
        not_supported_boundaries: arrayOrEmpty(meta?.not_supported_boundaries),
        kc_doc_id: d.article_id ?? null,
        frame_index: idx,
        metadata_source: fromMetadata ? "workflow_metadata" : "slug_inference",
        selection_terms: arrayOrEmpty(meta?.selection_terms),
        is_helper_view: isHelper,
      });
    });
  }
  return out;
}

export interface CatalogMatchResult {
  supported_matches: WorkflowCatalogEntry[];
  unsupported_matches: WorkflowCatalogEntry[];
  rejected: Array<{ slug: string; reason: string }>;
  gate_diagnostics: {
    frame_summary: Record<string, unknown>;
    candidates_considered: number;
    metadata_ready_count: number;
    metadata_missing_slugs: string[];
  };
}

function actionEqual(a: WorkflowAction, b: WorkflowAction): boolean {
  if (a === b) return true;
  if ((a === "add_to" && b === "create") || (a === "create" && b === "add_to")) return true;
  if ((a === "view_or_find" && b === "use") || (a === "use" && b === "view_or_find")) return true;
  if ((a === "update" && b === "edit") || (a === "edit" && b === "update")) return true;
  if ((a === "define" && b === "create") || (a === "create" && b === "define")) return true;
  if ((a === "complete" && b === "resolve") || (a === "resolve" && b === "complete")) return true;
  if ((a === "record" && b === "create") || (a === "create" && b === "record")) return true;
  return false;
}

function familyEqual(a: WorkflowObjectFamily, b: WorkflowObjectFamily): boolean {
  return a === b;
}

function compatibleNullable<T extends string | null>(frameValue: T, candidateValue: T): boolean {
  if (frameValue === null) return true;
  return frameValue === candidateValue;
}

// 0.7I — Generated-artifact guardrail. Each generate-* workflow may only
// match when the user's requested artifact type is compatible. This
// prevents generic "PowerPoint report" wording from selecting Project
// Charter via alphabetical tie-breaks.
const GENERATED_ARTIFACT_SLUG_REQUIREMENTS: Record<string, "project_charter" | "project_status_deck" | "roadmap_status_deck"> = {
  "workflow-generate-project-charter": "project_charter",
  "workflow-generate-project-status-deck": "project_status_deck",
  "workflow-generate-roadmap-status-deck": "roadmap_status_deck",
};

export function findCompatible(
  frame: WorkflowFrame,
  catalog: WorkflowCatalogEntry[],
): CatalogMatchResult {
  const supported_matches: WorkflowCatalogEntry[] = [];
  const unsupported_matches: WorkflowCatalogEntry[] = [];
  const rejected: Array<{ slug: string; reason: string }> = [];

  for (const c of catalog) {
    if (frame.object_family !== "unknown" && !familyEqual(frame.object_family, c.object_family)) {
      rejected.push({ slug: c.workflow_slug, reason: `object_family:${c.object_family}!=${frame.object_family}` });
      continue;
    }
    if (frame.action !== "unknown" && !actionEqual(frame.action, c.action)) {
      rejected.push({ slug: c.workflow_slug, reason: `action:${c.action}!=${frame.action}` });
      continue;
    }
    if (frame.modifier !== "none" && c.modifier !== "none" && c.modifier !== frame.modifier) {
      rejected.push({ slug: c.workflow_slug, reason: `modifier:${c.modifier}!=${frame.modifier}` });
      continue;
    }
    if (!compatibleNullable(frame.source_object, c.source_object)) {
      rejected.push({ slug: c.workflow_slug, reason: `source_object:${c.source_object}!=${frame.source_object}` });
      continue;
    }
    if (!compatibleNullable(frame.target_object, c.target_object)) {
      rejected.push({ slug: c.workflow_slug, reason: `target_object:${c.target_object}!=${frame.target_object}` });
      continue;
    }
    if (!compatibleNullable(frame.scope, c.scope)) {
      rejected.push({ slug: c.workflow_slug, reason: `scope:${c.scope}!=${frame.scope}` });
      continue;
    }

    // 0.7I — generated-artifact guardrail.
    const requiredArtifact = GENERATED_ARTIFACT_SLUG_REQUIREMENTS[c.workflow_slug];
    if (requiredArtifact) {
      const at = frame.generated_artifact_type;
      if (at === "generic_generated_document" || at === "unknown") {
        rejected.push({ slug: c.workflow_slug, reason: `artifact_ambiguous:${at}` });
        continue;
      }
      if (at !== requiredArtifact) {
        rejected.push({ slug: c.workflow_slug, reason: `artifact:${at}!=${requiredArtifact}` });
        continue;
      }
    }

    if (c.supported) supported_matches.push(c);
    else unsupported_matches.push(c);
  }


  const metadataMissing = Array.from(new Set(
    catalog.filter((c) => c.metadata_source === "slug_inference").map((c) => c.workflow_slug),
  )).sort();
  const metadataReadyCount = new Set(
    catalog.filter((c) => c.metadata_source === "workflow_metadata").map((c) => c.workflow_slug),
  ).size;

  return {
    supported_matches,
    unsupported_matches,
    rejected,
    gate_diagnostics: {
      frame_summary: {
        intent_type: frame.intent_type,
        object_family: frame.object_family,
        action: frame.action,
        modifier: frame.modifier,
        source_object: frame.source_object,
        target_object: frame.target_object,
        scope: frame.scope,
        ambiguity_flag: frame.ambiguity_flag,
      },
      candidates_considered: catalog.length,
      metadata_ready_count: metadataReadyCount,
      metadata_missing_slugs: metadataMissing,
    },
  };
}

export interface ScoredCandidate {
  entry: WorkflowCatalogEntry;
  score: number;
  reasons: string[];
}

export function scoreCandidate(
  frame: WorkflowFrame,
  c: WorkflowCatalogEntry,
): ScoredCandidate {
  let score = 0;
  const reasons: string[] = [];
  const q = frame.question_text;

  if (frame.object_family !== "unknown" && c.object_family === frame.object_family) {
    score += 5; reasons.push("family_exact");
  }
  if (frame.action !== "unknown" && c.action === frame.action) {
    score += 4; reasons.push("action_exact");
  } else if (frame.action !== "unknown" && actionEqual(frame.action, c.action)) {
    score += 2; reasons.push("action_alias");
  }
  if (frame.modifier !== "none" && c.modifier === frame.modifier) {
    score += 3; reasons.push("modifier_exact");
  } else if (frame.modifier !== "none" && c.modifier === "none") {
    score -= 1; reasons.push("modifier_less_specific");
  }
  if (frame.target_object && c.target_object === frame.target_object) {
    score += 2; reasons.push("target_exact");
  }
  if (frame.source_object && c.source_object === frame.source_object) {
    score += 2; reasons.push("source_exact");
  }
  if (frame.scope && c.scope === frame.scope) {
    score += 2; reasons.push("scope_exact");
  } else if (frame.scope && !c.scope) {
    score -= 1; reasons.push("scope_unspecified");
  }
  // Selection terms direct hit
  for (const t of c.selection_terms) {
    if (t && new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q)) {
      score += 3; reasons.push(`selection_term:${t}`);
      break;
    }
  }

  // Helper / view-surface gating
  if (c.is_helper_view) {
    const term = HELPER_TERM_PATTERNS[c.workflow_slug];
    const helperHit = term ? term.test(q) : (frame.helper_terms_present.length > 0);
    if (helperHit) {
      score += 4; reasons.push("helper_term_hit");
    } else {
      score -= 20; reasons.push("helper_no_term_hit");
    }
  }

  // View-action vs domain-action penalty
  if ((c.action === "view_or_find" || c.action === "use") && DOMAIN_ACTIONS.has(frame.action)) {
    score -= 8; reasons.push("view_action_for_domain_verb");
  }

  // Slug word overlap with question (weak). 0.9E — generic words such as
  // "app", "workflow", "report", "now", "use", "create", "update", "project",
  // "task", "guide" must NOT push a verified candidate over the line when
  // the semantic frame is unknown/unknown. Treat them as stop words.
  const SLUG_STOP_WORDS = new Set([
    "app", "workflow", "workflows", "guide", "report", "now", "use", "using",
    "create", "update", "project", "task", "the", "and", "for", "from", "with",
    "to", "of", "as", "an", "by", "or", "is",
  ]);
  const slugWords = c.workflow_slug.replace(/^workflow-/, "").split("-");
  let slugMatches = 0;
  for (const w of slugWords) {
    if (w.length < 3) continue;
    if (SLUG_STOP_WORDS.has(w.toLowerCase())) continue;
    if (new RegExp(`\\b${w}\\b`, "i").test(q)) slugMatches += 1;
  }
  if (slugMatches > 0) {
    score += Math.min(slugMatches, 3);
    reasons.push(`slug_overlap:${slugMatches}`);
  }

  return { entry: c, score, reasons };
}

export function rankCandidates(
  frame: WorkflowFrame,
  candidates: WorkflowCatalogEntry[],
): ScoredCandidate[] {
  const scored = candidates.map((c) => scoreCandidate(frame, c));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.workflow_slug.localeCompare(b.entry.workflow_slug);
  });
  return scored;
}

export type CatalogDispatchOutcome =
  | { kind: "action_refusal" }
  | { kind: "clarification_needed"; same_family_matches: WorkflowCatalogEntry[] }
  | { kind: "verified_workflow"; entry: WorkflowCatalogEntry; alternatives: WorkflowCatalogEntry[]; score: number; ranking: ScoredCandidate[] }
  | { kind: "unsupported_safe_guidance"; nearest_unsupported: WorkflowCatalogEntry | null; adjacent_supported: WorkflowCatalogEntry[]; same_family_matches: WorkflowCatalogEntry[]; ranking: ScoredCandidate[] };

export function dispatchFromMatch(
  frame: WorkflowFrame,
  match: CatalogMatchResult,
): CatalogDispatchOutcome {
  if (frame.intent_type === "perform_action_request") return { kind: "action_refusal" };

  // Same-family supported workflows are useful for distinguishing
  // "no verified workflow exists for this object" from "ambiguous within the
  // object family" and for building clarification questions.
  const sameFamilyRaw = frame.object_family !== "unknown"
    ? match.supported_matches.filter((c) => c.object_family === frame.object_family)
    : [];
  // Dedupe by slug — the catalog stores one row per metadata frame, so a
  // single workflow can appear multiple times.
  const seenSameFamilySlugs = new Set<string>();
  const sameFamilyMatches: WorkflowCatalogEntry[] = [];
  for (const c of sameFamilyRaw) {
    if (seenSameFamilySlugs.has(c.workflow_slug)) continue;
    seenSameFamilySlugs.add(c.workflow_slug);
    sameFamilyMatches.push(c);
  }


  if (frame.intent_type === "clarification_needed") {
    return { kind: "clarification_needed", same_family_matches: sameFamilyMatches };
  }

  // 0.9E — Unknown/unknown semantic frame guard. Broad questions like
  // "guide me through the main workflows in the app" produce an unknown
  // object_family / unknown action / no target/source/modifier frame and
  // must not silently dispatch to a single verified workflow (previously
  // "app" overlap let workflow-kpi-app-report-now win). Strong workflow
  // selection requires either a known object family/action, or an explicit
  // selection_term hit on a verified card.
  const frameIsFullyUnknown =
    frame.object_family === "unknown" &&
    frame.action === "unknown" &&
    !frame.target_object &&
    !frame.source_object &&
    (frame.modifier === "none" || !frame.modifier) &&
    (!frame.generated_artifact_type || frame.generated_artifact_type === "unknown");
  if (frameIsFullyUnknown) {
    const qLower = (frame.question_text || "").toLowerCase();
    const explicitSelectionHit = match.supported_matches.find((c) =>
      c.selection_terms.some((t) =>
        t && new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(qLower),
      ),
    );
    if (!explicitSelectionHit) {
      return { kind: "clarification_needed", same_family_matches: sameFamilyMatches };
    }
  }

  const ranking = rankCandidates(frame, match.supported_matches);
  const positive = ranking.filter((s) => s.score > 0);

  if (positive.length === 0) {
    return {
      kind: "unsupported_safe_guidance",
      nearest_unsupported: match.unsupported_matches[0] ?? null,
      adjacent_supported: [],
      same_family_matches: sameFamilyMatches,
      ranking,
    };
  }

  return {
    kind: "verified_workflow",
    entry: positive[0].entry,
    alternatives: positive.slice(1).map((s) => s.entry),
    score: positive[0].score,
    ranking,
  };
}
