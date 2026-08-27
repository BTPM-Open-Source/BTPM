// AI-GUIDE.V2-STABILIZE.1 — Pipeline invariant validator.
//
// Deterministic contract-test layer that runs AFTER the normal validator and
// BEFORE the final response is returned in V2 diagnostic / admin flows.
//
// This layer enforces architecture invariants that cannot be guaranteed by
// any single layer (classifier, diagnosis, KP, router, planner, renderer,
// validator) on its own — for example, "if arbitration overrides intent, the
// final answer cannot still expose the original poisoned intent" or
// "task-planning answers must never present Roadmap as the closest BTPM area
// for task creation/location".
//
// Hard rules:
//  - Deterministic only. No LLM calls. No I/O.
//  - No final-answer prose constants except short, generic, situation-typed
//    safe fallbacks used ONLY when an invariant hard-blocks the unsafe final
//    answer.
//  - No exact HR question→answer mappings.
//  - No broad renderer regex returning canned prose for normal flow.
//  - Never reveals raw chunks, embeddings, prompts, secrets, or provider
//    bodies.

import type {
  GuideV2AnswerPlan,
  GuideV2DomainDiagnosis,
  GuideV2IntentClassification,
  GuideV2KnowledgePack,
  GuideV2ValidationResult,
} from "./types.ts";
import type { GuideV2RoutingResult } from "./router.ts";
import type {
  GuideV2EffectivePipelineState,
  GuideV2IntentArbitrationResult,
} from "./intent-arbitration.ts";
import type { GuideV2EffectiveDecision } from "./effective-decision.ts";

export type GuideV2InvariantRecovery =
  | "none"
  | "regenerate_once"
  | "deterministic_fallback"
  | "knowledge_pack_salvage_required";

export interface GuideV2PipelineInvariantResult {
  ok: boolean;
  severity: "pass" | "warn" | "fail";
  invariant_failures: string[];
  invariant_warnings: string[];
  hard_block_final_return: boolean;
  applied_recovery: GuideV2InvariantRecovery;
  final_answer_allowed: boolean;
  replacement_answer: string | null;
  /** STABILIZE.2: a useful deterministic safe answer was produced; fail_closed should be false. */
  repaired_by_invariant: boolean;
  diagnostics: Record<string, unknown>;
}

export interface ValidateGuideV2PipelineInvariantsInput {
  question: string;
  initialClassification: GuideV2IntentClassification;
  originalDiagnosis: GuideV2DomainDiagnosis | null;
  arbitration: GuideV2IntentArbitrationResult | null;
  reconciledState: GuideV2EffectivePipelineState | null;
  /** STABILIZE.2: canonical effective decision (authoritative). */
  effectiveDecision?: GuideV2EffectiveDecision | null;
  effectivePack: GuideV2KnowledgePack | null;
  routingResult: GuideV2RoutingResult | null;
  answerPlan: GuideV2AnswerPlan | null;
  renderedAnswer: string;
  validation: GuideV2ValidationResult | null;
  finalAnswer: string;
}

// ---------------------------------------------------------------------------
// Pattern banks (deterministic; situation-typed; NOT HR-question-typed)
// ---------------------------------------------------------------------------

const TASK_PLANNING_SITUATIONS = new Set<string>([
  "phase_task_planning",
  "task_planning_guidance",
  "work_structure_modelling_guidance",
  "add_task_to_phase",
]);

const SPECIFIC_SALVAGE_SITUATIONS = new Set<string>([
  "blocked_work",
  "baseline_change",
  "governance_sharepoint_evidence_boundary",
  "progress_or_contribution_reporting",
  "comment_or_execution_update_guidance",
  "dependency_sequencing",
  "task_planning_guidance",
  "phase_task_planning",
  "work_structure_modelling_guidance",
  "status_or_health_update",
  "kpi_project_health_mixed_guidance",
]);

