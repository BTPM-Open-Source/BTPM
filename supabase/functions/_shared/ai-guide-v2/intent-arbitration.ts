// AI-GUIDE.V2-ARCH.1E — Evidence-aware intent arbitration.
//
// This deterministic layer reconciles classifier + domain diagnosis +
// knowledge pack evidence BEFORE routing, so the system no longer treats
// a poisoned first classification as irreversible.
//
// Rules:
//  - Safety vetoes always win (action requests, real live-data requests,
//    prompt-injection, secret/internal leakage requests).
//  - Guidance markers can override false-positive `operational_data_request`
//    when there are NO strong live-data markers and diagnosis/source
//    evidence points to BTPM guidance.
//  - BTPM object/source evidence can recover false-positive `out_of_scope`.
//  - Never returns user-facing text. Never reveals raw chunks, embeddings,
//    prompts, secrets, or provider bodies.

import type {
  GuideV2DomainDiagnosis,
  GuideV2IntentClassification,
  GuideV2IntentType,
  GuideV2KnowledgePack,
} from "./types.ts";
import { SITUATION_DEFAULTS } from "./domain-situation-defaults.ts";
import type { BtpmDomainSituation } from "./domain-ontology.ts";

export interface GuideV2IntentArbitrationResult {
  initial_intent_type: GuideV2IntentType;
  initial_feature_area: string | null;
  initial_workflow_id: string | null;
  final_intent_type: GuideV2IntentType;
  final_feature_area: string | null;
  final_workflow_id: string | null;
  final_domain_situation: string;
  final_answer_strategy: string;
  needs_live_data: boolean;
  asks_assistant_to_act: boolean;
  needs_verified_ui_steps: boolean;
  should_override_initial_intent: boolean;
  override_reason: string;
  arbitration_source:
    | "deterministic"
    | "deterministic_with_llm_adjudication"
    | "no_override";
  evidence_signals: {
    guidance_markers: string[];
    live_data_markers: string[];
    action_markers: string[];
    btpm_object_markers: string[];
    source_family_signals: string[];
    diagnosis_recommended_slugs: string[];
    resolved_diagnosis_slugs: string[];
    primary_source_slugs: string[];
    supporting_source_slugs: string[];
  };
  confidence: number;
  safety_notes: string[];
  schema_valid: boolean;
}

export interface ArbitrationInput {
  question: string;
  classification: GuideV2IntentClassification;
  domainDiagnosis: GuideV2DomainDiagnosis | null;
  knowledgePack: GuideV2KnowledgePack | null;
  contextRoute?: string | null;
  contextLabel?: string | null;
}

// ---------------------------------------------------------------------------
// Pattern banks (deterministic; do NOT add final-answer text or canned prose)
// ---------------------------------------------------------------------------

const GUIDANCE_MARKERS: { tag: string; re: RegExp }[] = [
  { tag: "where_do_i_see", re: /\bwhere (?:do|can|should) i (?:see|find|put|report|record|log)\b/i },
  { tag: "how_do_i_show", re: /\bhow (?:do|can|should) i (?:show|explain|record|report|tell|update|log|describe)\b/i },
  { tag: "what_should_i_update", re: /\bwhat should i (?:update|record|report|log|put|enter|do)\b/i },
  { tag: "i_want_people_to_know", re: /\bi want (?:people|the team|everyone|others) to know\b/i },
  { tag: "i_need_to_report", re: /\bi need to (?:report|explain|record|update|tell|log|describe|say)\b/i },
  { tag: "i_want_history", re: /\bi want (?:the )?(?:project )?history\b/i },
  { tag: "comment_or_update", re: /\bcomment or (?:an? )?(?:execution )?update\??/i },
  { tag: "what_page", re: /\bwhat page should i (?:use|open|go)\b/i },
  { tag: "what_does_this_mean", re: /\bwhat does (?:this|that|x|it) mean\b/i },
  { tag: "proper_way_to_say", re: /\bproper way to (?:say|express|describe|model)\b/i },
  { tag: "is_that_enough", re: /\bis that (?:enough|ok|fine|acceptable|sufficient)\b/i },
  { tag: "where_do_tasks_live", re: /\bwhere (?:do|does) (?:my )?tasks? (?:actually )?live\b/i },
  { tag: "dont_start_until", re: /\b(?:don'?t|do not|cannot|can'?t)\s+(?:start|begin|proceed)\s+(?:this|it|that)?\s*(?:until|before|unless)\b/i },
  { tag: "i_changed_the_plan", re: /\bi changed (?:the |my )?(?:plan|schedule|baseline|dates)\b/i },
  { tag: "what_changed_this_week", re: /\b(?:what|things that) (?:changed|happened) (?:this|last|recent)\b/i },
  { tag: "what_should_i_do", re: /\bwhat (?:should|can|do) i do\b/i },
  // ARCH.1E-FIX.3 — task-planning and KPI-vs-health markers.
  { tag: "add_tasks_dont_see_how", re: /\b(?:add|create|find|locate)\s+(?:a\s+)?tasks?\b.*\b(?:don'?t|do not|cannot|can'?t)\s+see\b/i },
  { tag: "where_do_tasks_live_alt", re: /\bwhere (?:do|does) (?:my )?tasks?\b/i },
  { tag: "task_planning", re: /\b(?:add|create|new|where)\s+.{0,20}\btasks?\b/i },
  { tag: "kpi_vs_project_health", re: /\b(?:on track|green|on schedule|going well|progressing)\b.*\bkpi\b/i },
  { tag: "kpi_vs_project_health_rev", re: /\bkpi\b.*\b(?:bad|red|low|underperforming|not moving|behind|lagging)\b/i },
  { tag: "progress_vs_kpi", re: /\b(?:tasks?|project|work|progress)\b.*\bkpi\b|\bkpi\b.*\b(?:tasks?|project|work|progress)\b/i },
  // GUIDE-MODE.0.7B — broader guidance phrasing so "how/where/can I …"
  // questions are not mis-classified as perform_action_request.
  { tag: "how_do_i_generic", re: /\bhow\s+(?:do|can|should|would)\s+i\b/i },
  { tag: "where_do_i_generic", re: /\bwhere\s+(?:do|can|should)\s+i\b/i },
  { tag: "can_i_generic", re: /\bcan\s+i\s+(?:turn|use|save|make|create|add|enable|find|see|track|attach|record|update|edit|change|open|view|link|connect|set|invite|grant|publish|generate|export)\b/i },
  { tag: "i_need_to_where_how", re: /\bi\s+need\s+to\b[^?]*\b(?:where|how)\s+(?:do|can|should)\s+i\b/i },
  { tag: "i_want_to_where_how", re: /\bi\s+want\s+to\b[^?]*\b(?:where|how)\s+(?:do|can|should)\s+i\b/i },
  { tag: "i_finished_can_i", re: /\bi\s+(?:finished|completed|set\s+up|created|built|made)\b[^?]*\bcan\s+i\b/i },
  { tag: "we_had_where_do_i", re: /\bwe\s+(?:had|finished|completed|just\s+ran)\b[^?]*\bwhere\s+(?:do|can|should)\s+i\b/i },
  { tag: "where_should_i_record", re: /\bwhere\s+should\s+i\s+(?:put|record|log|store|attach|enter)\b/i },
];