// "Roadmap is the closest / primary area for tasks" patterns. Roadmap may
// still be mentioned as a visibility/timeline view — only flag wording that
// elevates it as the *closest* / *primary* / *where tasks live* area.
const ROADMAP_AS_CLOSEST_PATTERNS: RegExp[] = [
  /\bclosest\s+btpm\s+area\s+(?:is|would be)\s+(?:the\s+)?roadmap\b/i,
  /\broadmap\s+is\s+the\s+closest\s+(?:btpm\s+)?area\b/i,
  /\bclosest\s+area\s+(?:for\s+(?:adding|finding|creating|maintaining|managing)\s+tasks?\s+)?(?:is|would be)\s+(?:the\s+)?roadmap\b/i,
  /\buse\s+(?:the\s+)?roadmap\s+to\s+(?:add|create|maintain|manage|find|locate)\s+(?:a\s+)?tasks?\b/i,
  /\broadmap\s+is\s+where\s+(?:the\s+)?tasks?\s+(?:live|are\s+(?:created|added|maintained))\b/i,
  /\btasks?\s+live\s+(?:on|in)\s+(?:the\s+)?roadmap\b/i,
  /\bgo\s+to\s+(?:the\s+)?roadmap\s+to\s+(?:add|create|maintain)\s+tasks?\b/i,
];

// Automatic dependency rescheduling implications (unsafe). Includes the
// negated form "will not automatically move unless dependency is set" which
// still implies automatic movement when a dependency exists.
const AUTO_DEPENDENCY_MOVE_PATTERNS: RegExp[] = [
  /\bwill\s+(?:not\s+)?move\s+automatically\b/i,
  /\bwill\s+(?:not\s+)?automatically\s+(?:move|shift|reschedul\w*|adjust|update|push)\b/i,
  /\bautomatically\s+(?:move[sd]?|shift(?:s|ed)?|reschedul\w*|adjust(?:s|ed)?|update[sd]?|push(?:es|ed)?)\b/i,
  /\b(?:successor|dependent\s+task|downstream\s+task|next\s+task|task\s*\d+)\s+(?:will|is|are|gets|automatically)\s+(?:auto[- ]?)?(?:move[sd]?|shift\w*|reschedul\w*|update[sd]?|push\w*)\b/i,
  /\bdates?\s+(?:will|automatically)\s+(?:shift|move|update|reschedule)\b/i,
  /\bdependenc(?:y|ies)\s+(?:will|automatically)\s+(?:move|shift|reschedule|update)\b/i,
  /\bauto[- ]?(?:move|shift|reschedul\w*|adjust|update|push)\b/i,
  // negated-but-still-implies forms
  /\bwill\s+not\s+(?:automatically\s+)?move\s+(?:unless|until)\s+(?:a\s+)?dependency\b/i,
  /\bunless\s+(?:a\s+)?dependency\s+is\s+set[^.]{0,80}\b(?:move|shift|reschedul|adjust)\b/i,
];