const LIVE_DATA_MARKERS: { tag: string; re: RegExp }[] = [
  { tag: "list_current", re: /\b(?:list|show me|give me|fetch|retrieve)\s+(?:all\s+)?(?:current|open|actual|live|my)\b/i },
  { tag: "summarize_actual", re: /\b(?:summarize|summarise)\s+(?:my|the actual|the current)\b/i },
  { tag: "read_my", re: /\bread\s+my\s+(?:file|sharepoint|comments?|records?|tasks?|kpis?|project)\b/i },
  { tag: "check_now", re: /\bcheck\s+(?:my )?(?:project|tenant|report|kpi|status)\s+(?:now|right now|today)\b/i },
  { tag: "blockers_open_right_now", re: /\bblockers\s+(?:are\s+)?(?:open|currently)\s+(?:in|on|for)\s+(?:my|the)\b/i },
  { tag: "which_projects_red", re: /\bwhich projects (?:are|currently are)\s+(?:red|amber|at risk)\b/i },
  { tag: "what_blockers_open_now", re: /\bwhat (?:blockers|risks|tasks|kpis) (?:are )?(?:open|active|outstanding) (?:right )?now\b/i },
  { tag: "user_did_yesterday", re: /\bwhat did .+ (?:do|update|change|submit) (?:yesterday|today|this week)\b/i },
  { tag: "show_current_values", re: /\bshow (?:me )?(?:the )?current (?:value|values|status|data)\b/i },
  { tag: "find_all_records", re: /\bfind all (?:records|tasks|projects|kpis)\b/i },
];

const ACTION_MARKERS: { tag: string; re: RegExp }[] = [
  { tag: "do_for_me", re: /\b(?:do|create|update|delete|submit|sync|send|invite|grant|upload|approve|change|set|save|generate|publish|run)\s+(?:.+?)\s+(?:for me|for us|now|please)\b/i },
  { tag: "create_x_for_me", re: /\b(?:create|add|make|update|delete|change)\s+(?:a |the )?(?:task|project|phase|kpi|blocker|risk|baseline|dependency|comment|user|invite)\b.*\b(?:for me|now|please)\b/i },
];

const BTPM_OBJECT_MARKERS: { tag: string; re: RegExp }[] = [
  { tag: "task", re: /\btasks?\b/i },
  { tag: "dependency", re: /\b(?:dependenc(?:y|ies)|predecessor|successor)\b/i },
  { tag: "blocker", re: /\bblockers?\b/i },
  { tag: "risk", re: /\brisks?\b/i },
  { tag: "project", re: /\bprojects?\b/i },
  { tag: "phase", re: /\bphases?\b/i },
  { tag: "governance", re: /\b(?:governance|steerco|steering committee|minutes)\b/i },
  { tag: "sharepoint", re: /\bsharepoint\b/i },
  { tag: "status_deck", re: /\bstatus deck|status report\b/i },
  { tag: "kpi", re: /\bkpis?\b/i },
  { tag: "power_bi", re: /\bpower\s*bi\b/i },
  { tag: "execution_update", re: /\bexecution update|update log\b/i },
  { tag: "comment", re: /\bcomments?\b/i },
  { tag: "baseline", re: /\b(?:baseline|current plan)\b/i },
];

const PROMPT_INJECTION_MARKERS = [
  /\bignore (?:the )?(?:knowledge|system|prior|previous) (?:instructions|prompts?)\b/i,
  /\bsystem prompt\b/i,
  /\bdeveloper message\b/i,
  /\bhidden instruction\b/i,
];

function findMarkers(
  question: string,
  bank: { tag: string; re: RegExp }[],
): string[] {
  const out: string[] = [];
  for (const m of bank) if (m.re.test(question)) out.push(m.tag);
  return out;
}

const GUIDANCE_SITUATIONS = new Set<string>([
  "guide_or_navigation_reporting_intent",
  "comment_or_execution_update_guidance",
  "progress_or_contribution_reporting",
  "work_structure_modelling_guidance",
  "external_plan_source_boundary",
  "phase_task_planning",
  "task_planning_guidance",
  "page_purpose_guidance",
  "concept_explanation",
  "status_or_health_update",
  "baseline_change",
  "dependency_sequencing",
  "blocked_work",
  "governance_sharepoint_evidence_boundary",
  "btpm_core_concept",
  "btpm_guide_capability_boundary",
  "kpi_concept",
  "kpi_snapshot_concept",
  "kpi_app_integration_concept",
  "kpi_submission_approval_boundary",
  "kpi_project_health_mixed_guidance",
  "powerbi_admin_usage",
  "powerbi_staleness_or_sync_issue",
  "powerbi_reporting_boundary",
  "sharepoint_boundary",
  "generated_document_boundary",
  "generated_document_source_of_truth_boundary",
  "workflow_how_to",
  "predecessor_or_dependency_blocked_work",
]);

const SPECIFIC_SITUATIONS = new Set<string>([
  "baseline_change",
  "dependency_sequencing",
  "blocked_work",
  "progress_or_contribution_reporting",
  "comment_or_execution_update_guidance",
  "governance_sharepoint_evidence_boundary",
  "external_plan_source_boundary",
  "phase_task_planning",
  "task_planning_guidance",
  "work_structure_modelling_guidance",
  "status_or_health_update",
  "predecessor_or_dependency_blocked_work",
  "kpi_project_health_mixed_guidance",
]);

export function arbitrateGuideV2Intent(
  input: ArbitrationInput,
): GuideV2IntentArbitrationResult {
  const { question, classification, domainDiagnosis, knowledgePack } = input;
  const q = question || "";
  const guidance = findMarkers(q, GUIDANCE_MARKERS);
  const liveData = findMarkers(q, LIVE_DATA_MARKERS);
  const actions = findMarkers(q, ACTION_MARKERS);
  const objects = findMarkers(q, BTPM_OBJECT_MARKERS);
  const promptInjection = PROMPT_INJECTION_MARKERS.some((r) => r.test(q));

  const initialIntent: GuideV2IntentType = classification.intent_type;
  const initialFeature = classification.feature_area ?? null;
  const initialWorkflow = classification.workflow_id ?? null;

  // Source family signals from KP.
  const primarySlugs = (knowledgePack?.primary_articles ?? [])
    .map((a) => (a.slug || "").toLowerCase())
    .filter(Boolean);
  const supportingSlugs = (knowledgePack?.supporting_articles ?? [])
    .map((a) => (a.slug || "").toLowerCase())
    .filter(Boolean);
  const sourceFamily: string[] = [];
  const allSlugs = [...primarySlugs, ...supportingSlugs];
  for (const s of allSlugs) {
    if (/baseline|current-plan/i.test(s)) sourceFamily.push("baseline_family");
    if (/dependenc/i.test(s)) sourceFamily.push("dependency_family");
    if (/risk|blocker/i.test(s)) sourceFamily.push("risk_blocker_family");
    if (/comment|execution-update/i.test(s)) sourceFamily.push("comment_update_family");
    if (/governance|sharepoint/i.test(s)) sourceFamily.push("governance_sharepoint_family");
    if (/planning|phase|task/i.test(s)) sourceFamily.push("planning_family");
    if (/kpi/i.test(s)) sourceFamily.push("kpi_family");
    if (/power-?bi/i.test(s)) sourceFamily.push("powerbi_family");
    if (/status|health|deck/i.test(s)) sourceFamily.push("status_family");
  }
  const recommended = (domainDiagnosis?.recommended_kc_slugs ?? []).map((s) =>
    (s || "").toLowerCase(),
  );
  const resolved = recommended.filter((s) =>
    allSlugs.includes(s),
  );

  const safetyNotes: string[] = [];
  let finalIntent = initialIntent;
  let finalSituation = domainDiagnosis?.domain_situation ?? "unknown";
  let finalStrategy = domainDiagnosis?.answer_strategy ?? "";
  let needsLiveData =
    classification.is_user_asking_for_actual_data === true ||
    (domainDiagnosis?.needs_live_data ?? false);
  let asksAct =
    classification.is_user_asking_assistant_to_act === true ||
    (domainDiagnosis?.asks_assistant_to_act ?? false);
  let needsUiSteps = classification.needs_verified_ui_steps === true;
  let overrode = false;
  let overrideReason = "";

  const guidanceSituation = GUIDANCE_SITUATIONS.has(finalSituation);
  const hasBtpmEvidence =
    objects.length > 0 ||
    allSlugs.length > 0 ||
    (domainDiagnosis &&
      (domainDiagnosis.canonical_objects.length > 0 ||
        domainDiagnosis.possible_objects.length > 0));

  // ---- Safety vetoes (no override) -----------------------------------------
  if (promptInjection) {
    safetyNotes.push("prompt_injection_marker_detected");
    if (initialIntent !== "prompt_injection") {
      finalIntent = "prompt_injection";
      overrode = true;
      overrideReason = "safety_veto:prompt_injection_marker";
    }
  } else if (actions.length > 0 || (asksAct && guidance.length === 0)) {
    // GUIDE-MODE.0.7B B1b — Only escalate to perform_action_request when an
    // EXPLICIT action marker is present (e.g. "for me", "now", "please").
    // The classifier's asks_assistant_to_act flag alone is unreliable for
    // guidance-shaped questions ("how/where/can I …") and was causing false
    // action-refusals on GW_A09 ("Where do I update the basic project
    // details?"), GW_C04, GW_F01–F08, GW_H04, etc.
    safetyNotes.push("action_request_detected");
    if (initialIntent !== "perform_action_request") {
      finalIntent = "perform_action_request";
      asksAct = true;
      overrode = initialIntent !== finalIntent;
      overrideReason = overrode ? "safety_veto:explicit_action_marker" : overrideReason;
    }
  } else if (asksAct && guidance.length > 0 && actions.length === 0) {
    // B1b — Strip false asksAct when guidance markers present and no
    // explicit assistant-action markers. Initial intent likely already
    // workflow_guidance/concept; just clear the flag so downstream doesn't
    // route to action_refusal_with_guidance.
    asksAct = false;
    safetyNotes.push("asks_assistant_to_act_stripped:guidance_markers_present_no_action_markers");
    if (initialIntent === "perform_action_request") {
      // Recover from a classifier mis-fire on a guidance question.
      finalIntent = "workflow_guidance";
      overrode = true;
      overrideReason = "guidance_markers_present_no_action_markers:recover_false_action_refusal";
    }
  } else if (
    liveData.length > 0 &&
    guidance.length === 0 &&
    initialIntent === "operational_data_request"
  ) {
    // confirmed live-data request — no override
  } else {
    // ---- B1: guidance beats false-positive live-data ----------------------
    if (
      (initialIntent === "operational_data_request" ||
        finalSituation === "live_data_request" ||
        finalStrategy === "data_refusal") &&
      guidance.length > 0 &&
      liveData.length === 0
    ) {
      if (
        finalStrategy === "verified_workflow_guidance" ||
        finalStrategy === "unverified_safe_guidance" ||
        finalSituation === "workflow_how_to" ||
        finalSituation === "dependency_sequencing"
      ) {
        finalIntent = "workflow_guidance";
      } else if (
        finalStrategy === "troubleshooting_guidance" ||
        finalSituation === "blocked_work"
      ) {
        finalIntent = "troubleshooting";
      } else {
        finalIntent = "concept";
      }
      needsLiveData = false;
      overrode = true;
      overrideReason =
        "guidance_markers_present_and_no_live_data_markers:override_false_live_data";
      // FIX.1: never keep data_refusal strategy after a guidance override.
      if (!finalStrategy || finalStrategy === "data_refusal") {
        finalStrategy = finalIntent === "workflow_guidance"
          ? "unverified_safe_guidance"
          : "concept_explanation";
      }
      if (!guidanceSituation || finalSituation === "live_data_request") {
        if (/\bkpi\b/i.test(q) && /\b(on track|green|on schedule|bad|red|low|behind|lagging|not moving|underperforming)\b/i.test(q)) {
          finalSituation = "kpi_project_health_mixed_guidance";
        } else if (/\b(?:add|create|find|locate|where).{0,20}\btasks?\b|\bwhere (?:do|does) (?:my )?tasks?\b/i.test(q)) {
          finalSituation = "task_planning_guidance";
        } else if (/changed (?:this|last) week|what (?:changed|happened)/i.test(q)) {
          finalSituation = "progress_or_contribution_reporting";
        } else if (/comment or (?:an? )?(?:execution )?update|history/i.test(q)) {
          finalSituation = "comment_or_execution_update_guidance";
        } else if (/sharepoint|minutes/i.test(q)) {
          finalSituation = "governance_sharepoint_evidence_boundary";
        } else if (/baseline|current plan|i changed the plan/i.test(q)) {
          finalSituation = "baseline_change";
        } else if (/don'?t start|until .* done|predecessor|dependenc|waits for|finish first|start after|before .* (?:task|done|finished)|blocked by another task/i.test(q)) {
          finalSituation = "dependency_sequencing";
        } else {
          finalSituation = "guide_or_navigation_reporting_intent";
        }
      }
    }

    // ---- B2: recover false-positive out_of_scope --------------------------
    if (
      (initialIntent === "out_of_scope" ||
        finalSituation === "out_of_scope") &&
      hasBtpmEvidence
    ) {
      if (
        finalSituation === "dependency_sequencing" ||
        objects.includes("dependency") ||
        guidance.includes("dont_start_until") ||
        /don'?t start|until .* done|finish first|start after|waits for|predecessor|successor/i.test(q)
      ) {
        finalIntent = "concept";
        finalSituation = "dependency_sequencing";
        finalStrategy = finalStrategy || "concept_explanation";
      } else if (
        objects.includes("sharepoint") ||
        objects.includes("governance")
      ) {
        finalIntent = "concept";
        finalSituation = "governance_sharepoint_evidence_boundary";
        finalStrategy = finalStrategy || "concept_explanation";
      } else if (objects.includes("baseline")) {
        finalIntent = "concept";
        finalSituation = "baseline_change";
      } else if (objects.includes("blocker") || objects.includes("risk")) {
        finalIntent = "troubleshooting";
        finalSituation = "blocked_work";
      } else {
        finalIntent = "concept";
        finalSituation = finalSituation === "out_of_scope" ? "btpm_core_concept" : finalSituation;
      }
      needsLiveData = false;
      overrode = true;
      overrideReason =
        "btpm_object_or_source_evidence_present:recover_false_out_of_scope";
    }
  }

  const result: GuideV2IntentArbitrationResult = {
    initial_intent_type: initialIntent,
    initial_feature_area: initialFeature,
    initial_workflow_id: initialWorkflow,
    final_intent_type: finalIntent,
    final_feature_area: initialFeature,
    final_workflow_id: initialWorkflow,
    final_domain_situation: finalSituation,
    final_answer_strategy: finalStrategy || "",
    needs_live_data: needsLiveData,
    asks_assistant_to_act: asksAct,
    needs_verified_ui_steps: needsUiSteps,
    should_override_initial_intent: overrode,
    override_reason: overrode ? overrideReason : "no_override",
    arbitration_source: overrode ? "deterministic" : "no_override",
    evidence_signals: {
      guidance_markers: guidance,
      live_data_markers: liveData,
      action_markers: actions,
      btpm_object_markers: objects,
      source_family_signals: Array.from(new Set(sourceFamily)),
      diagnosis_recommended_slugs: recommended,
      resolved_diagnosis_slugs: resolved,
      primary_source_slugs: primarySlugs,
      supporting_source_slugs: supportingSlugs,
    },
    confidence: overrode ? 0.7 : 0.9,
    safety_notes: safetyNotes,
    schema_valid: true,
  };
  return result;
}