const GENERIC_INSUFFICIENT_FALLBACK_PATTERNS: RegExp[] = [
  /\bi\s+do\s+not\s+have\s+enough\s+verified\s+btpm\s+guidance\b/i,
  /\bi\s+don['’]t\s+have\s+enough\s+verified\s+btpm\s+guidance\b/i,
  /\bnot\s+enough\s+verified\s+btpm\s+guidance\s+to\s+answer\b/i,
  /\bi\s+can\s+only\s+answer\s+using\s+approved\s+btpm\s+guidance\b/i,
  /\bi\s+can\s+help\s+with\s+btpm\s+questions\s+only\b/i,
];

const DATA_REFUSAL_PATTERNS: RegExp[] = [
  /\bi\s+cannot\s+read\s+live\s+btpm\s+data\b/i,
  /\bi\s+can(?:not|['’]t)\s+(?:read|access|fetch|retrieve|inspect)\s+(?:your|the|live|actual)\s+(?:project|kpi|task|blocker|data)\b/i,
];

const ACTION_REFUSAL_PATTERNS: RegExp[] = [
  /\bi\s+cannot\s+perform\s+this\s+action\b/i,
  /\bi\s+can(?:not|['’]t)\s+(?:create|update|delete|submit|sync|send|invite|grant|upload|approve|change|set|save|generate|publish|run)\b/i,
  /\bi\s+am\s+unable\s+to\s+(?:perform|do|run|execute|create|update|delete|submit|invite|generate|change)\b/i,
];

// Markers re-used from arbitration banks (kept local to avoid coupling).
const ACTION_MARKERS_RE =
  /\b(?:do|create|update|delete|submit|sync|send|invite|grant|upload|approve|change|set|save|generate|publish|run)\s+(?:.+?)\s+(?:for me|for us|now|please)\b/i;
const LIVE_DATA_MARKERS_RE =
  /\b(?:list|show me|give me|fetch|retrieve)\s+(?:all\s+)?(?:current|open|actual|live|my)\b|\bblockers\s+(?:are\s+)?(?:open|currently)\s+(?:in|on|for)\s+(?:my|the)\b|\bopen\s+blockers\s+right\s+now\b/i;
const PROMPT_INJECTION_RE =
  /\bignore (?:the )?(?:knowledge|system|prior|previous) (?:instructions|prompts?)\b|\bsystem prompt\b|\bdeveloper message\b|\bhidden instruction\b/i;
const SECRET_REQUEST_RE =
  /\b(service[\s_-]?role|api[\s_-]?key|secret|raw\s+(?:chunk|embedding)s?|pgvector|vector\s+database)\b/i;
const KPI_HEALTH_MIXED_RE =
  /\b(on track|green|on schedule|going well|progressing)\b.*\bkpi\b|\bkpi\b.*\b(bad|red|low|underperforming|not moving|behind|lagging)\b/i;
const GOVERNANCE_SHAREPOINT_RE =
  /\b(sharepoint|minutes|steerco|steering committee|governance)\b/i;

// 0.7H: Generated-document / SharePoint output source-of-truth detection.
// Used to (a) suppress the auto-dependency-move and dependency fallback when
// the question is actually about generated documents / external file edits,
// and (b) inject the source-of-truth fallback when invariants need to repair.
const GENERATED_DOC_OBJECT_RE =
  /\b(?:power\s*point|powerpoint|\bppt\b|status\s+deck|project\s+deck|roadmap\s+(?:status\s+)?deck|deck|presentation|status\s+report|charter|generated\s+(?:document|deck|report|file)|exported\s+(?:report|deck|file)|sharepoint\s+(?:file|document|deck|presentation|powerpoint|ppt))\b/i;
const SOURCE_OF_TRUTH_INTENT_RE =
  /\b(?:update\s+btpm|update(?:s|d)?\s+(?:the\s+)?project|change\s+(?:the\s+)?project|sync\s+(?:back\s+)?(?:to\s+)?btpm|reflect\s+in\s+btpm|source\s+of\s+truth|two[-\s]way\s+sync|update\s+(?:btpm\s+)?automatically|propagat\w+\s+(?:back\s+)?(?:to\s+)?btpm)\b/i;
const SHAREPOINT_GENERATED_SITUATIONS = new Set<string>([
  "sharepoint_boundary",
  "generated_document_boundary",
  "generated_document_source_of_truth_boundary",
]);
const DEPENDENCY_WORD_IN_QUESTION_RE =
  /\b(?:dependenc(?:y|ies)|predecessor|successor|depend(?:s|ent)?\s+on|sequenc\w+|critical\s+path)\b/i;

// ---------------------------------------------------------------------------
// Deterministic safe replacement answers per invariant type.
// Generic, situation-typed; NOT HR-question-typed.
// ---------------------------------------------------------------------------

function fallbackTaskPlanning(): string {
  return (
    "To add or find tasks in BTPM, the primary area is the project's Project Planning page; once a task exists, the Task detail page is where it is maintained. " +
    "Roadmap and Gantt are visibility/timeline views — they are not where you create or maintain the task structure. " +
    "My Work is a personal assigned-work view, not the project's task source-of-truth."
  );
}

function fallbackDependencyAutoMove(): string {
  return (
    "Dependencies in BTPM should be treated as sequencing guidance and impact visibility. " +
    "Do not assume dependent task dates move automatically unless BTPM explicitly confirms that behavior. " +
    "If a predecessor slips, review the dependent task and update the current plan or task dates as needed."
  );
}

function fallbackKpiHealthMixed(): string {
  return (
    "Project execution status and KPI performance are related but not identical in BTPM. " +
    "KPIs can lag the work — a project can be on track while a KPI has not moved yet, and vice versa. " +
    "Update KPIs only when the measured value changes; record execution updates when work progresses."
  );
}

function fallbackGovernanceSharepoint(): string {
  return (
    "BTPM is the source of truth for governance records, decisions, owners, and evidence links. " +
    "SharePoint can store the underlying files (for example meeting minutes), but BTPM does not read SharePoint file content. " +
    "Record the governance event in BTPM and link to the SharePoint file or evidence where traceability is needed."
  );
}

// 0.7H: source-of-truth fallback for generated documents / SharePoint output
// edits. Used when the question asks whether editing a generated PowerPoint,
// SharePoint file, exported deck, or other generated document updates BTPM.
function fallbackGeneratedDocSourceOfTruth(): string {
  return (
    "BTPM remains the source of truth for project data. " +
    "Editing a generated PowerPoint, exported deck, SharePoint file, or other exported report does not update BTPM records — the generated file is an output, not a two-way sync surface. " +
    "To change project information, update the relevant BTPM fields (project, phase, task, KPI, governance, etc.) in the app. " +
    "If the external file should reflect the new BTPM data, regenerate or re-export the document after updating BTPM."
  );
}

function fallbackSpecificSituation(situation: string): string {
  switch (situation) {
    case "blocked_work":
    case "predecessor_or_dependency_blocked_work":
      return (
        "In BTPM, an active obstacle that is already stopping work is a blocker on the relevant task or project; a future concern that has not yet stopped work is a risk. " +
        "Record the blocker on the BTPM record with an owner and the next action so progress and ownership are visible."
      );
    case "baseline_change":
      return (
        "BTPM separates the approved baseline (the agreed plan) from the current plan (what is actually happening). " +
        "After a plan change, update the current plan or task dates in BTPM; do not silently edit the approved baseline in place."
      );
    case "governance_sharepoint_evidence_boundary":
      return fallbackGovernanceSharepoint();
    case "progress_or_contribution_reporting":
      return (
        "In BTPM, progress and contributions are reported as dated execution updates on the task or phase. " +
        "Comments are for discussion and context; execution updates are for progress, history, and status."
      );
    case "comment_or_execution_update_guidance":
      return (
        "Use a dated execution update for progress, history, and status; use a comment for discussion and context. " +
        "Both belong on the relevant BTPM record (task, phase, or project area) — not on the Roadmap."
      );
    case "dependency_sequencing":
      return fallbackDependencyAutoMove();
    case "task_planning_guidance":
    case "phase_task_planning":
    case "work_structure_modelling_guidance":
      return fallbackTaskPlanning();
    case "status_or_health_update":
      return (
        "BTPM separates project status (the project's lifecycle position) from health (a current judgment such as on-track / at risk / off-track). " +
        "Status changes follow lifecycle transitions; health is updated via the project's status update so the change is visible to stakeholders."
      );
    case "kpi_project_health_mixed_guidance":
      return fallbackKpiHealthMixed();
    case "sharepoint_boundary":
    case "generated_document_boundary":
    case "generated_document_source_of_truth_boundary":
      return fallbackGeneratedDocSourceOfTruth();
    default:
      return (
        "BTPM has related Knowledge Center guidance for this topic. " +
        "Open the Knowledge Center article that matches the area you are working in (project, phase, task, KPI, governance, or reporting) for the verified explanation."
      );
  }
}

// ---------------------------------------------------------------------------
// Main invariant validator
// ---------------------------------------------------------------------------

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function validateGuideV2PipelineInvariants(
  input: ValidateGuideV2PipelineInvariantsInput,
): GuideV2PipelineInvariantResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const diagnostics: Record<string, unknown> = {};

  const q = input.question || "";
  const arbitration = input.arbitration;
  const reconciled = input.reconciledState;
  const routing = input.routingResult;
  const plan = input.answerPlan;
  const effective = input.effectivePack;
  const finalAnswer = (input.finalAnswer || input.renderedAnswer || "").trim();
  const finalLc = finalAnswer.toLowerCase();
  const decision = input.effectiveDecision ?? null;

  // STABILIZE.2: prefer canonical effective decision; fall back to reconciled
  // state for backward compatibility.
  const effectiveIntent =
    decision?.effective_intent_type ??
    reconciled?.effective_classification?.intent_type ??
    input.initialClassification.intent_type;
  const effectiveSituation =
    decision?.effective_domain_situation ??
    reconciled?.effective_domain_diagnosis?.domain_situation ??
    input.originalDiagnosis?.domain_situation ??
    "unknown";
  const effectiveRecommendedSlugs =
    decision?.recommended_kc_slugs ??
    reconciled?.effective_domain_diagnosis?.recommended_kc_slugs ?? [];
  const usedOverride = !!(arbitration && arbitration.should_override_initial_intent);

  diagnostics.effective_intent_type = effectiveIntent;
  diagnostics.effective_domain_situation = effectiveSituation;
  diagnostics.used_arbitration_override = usedOverride;
  diagnostics.decision_source = decision?.decision_source ?? null;
  diagnostics.decision_reason = decision?.decision_reason ?? null;

  let suggestedRecovery: GuideV2InvariantRecovery = "none";
  let replacementAnswer: string | null = null;

  // 0.7H: Pre-compute generated-document / source-of-truth signal once so
  // downstream invariants can guard themselves against firing dependency or
  // other unrelated fallbacks on PowerPoint/SharePoint/charter questions.
  //
  // 0.7J — Narrowed: source-of-truth fallback must require an actual
  // source-of-truth / sync / two-way-update intent in the question itself.
  // A generated-document situation alone is NOT enough — "How do I generate
  // a PowerPoint?" is workflow guidance, not a source-of-truth boundary
  // question, and must not be repaired by the SoT fallback.
  const questionMentionsGeneratedDoc = GENERATED_DOC_OBJECT_RE.test(q);
  const questionAsksSourceOfTruth = SOURCE_OF_TRUTH_INTENT_RE.test(q);
  const questionMentionsDependency = DEPENDENCY_WORD_IN_QUESTION_RE.test(q);
  const isGeneratedDocSituation = SHAREPOINT_GENERATED_SITUATIONS.has(effectiveSituation);
  const isGeneratedDocSourceOfTruthQuery =
    questionAsksSourceOfTruth &&
    (questionMentionsGeneratedDoc || isGeneratedDocSituation);
  diagnostics.generated_doc_source_of_truth_query = isGeneratedDocSourceOfTruthQuery;
  diagnostics.source_of_truth_trigger_terms = {
    question_mentions_generated_doc: questionMentionsGeneratedDoc,
    question_asks_source_of_truth: questionAsksSourceOfTruth,
    is_generated_doc_situation: isGeneratedDocSituation,
  };
  diagnostics.question_mentions_dependency = questionMentionsDependency;

  // 0.7J — Verified-workflow no-downgrade guard. When the router selected a
  // verified workflow (catalog dispatch picked a concrete workflow card and
  // produced steps), invariant repair must NOT replace the answer unless a
  // hard safety violation is detected (live-data, action, prompt-injection,
  // secret request). This protects workflow-generate-project-charter,
  // workflow-generate-project-status-deck and
  // workflow-generate-roadmap-status-deck from being downgraded by the
  // generated-document source-of-truth or specific-situation salvage
  // invariants. Safety invariants below are still allowed to fire.
  const verifiedWorkflowProtected =
    (routing?.answer_mode ?? null) === "verified_workflow" &&
    !!routing?.matched_workflow;
  diagnostics.verified_workflow_no_downgrade_guard_applied = verifiedWorkflowProtected;

  // -------------------------------------------------------------------------
  // 1. Effective-state consistency invariant
  // -------------------------------------------------------------------------
  if (usedOverride) {
    if (routing && routing.used_arbitration_override !== true) {
      failures.push(
        `effective_state_routing_did_not_use_override(initial=${arbitration!.initial_intent_type}, final=${arbitration!.final_intent_type})`,
      );
      suggestedRecovery = "deterministic_fallback";
    }
    // Final answer mode contradicts effective state: routing/plan still in
    // data_refusal or out_of_scope_refusal after a guidance override.
    const planMode = plan?.answer_mode ?? null;
    if (
      planMode === "data_refusal_with_navigation" ||
      planMode === "out_of_scope_refusal"
    ) {
      // Only fail when arbitration moved AWAY from data/out-of-scope.
      if (
        arbitration!.initial_intent_type === "operational_data_request" ||
        arbitration!.initial_intent_type === "out_of_scope"
      ) {
        failures.push(
          `effective_state_plan_mode_contradicts_arbitration(plan=${planMode}, final_intent=${arbitration!.final_intent_type})`,
        );
        suggestedRecovery = "deterministic_fallback";
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Task-planning page invariant
  // -------------------------------------------------------------------------
  // STABILIZE.2: task-planning Roadmap invariant — fire on wording too, even
  // if the effective situation missed it. The user wording is the contract
  // probe, not the upstream label.
  const TASK_PLANNING_WORDING_RE =
    /\b(?:add(?:ing)?\s+tasks?|create\s+tasks?|where\s+(?:do|does|are)\s+(?:the\s+)?tasks?(?:\s+actually)?\s+live|task\s+structure|task\s+(?:creation|detail|setup)|project\s+planning\s+page|phase[- ]?task\s+(?:setup|planning))\b/i;
  const isTaskPlanningSituation =
    TASK_PLANNING_SITUATIONS.has(effectiveSituation) || TASK_PLANNING_WORDING_RE.test(q);
  if (isTaskPlanningSituation && finalAnswer) {
    for (const re of ROADMAP_AS_CLOSEST_PATTERNS) {
      if (re.test(finalAnswer)) {
        failures.push(`task_planning_roadmap_as_closest_area:${re.source}`);
        suggestedRecovery = "deterministic_fallback";
        replacementAnswer = replacementAnswer ?? fallbackTaskPlanning();
        break;
      }
    }
  }

  // STABILIZE.2: enforce effective_decision.forbidden_navigation phrases as
  // hard blocks when present in the final answer.
  if (decision && finalAnswer) {
    for (const phrase of decision.forbidden_navigation.forbidden_phrases ?? []) {
      const p = (phrase || "").toLowerCase().trim();
      if (p && finalLc.includes(p)) {
        failures.push(`forbidden_navigation_phrase_used:${p.slice(0, 80)}`);
        suggestedRecovery = "deterministic_fallback";
        replacementAnswer = replacementAnswer ?? fallbackSpecificSituation(effectiveSituation);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Dependency source-family invariant
  // -------------------------------------------------------------------------
  if (effectiveSituation === "dependency_sequencing") {
    if (effectiveIntent === "out_of_scope") {
      failures.push("dependency_sequencing_remained_out_of_scope_after_recovery");
      suggestedRecovery = suggestedRecovery === "none" ? "deterministic_fallback" : suggestedRecovery;
    }
    if (effective) {
      const slugs = [
        ...effective.primary_articles.map((a) => (a.slug || "").toLowerCase()),
        ...effective.supporting_articles.map((a) => (a.slug || "").toLowerCase()),
      ];
      const dependencyFamily = slugs.some((s) => /dependenc/.test(s));
      const primaryDependency = effective.primary_articles.some((a) =>
        /dependenc/.test((a.slug || "").toLowerCase()),
      );
      if (!dependencyFamily && /\bdependenc(?:y|ies)\b/i.test(finalAnswer)) {
        warnings.push("dependency_answer_without_dependency_family_source");
      }
      if (slugs.length > 0 && !primaryDependency && dependencyFamily === false) {
        warnings.push("dependency_sequencing_primary_sources_unrelated_family");
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Automatic dependency rescheduling hard-block invariant
  // -------------------------------------------------------------------------
  // 0.7H: Skip this check for generated-document / source-of-truth questions.
  // Phrases like "the PowerPoint does not automatically update BTPM" would
  // otherwise match the auto-move regex and incorrectly inject the dependency
  // fallback into a sharepoint/charter/deck answer.
  if (finalAnswer && !isGeneratedDocSourceOfTruthQuery && questionMentionsDependency) {
    for (const re of AUTO_DEPENDENCY_MOVE_PATTERNS) {
      if (re.test(finalAnswer)) {
        failures.push(`auto_dependency_movement_implied:${re.source}`);
        suggestedRecovery = "deterministic_fallback";
        replacementAnswer = fallbackDependencyAutoMove();
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4b. 0.7H / 0.7J: Generated-document / SharePoint output source-of-truth invariant
  // -------------------------------------------------------------------------
  // When the question is about whether editing a generated PowerPoint /
  // exported deck / SharePoint file updates BTPM, the final answer must
  // explain the source-of-truth boundary. Replace unrelated fallbacks
  // (dependency, generic insufficient) with the source-of-truth fallback.
  //
  // 0.7J narrowing: the trigger requires `isGeneratedDocSourceOfTruthQuery`
  // (question_asks_source_of_truth AND generated-doc context). A generated-
  // document situation alone no longer fires this repair, so workflow
  // questions like "How do I generate a PowerPoint?" are not downgraded.
  // Also skipped entirely when a verified workflow was selected.
  if (isGeneratedDocSourceOfTruthQuery && finalAnswer && !verifiedWorkflowProtected) {
    const leaksDependencyAnswer =
      /\bdependenc(?:y|ies)\s+in\s+btpm\s+should\s+be\s+treated\s+as\s+sequencing\s+guidance\b/i.test(finalAnswer) ||
      (/\bdependenc(?:y|ies)\b/i.test(finalAnswer) && !questionMentionsDependency);
    const looksGenericFallback = GENERIC_INSUFFICIENT_FALLBACK_PATTERNS.some((re) => re.test(finalAnswer));
    const lacksSourceOfTruthExplanation =
      !/\bsource\s+of\s+truth\b/i.test(finalAnswer) &&
      !/\bdoes\s+not\s+update\s+btpm\b/i.test(finalAnswer) &&
      !/\b(?:regenerate|re[- ]?export)\b/i.test(finalAnswer);
    if (leaksDependencyAnswer || looksGenericFallback || lacksSourceOfTruthExplanation) {
      failures.push("generated_document_source_of_truth_wrong_or_missing_fallback");
      suggestedRecovery = "deterministic_fallback";
      replacementAnswer = fallbackGeneratedDocSourceOfTruth();
      diagnostics.source_of_truth_fallback_applied = true;
      diagnostics.fallback_family = "generated_document_source_of_truth";
      diagnostics.fallback_reason = leaksDependencyAnswer
        ? "leaks_dependency_answer"
        : looksGenericFallback
          ? "generic_insufficient_fallback"
          : "missing_source_of_truth_explanation";
    }
  }



  // -------------------------------------------------------------------------
  // 5. Specific-situation salvage invariant
  // -------------------------------------------------------------------------
  if (SPECIFIC_SALVAGE_SITUATIONS.has(effectiveSituation) && !verifiedWorkflowProtected) {
    const hasRecommended = effectiveRecommendedSlugs.length > 0;
    const visibleSources =
      (effective?.primary_articles.length ?? 0) +
      (effective?.supporting_articles.length ?? 0);
    const isGenericFallback = GENERIC_INSUFFICIENT_FALLBACK_PATTERNS.some(
      (re) => re.test(finalAnswer),
    );
    if (hasRecommended && isGenericFallback) {
      if (visibleSources === 0) {
        failures.push(
          `specific_situation_fallback_with_no_visible_sources_despite_recommended:${effectiveSituation}`,
        );
        suggestedRecovery = suggestedRecovery === "none"
          ? "knowledge_pack_salvage_required"
          : suggestedRecovery;
        replacementAnswer = replacementAnswer ?? fallbackSpecificSituation(effectiveSituation);
      } else {
        failures.push(
          `specific_situation_fallback_despite_visible_sources:${effectiveSituation}`,
        );
        suggestedRecovery = "deterministic_fallback";
        replacementAnswer = replacementAnswer ?? fallbackSpecificSituation(effectiveSituation);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 6. Governance/SharePoint boundary invariant
  // -------------------------------------------------------------------------
  const questionMentionsGovernanceSp = GOVERNANCE_SHAREPOINT_RE.test(q);
  if (
    questionMentionsGovernanceSp &&
    !LIVE_DATA_MARKERS_RE.test(q) &&
    !ACTION_MARKERS_RE.test(q)
  ) {
    const planMode = plan?.answer_mode ?? null;
    const isGenericFallback = GENERIC_INSUFFICIENT_FALLBACK_PATTERNS.some(
      (re) => re.test(finalAnswer),
    );
    if (
      planMode === "out_of_scope_refusal" ||
      planMode === "insufficient_knowledge" ||
      isGenericFallback
    ) {
      const visibleSources =
        (effective?.primary_articles.length ?? 0) +
        (effective?.supporting_articles.length ?? 0);
      if (visibleSources > 0 || effectiveRecommendedSlugs.length > 0) {
        failures.push("governance_sharepoint_routed_to_out_of_scope_or_fallback");
        suggestedRecovery = "deterministic_fallback";
        replacementAnswer = replacementAnswer ?? fallbackGovernanceSharepoint();
      } else {
        warnings.push("governance_sharepoint_question_without_visible_sources");
      }
    }
  }

  // -------------------------------------------------------------------------
  // 7. KPI / project-health mixed invariant
  // -------------------------------------------------------------------------
  if (KPI_HEALTH_MIXED_RE.test(q) && !LIVE_DATA_MARKERS_RE.test(q)) {
    const planMode = plan?.answer_mode ?? null;
    const looksLikeDataRefusal = DATA_REFUSAL_PATTERNS.some((re) => re.test(finalAnswer));
    if (planMode === "data_refusal_with_navigation" || looksLikeDataRefusal) {
      failures.push("kpi_project_health_mixed_returned_data_refusal");
      suggestedRecovery = "deterministic_fallback";
      replacementAnswer = replacementAnswer ?? fallbackKpiHealthMixed();
    }
  }

  // -------------------------------------------------------------------------
  // 8. Safety refusal invariant
  // -------------------------------------------------------------------------
  // True live-data request: must be a data refusal (or fail-closed).
  if (LIVE_DATA_MARKERS_RE.test(q) && plan?.answer_mode !== "data_refusal_with_navigation") {
    const refusedInAnswer = DATA_REFUSAL_PATTERNS.some((re) => re.test(finalAnswer));
    if (!refusedInAnswer && finalAnswer.length > 0) {
      // Allow it if classification/arbitration already routed to a refusal
      // mode for a different reason.
      if (
        plan?.answer_mode !== "action_refusal_with_guidance" &&
        plan?.answer_mode !== "prompt_injection_refusal" &&
        plan?.answer_mode !== "out_of_scope_refusal"
      ) {
        failures.push("live_data_request_not_refused");
        suggestedRecovery = "deterministic_fallback";
      }
    }
  }
  // Action request: must be an action refusal.
  if (ACTION_MARKERS_RE.test(q)) {
    const refusedInAnswer = ACTION_REFUSAL_PATTERNS.some((re) => re.test(finalAnswer));
    if (
      plan?.answer_mode !== "action_refusal_with_guidance" &&
      !refusedInAnswer &&
      finalAnswer.length > 0
    ) {
      failures.push("action_request_not_refused");
      suggestedRecovery = "deterministic_fallback";
    }
  }
  // Prompt injection.
  if (PROMPT_INJECTION_RE.test(q) && plan?.answer_mode !== "prompt_injection_refusal") {
    failures.push("prompt_injection_not_refused");
    suggestedRecovery = "deterministic_fallback";
  }
  // Secret / raw chunk request.
  if (SECRET_REQUEST_RE.test(q)) {
    const refusedInAnswer =
      /\b(?:cannot|can(?:not|['’]t))\s+(?:reveal|share|disclose|expose|return|provide|show)\b/i.test(
        finalAnswer,
      ) ||
      plan?.answer_mode === "prompt_injection_refusal" ||
      plan?.answer_mode === "out_of_scope_refusal";
    if (!refusedInAnswer && finalAnswer.length > 0) {
      failures.push("secret_or_raw_internals_request_not_refused");
      suggestedRecovery = "deterministic_fallback";
    }
  }

  // -------------------------------------------------------------------------
  // Aggregate
  // -------------------------------------------------------------------------
  const ok = failures.length === 0;
  const severity: "pass" | "warn" | "fail" =
    !ok ? "fail" : warnings.length > 0 ? "warn" : "pass";
  const hard_block_final_return =
    !ok && suggestedRecovery !== "none" && suggestedRecovery !== "regenerate_once";

  diagnostics.applied_recovery_suggested = suggestedRecovery;
  diagnostics.invariant_failure_count = failures.length;
  diagnostics.invariant_warning_count = warnings.length;
  diagnostics.validation_severity_input = input.validation?.severity ?? null;
  diagnostics.routing_used_arbitration_override = routing?.used_arbitration_override ?? null;
  diagnostics.plan_answer_mode = plan?.answer_mode ?? null;
  diagnostics.routing_answer_mode = routing?.answer_mode ?? null;

  const repaired_by_invariant = hard_block_final_return && !!replacementAnswer;

  return {
    ok,
    severity,
    invariant_failures: failures,
    invariant_warnings: warnings,
    hard_block_final_return,
    applied_recovery: hard_block_final_return ? suggestedRecovery : "none",
    final_answer_allowed: !hard_block_final_return,
    replacement_answer: hard_block_final_return ? replacementAnswer : null,
    repaired_by_invariant,
    diagnostics,
  };
}

// Public helper: derive a deterministic situation-typed safe fallback by name.
export function guideV2InvariantFallback(situation: string): string {
  return fallbackSpecificSituation(situation);
}

// Convenience helper so callers don't need to redeclare the union.
export type GuideV2PipelineInvariantSeverity = GuideV2PipelineInvariantResult["severity"];

// Re-export for client mirror types if needed.
export { TASK_PLANNING_SITUATIONS, SPECIFIC_SALVAGE_SITUATIONS };

// Avoid unused warnings for tiny helper.
void asString;