export function isSpecificDomainSituation(s: string): boolean {
  return SPECIFIC_SITUATIONS.has(s);
}

// ---------------------------------------------------------------------------
// ARCH.1E-FIX.1 — Reconciled pipeline state.
// When arbitration overrides intent/situation, downstream stages (KP rebuild,
// router, planner) must consume the reconciled effective state instead of
// the original poisoned classification/diagnosis.
// ---------------------------------------------------------------------------

export interface GuideV2EffectivePipelineState {
  effective_classification: GuideV2IntentClassification;
  effective_domain_diagnosis: GuideV2DomainDiagnosis | null;
  classification_source: "original" | "arbitrated";
  diagnosis_source: "original" | "arbitrated";
  knowledge_pack_rebuild_required: boolean;
  knowledge_pack_rebuild_reason: string;
  effective_context_source:
    | "original_no_override"
    | "arbitration_override_rebuilt_knowledge"
    | "arbitration_override_no_rebuild";
  trace_notes: string[];
}

export function buildEffectivePipelineState(
  originalClassification: GuideV2IntentClassification,
  originalDiagnosis: GuideV2DomainDiagnosis | null,
  arbitration: GuideV2IntentArbitrationResult | null,
): GuideV2EffectivePipelineState {
  const trace: string[] = [];
  if (!arbitration || !arbitration.should_override_initial_intent) {
    return {
      effective_classification: originalClassification,
      effective_domain_diagnosis: originalDiagnosis,
      classification_source: "original",
      diagnosis_source: "original",
      knowledge_pack_rebuild_required: false,
      knowledge_pack_rebuild_reason: "no_override",
      effective_context_source: "original_no_override",
      trace_notes: ["no_override"],
    };
  }

  const effClassification: GuideV2IntentClassification = {
    ...originalClassification,
    intent_type: arbitration.final_intent_type,
    feature_area: arbitration.final_feature_area ?? originalClassification.feature_area,
    workflow_id: arbitration.final_workflow_id ?? originalClassification.workflow_id,
    is_user_asking_for_actual_data: arbitration.needs_live_data,
    is_user_asking_assistant_to_act: arbitration.asks_assistant_to_act,
    needs_verified_ui_steps: arbitration.needs_verified_ui_steps,
  };
  trace.push(
    `classification_arbitrated:${arbitration.initial_intent_type}->${arbitration.final_intent_type}`,
  );

  const normalized = buildEffectiveDomainDiagnosisFromArbitration({
    originalDiagnosis,
    arbitration,
  });
  const effDiagnosis = normalized.diagnosis;
  for (const n of normalized.trace_notes) trace.push(n);

  const rebuildRequired = true;
  const rebuildReason = `arbitration_override:${arbitration.override_reason}`;

  return {
    effective_classification: effClassification,
    effective_domain_diagnosis: effDiagnosis,
    classification_source: "arbitrated",
    diagnosis_source:
      effDiagnosis === originalDiagnosis ? "original" : "arbitrated",
    knowledge_pack_rebuild_required: rebuildRequired,
    knowledge_pack_rebuild_reason: rebuildReason,
    effective_context_source: "arbitration_override_rebuilt_knowledge",
    trace_notes: trace,
  };
}

// ---------------------------------------------------------------------------
// ARCH.1E-FIX.2 — Ontology-normalized effective diagnosis.
//
// When arbitration changes the domain situation, the effective diagnosis must
// be rebuilt from BTPM SITUATION_DEFAULTS for the new situation — not just a
// shallow copy of the original poisoned diagnosis. This ensures
// recommended_kc_slugs, canonical_objects, and core_distinctions reflect the
// arbitrated situation so the Knowledge Pack rebuild has slugs to promote.
// ---------------------------------------------------------------------------

export interface BuildEffectiveDomainDiagnosisInput {
  originalDiagnosis: GuideV2DomainDiagnosis | null;
  arbitration: GuideV2IntentArbitrationResult;
}

export interface BuildEffectiveDomainDiagnosisResult {
  diagnosis: GuideV2DomainDiagnosis;
  trace_notes: string[];
  applied_defaults: boolean;
}

function stripStaleSafetyNotes(notes: string[], finalSituation: string): string[] {
  return (notes ?? []).filter((n) => {
    if (!n || typeof n !== "string") return false;
    // Drop ontology_normalized:<old_situation> if it points to a different
    // situation than the arbitrated one.
    if (n.startsWith("ontology_normalized:")) {
      const s = n.slice("ontology_normalized:".length);
      return s === finalSituation;
    }
    // Drop stale arbitration_override breadcrumbs from earlier passes.
    if (n.startsWith("arbitration_override:")) return false;
    return true;
  });
}

function dedupeStr(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr) {
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function buildEffectiveDomainDiagnosisFromArbitration(
  input: BuildEffectiveDomainDiagnosisInput,
): BuildEffectiveDomainDiagnosisResult {
  const { originalDiagnosis, arbitration } = input;
  const traceNotes: string[] = [];
  const finalSituation = (arbitration.final_domain_situation || "unknown") as BtpmDomainSituation;
  const finalStrategy = arbitration.final_answer_strategy || originalDiagnosis?.answer_strategy || "concept_explanation";

  const defaults = SITUATION_DEFAULTS[finalSituation];
  const appliedDefaults = !!defaults;
  if (!defaults) {
    traceNotes.push(`missing_defaults_for_arbitrated_situation:${finalSituation}`);
  } else {
    traceNotes.push(`ontology_defaults_applied:${finalSituation}`);
  }

  // Start from situation defaults; merge non-conflicting fields from the
  // original diagnosis (possible_objects, retrieval keywords/routes, goal
  // domain). Stale fields (e.g. live_data canonical_objects) are dropped by
  // virtue of starting from defaults rather than spreading originalDiagnosis.
  const canonical = dedupeStr([
    ...((defaults?.canonical_objects as string[]) ?? []),
  ]);
  const possible = dedupeStr([
    ...((defaults?.possible_objects as string[]) ?? []),
    ...((originalDiagnosis?.possible_objects ?? []).filter(
      (o) => !canonical.includes(o),
    )),
  ]);
  const distinctions = dedupeStr([
    ...((defaults?.core_distinctions as string[]) ?? []),
  ]);
  const recommendedSlugs = dedupeStr([
    ...((defaults?.recommended_kc_slugs as string[]) ?? []),
    ...(originalDiagnosis?.recommended_kc_slugs ?? []),
  ]);
  const workflowCandidates = dedupeStr([
    ...((defaults?.workflow_candidates as string[]) ?? []),
    ...(originalDiagnosis?.workflow_candidates ?? []),
  ]);

  const retrievalHints = {
    feature_areas: dedupeStr(originalDiagnosis?.retrieval_hints?.feature_areas ?? []),
    keywords: dedupeStr(originalDiagnosis?.retrieval_hints?.keywords ?? []),
    route_hints: dedupeStr(originalDiagnosis?.retrieval_hints?.route_hints ?? []),
  };

  const oldSituation = originalDiagnosis?.domain_situation ?? "unknown";
  const stripped = stripStaleSafetyNotes(originalDiagnosis?.safety_notes ?? [], finalSituation);
  const safetyNotes = dedupeStr([
    ...stripped,
    ...(arbitration.safety_notes ?? []),
    `ontology_normalized:${finalSituation}`,
    `arbitration_override:${oldSituation}->${finalSituation}`,
  ]);

  const diagnosis: GuideV2DomainDiagnosis = {
    domain_situation: finalSituation,
    canonical_objects: canonical,
    possible_objects: possible,
    not_objects: originalDiagnosis?.not_objects ?? [],
    core_distinctions: distinctions,
    user_goal_domain: originalDiagnosis?.user_goal_domain || "btpm",
    answer_strategy: finalStrategy,
    recommended_kc_slugs: recommendedSlugs,
    retrieval_hints: retrievalHints,
    workflow_candidates: workflowCandidates,
    needs_verified_ui_steps: arbitration.needs_verified_ui_steps,
    needs_live_data: arbitration.needs_live_data,
    asks_assistant_to_act: arbitration.asks_assistant_to_act,
    safety_notes: safetyNotes,
    confidence: arbitration.confidence,
    diagnosis_source: "arbitrated+ontology_normalized",
    schema_valid: true,
  };

  if (originalDiagnosis && originalDiagnosis.domain_situation !== finalSituation) {
    traceNotes.push(
      `diagnosis_ontology_normalized:${originalDiagnosis.domain_situation}->${finalSituation}`,
    );
  } else if (!originalDiagnosis) {
    traceNotes.push(`diagnosis_synthesized_from_arbitration:${finalSituation}`);
  }

  return { diagnosis, trace_notes: traceNotes, applied_defaults: appliedDefaults };
}
