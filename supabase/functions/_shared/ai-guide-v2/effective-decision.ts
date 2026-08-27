// AI-GUIDE.V2-STABILIZE.2 — Canonical Effective Decision.
//
// Single authoritative object that controls downstream Guide V2 behavior
// AFTER arbitration + ontology normalization. Downstream layers
// (Knowledge Pack, Router, Planner, Validator, Invariants) MUST read this
// object instead of independently re-deriving state from the original
// classifier / domain diagnosis.
//
// This module is deterministic. No LLM calls. No I/O. Never reveals raw
// chunks, embeddings, prompts, secrets, or provider bodies.

import type {
  GuideV2DomainDiagnosis,
  GuideV2IntentClassification,
  GuideV2IntentType,
} from "./types.ts";
import type {
  GuideV2EffectivePipelineState,
  GuideV2IntentArbitrationResult,
} from "./intent-arbitration.ts";
import { SITUATION_DEFAULTS } from "./domain-situation-defaults.ts";
import type { BtpmDomainSituation } from "./domain-ontology.ts";
import { extractWorkflowFrame } from "./workflow-frame.ts";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface GuideV2SourcePriorityPolicy {
  /** Slugs that MUST be promoted into the primary set if visible. */
  preferred_slugs: string[];
  /** Slugs that MUST NOT appear as primary (still allowed as supporting). */
  suppress_primary_slugs: string[];
  /** Source family substrings (slug prefixes / regex-like) suppressed as primary. */
  suppress_primary_source_families: string[];
  /** Optional required source family that must be primary if visible. */
  required_source_family?: string | null;
}

export interface GuideV2SafeNavigation {
  primary_area: string | null;
  secondary_areas: string[];
  user_facing_path: string[];
}

export interface GuideV2ForbiddenNavigation {
  forbidden_primary_areas: string[];
  forbidden_phrases: string[];
}

export interface GuideV2SafetyMode {
  must_refuse_data_access: boolean;
  must_refuse_action_execution: boolean;
  must_refuse_prompt_or_secret_access: boolean;
  may_answer_with_safe_guidance: boolean;
  may_generate_verified_steps: boolean;
}

export type GuideV2EffectiveDecisionSource =
  | "original"
  | "deterministic_normalized"
  | "arbitration_recovered"
  | "safety_veto";

export interface GuideV2EffectiveDecision {
  original_intent_type: GuideV2IntentType;
  original_feature_area: string | null;
  original_workflow_id: string | null;
  original_domain_situation: BtpmDomainSituation | null;
  original_answer_strategy: string | null;

  effective_intent_type: GuideV2IntentType;
  effective_feature_area: string | null;
  effective_workflow_id: string | null;
  effective_domain_situation: BtpmDomainSituation | null;
  effective_answer_strategy: string;

  canonical_objects: string[];
  possible_objects: string[];
  core_distinctions: string[];
  recommended_kc_slugs: string[];
  retrieval_hints: {
    feature_areas: string[];
    keywords: string[];
    route_hints: string[];
  };

  source_priority_policy: GuideV2SourcePriorityPolicy;
  safe_navigation: GuideV2SafeNavigation;
  forbidden_navigation: GuideV2ForbiddenNavigation;
  safety_mode: GuideV2SafetyMode;

  needs_live_data: boolean;
  asks_assistant_to_act: boolean;
  needs_verified_ui_steps: boolean;

  decision_source: GuideV2EffectiveDecisionSource;
  decision_reason: string;
  confidence: number;
  trace_notes: string[];
}

// ---------------------------------------------------------------------------
// Deterministic wording-driven normalization (situation salvage)
// ---------------------------------------------------------------------------

// Lightweight wording checks. These do NOT replace the LLM diagnosis or
// arbitration — they only recover situations the upstream layers missed.
// No HR-question-typed regex; only generic systemic wording markers.

const TASK_PLANNING_WORDING =
  /\b(?:add(?:ing)?\s+tasks?|create\s+tasks?|where\s+(?:do|does|are)\s+(?:the\s+)?tasks?(?:\s+actually)?\s+live|task\s+structure|task\s+(?:creation|detail|setup)|project\s+planning\s+page|phase[- ]?task\s+(?:setup|planning))\b/i;

const DEPENDENCY_WORDING =
  /\b(?:predecessor|successor|task\s*1\s+(?:slip|finish|done|move)|task\s*2\s+(?:wait|move|start)|don['’]t\s+start\s+until|wait(?:s)?\s+for\s+(?:another|task|the\s+other)|blocked\s+by\s+(?:another|task))\b/i;

const PROGRESS_REPORTING_WORDING =
  /\b(?:what\s+changed\s+this\s+week|did\s+work|contributed|progress\s+report|report\s+progress|tell\s+people\s+what\s+changed)\b/i;

const COMMENT_VS_UPDATE_WORDING =
  /\b(?:comment\s+or\s+(?:an?\s+)?(?:execution\s+)?update|note\s+vs\s+progress\s+update|comment\s+vs\s+update)\b/i;

const BLOCKED_WORK_WORDING =
  /\b(?:supplier|vendor)\s+(?:missed|did\s+not|didn['’]t)\s+(?:deliver|deliver(?:y)?)|legal\s+approval\s+(?:is\s+)?block|budget\s+(?:approval\s+)?(?:is\s+)?block|customer\s+approval\s+(?:is\s+)?block|already\s+stop(?:ping|ped)\s+work\b/i;

const BASELINE_CHANGE_WORDING =
  /\b(?:changed\s+(?:the\s+)?(?:plan|dates?)\s+(?:after|in)\s+(?:a\s+)?meeting|agreed\s+(?:on\s+)?new\s+dates?|current\s+plan\s+vs\s+baseline|update\s+(?:my\s+)?baseline|baseline\s+(?:issue|change))\b/i;

const GOVERNANCE_SHAREPOINT_WORDING =
  /\b(?:minutes?\s+(?:are\s+)?in\s+sharepoint|meeting\s+notes\s+enough|decision\s+(?:was\s+)?made\s+outside\s+btpm|evidence\s+of\s+(?:the\s+)?decision)\b/i;

const KPI_HEALTH_MIXED_WORDING =
  /\b(?:project\s+(?:is\s+)?on\s+track\s+but\s+(?:the\s+)?kpi|kpi\s+(?:has\s+)?improved\s+but\s+(?:the\s+)?tasks?|progress\s+but\s+(?:the\s+)?kpi\s+(?:has\s+)?not\s+moved|kpi\s+vs\s+(?:project\s+)?(?:health|status))\b/i;

const STATUS_HEALTH_WORDING =
  /\b(?:boss\s+wants?\s+(?:a\s+)?status|what\s+status\s+should\s+i\s+(?:update|set|put)|red\s*\/?\s*green\s+status|progress\s+vs\s+health)\b/i;

// True live-data: the user asks the assistant to read/list/summarize current records.
const LIVE_DATA_WORDING =
  /\b(?:open\s+blockers\s+right\s+now|list\s+(?:my|all|current|open)\s+(?:risks?|blockers?|tasks?|projects?)|summari[sz]e\s+(?:my|actual|current)\s+(?:project\s+)?comments?|read\s+(?:the\s+)?sharepoint\s+file|show\s+(?:me\s+)?current\s+kpi\s+values?|which\s+projects?\s+are\s+red\s+now|what\s+did\s+(?:the\s+)?user\s+update\s+yesterday)\b/i;

// Action: the user asks the assistant to perform a state-changing operation.
const ACTION_WORDING =
  /\b(?:please\s+|now\s+|for\s+me\s+|for\s+us\s+)?(?:create|update|delete|submit|approve|sync|invite|grant\s+access|grant|give|upload|send|close|archive|connect|disconnect|record|resolve|configure|mark|complete|reopen|generate|export|remove|turn\s+(?:on|\w+\s+on)|enable|activate|switch\s+on)\s+(?:my|the|this|that|all|him|her|them|\w+\s+(?:admin|workspace))\b/i;

const PROMPT_INJECTION_WORDING =
  /\b(?:ignore\s+(?:the\s+)?(?:knowledge|system|prior|previous)\s+(?:instructions?|prompts?)|system\s+prompt|developer\s+message|hidden\s+instruction)\b/i;

const SECRET_WORDING =
  /\b(?:service[\s_-]?role|api[\s_-]?key|secret|raw\s+(?:chunk|embedding)s?|pgvector|vector\s+database)\b/i;

// ---------------------------------------------------------------------------
// Per-situation policy (source priority + navigation + safety).
// Generic, systemic; not HR-question-typed. No final-answer prose.
// ---------------------------------------------------------------------------

interface SituationPolicy {
  preferred_slugs?: string[];
  suppress_primary_slugs?: string[];
  suppress_primary_source_families?: string[];
  required_source_family?: string | null;
  safe_navigation?: GuideV2SafeNavigation;
  forbidden_navigation?: GuideV2ForbiddenNavigation;
}

const NAV_TASK_PLANNING: GuideV2SafeNavigation = {
  primary_area: "Project Planning",
  secondary_areas: ["Task detail", "Project/Phase structure"],
  user_facing_path: ["Project", "Project Planning", "Phase", "Task"],
};

const FORBIDDEN_TASK_PLANNING: GuideV2ForbiddenNavigation = {
  forbidden_primary_areas: ["Roadmap", "Gantt"],
  forbidden_phrases: [
    "closest BTPM area is the Roadmap",
    "Roadmap is the closest area",
    "use Roadmap to add tasks",
    "tasks live in Roadmap",
  ],
};

const SITUATION_POLICY: Partial<Record<string, SituationPolicy>> = {
  task_planning_guidance: {
    preferred_slugs: [
      "using-project-planning-page",
      "how-to-create-phases-and-tasks",
      "using-task-detail-page",
      "task-types-rulebook",
      "program-project-phase-task-rulebook",
    ],
    suppress_primary_source_families: ["roadmap", "gantt"],
    safe_navigation: NAV_TASK_PLANNING,
    forbidden_navigation: FORBIDDEN_TASK_PLANNING,
  },
  phase_task_planning: {
    preferred_slugs: [
      "using-project-planning-page",
      "how-to-create-phases-and-tasks",
      "using-task-detail-page",
      "task-types-rulebook",
      "program-project-phase-task-rulebook",
    ],
    suppress_primary_source_families: ["roadmap", "gantt"],
    safe_navigation: NAV_TASK_PLANNING,
    forbidden_navigation: FORBIDDEN_TASK_PLANNING,
  },
  work_structure_modelling_guidance: {
    preferred_slugs: [
      "using-project-planning-page",
      "how-to-create-phases-and-tasks",
      "using-task-detail-page",
      "program-project-phase-task-rulebook",
    ],
    suppress_primary_source_families: ["roadmap", "gantt"],
    safe_navigation: NAV_TASK_PLANNING,
    forbidden_navigation: FORBIDDEN_TASK_PLANNING,
  },
  dependency_sequencing: {
    preferred_slugs: [
      "dependencies-rulebook",
      "how-to-add-a-dependency",
      "faq-are-dependencies-only-visual",
    ],
    suppress_primary_source_families: ["powerbi", "sharepoint", "generated-document", "status-deck"],
    required_source_family: "dependenc",
    safe_navigation: {
      primary_area: "Task detail (Dependencies tab)",
      secondary_areas: ["Project Planning"],
      user_facing_path: ["Project", "Project Planning", "Task", "Dependencies"],
    },
    forbidden_navigation: {
      forbidden_primary_areas: [],
      forbidden_phrases: [
        "dependencies move dates automatically",
        "successor will automatically reschedule",
      ],
    },
  },
  progress_or_contribution_reporting: {
    preferred_slugs: [
      "how-to-update-execution",
      "comment-vs-execution-update-rulebook",
      "traceability-and-activity-history",
      "using-task-detail-page",
      "using-project-planning-page",
    ],
    safe_navigation: {
      primary_area: "Task detail (Execution updates)",
      secondary_areas: ["Project Planning", "Project Overview"],
      user_facing_path: ["Project", "Task", "Execution update"],
    },
  },
  comment_or_execution_update_guidance: {
    preferred_slugs: [
      "comment-vs-execution-update-rulebook",
      "how-to-update-execution",
      "traceability-and-activity-history",
      "using-task-detail-page",
    ],
    safe_navigation: {
      primary_area: "Task detail (Execution updates / Comments)",
      secondary_areas: ["Project Overview"],
      user_facing_path: ["Project", "Task", "Execution update or Comment"],
    },
  },
  blocked_work: {
    preferred_slugs: [
      "risk-vs-blocker-rulebook",
      "how-to-manage-risks-and-blockers",
      "using-risks-and-blockers-page",
      "how-to-update-execution",
    ],
    safe_navigation: {
      primary_area: "Risks & Blockers",
      secondary_areas: ["Task detail"],
      user_facing_path: ["Project", "Risks & Blockers", "Blocker"],
    },
  },
  baseline_change: {
    preferred_slugs: [
      "project-baseline-vs-current-plan",
      "how-to-update-execution",
      "project-lifecycle-status-stage-health",
    ],
    safe_navigation: {
      primary_area: "Project Planning (current plan)",
      secondary_areas: ["Task detail", "Project Overview"],
      user_facing_path: ["Project", "Project Planning"],
    },
  },
  governance_sharepoint_evidence_boundary: {
    preferred_slugs: [
      "how-to-record-governance-evidence",
      "using-project-governance",
      "governance-cadence-vs-record",
      "sharepoint-output-behavior",
      "traceability-and-activity-history",
    ],
    safe_navigation: {
      primary_area: "Project Governance",
      secondary_areas: ["Files / SharePoint link"],
      user_facing_path: ["Project", "Governance", "Governance record"],
    },
    forbidden_navigation: {
      forbidden_primary_areas: [],
      forbidden_phrases: [
        "BTPM reads SharePoint file content",
        "minutes in SharePoint are the BTPM record",
      ],
    },
  },
  sharepoint_boundary: {
    preferred_slugs: [
      "how-to-record-governance-evidence",
      "using-project-governance",
      "sharepoint-output-behavior",
      "traceability-and-activity-history",
    ],
    safe_navigation: {
      primary_area: "Project Governance",
      secondary_areas: ["Files / SharePoint link"],
      user_facing_path: ["Project", "Governance"],
    },
  },
  kpi_project_health_mixed_guidance: {
    preferred_slugs: [
      "using-project-kpis",
      "kpi-definitions-and-updates",
      "official-kpi-snapshots-vs-manual-update-history",
      "project-lifecycle-status-stage-health",
      "how-to-configure-project-kpis",
    ],
    safe_navigation: {
      primary_area: "Project KPIs",
      secondary_areas: ["Project Overview"],
      user_facing_path: ["Project", "KPIs"],
    },
  },
  status_or_health_update: {
    preferred_slugs: [
      "project-lifecycle-status-stage-health",
      "how-to-update-execution",
      "using-project-overview",
      "using-risks-and-blockers-page",
    ],
    safe_navigation: {
      primary_area: "Project Overview",
      secondary_areas: ["Task detail", "Risks & Blockers"],
      user_facing_path: ["Project", "Project Overview"],
    },
  },
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export interface ResolveGuideV2EffectiveDecisionInput {
  question: string;
  classification: GuideV2IntentClassification;
  domainDiagnosis: GuideV2DomainDiagnosis | null;
  arbitration: GuideV2IntentArbitrationResult | null;
  reconciledState: GuideV2EffectivePipelineState | null;
  contextRoute?: string | null;
  contextLabel?: string | null;
}

function normalizeSituationFromWording(question: string): BtpmDomainSituation | null {
  if (TASK_PLANNING_WORDING.test(question)) return "task_planning_guidance";
  if (DEPENDENCY_WORDING.test(question)) return "dependency_sequencing";
  if (BLOCKED_WORK_WORDING.test(question)) return "blocked_work";
  if (BASELINE_CHANGE_WORDING.test(question)) return "baseline_change";
  if (GOVERNANCE_SHAREPOINT_WORDING.test(question)) return "sharepoint_boundary";
  if (KPI_HEALTH_MIXED_WORDING.test(question)) return "kpi_project_health_mixed_guidance";
  if (COMMENT_VS_UPDATE_WORDING.test(question)) return "comment_or_execution_update_guidance";
  if (PROGRESS_REPORTING_WORDING.test(question)) return "progress_or_contribution_reporting";
  if (STATUS_HEALTH_WORDING.test(question)) return "status_or_health_update";
  return null;
}

function dedupe(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export function resolveGuideV2EffectiveDecision(
  input: ResolveGuideV2EffectiveDecisionInput,
): GuideV2EffectiveDecision {
  const trace: string[] = [];
  const q = input.question || "";
  const cls = input.classification;
  const diag = input.domainDiagnosis;
  const recon = input.reconciledState;
  const arb = input.arbitration;

  // ------------- Originals -------------
  const originalIntent: GuideV2IntentType = cls.intent_type;
  const originalSituation = (diag?.domain_situation ?? null) as BtpmDomainSituation | null;
  const originalStrategy = diag?.answer_strategy ?? null;

  // ------------- Start from reconciled state if present -------------
  let effIntent: GuideV2IntentType = recon?.effective_classification.intent_type ?? originalIntent;
  let effFeature: string | null =
    recon?.effective_classification.feature_area ?? cls.feature_area ?? null;
  let effWorkflow: string | null =
    recon?.effective_classification.workflow_id ?? cls.workflow_id ?? null;
  let effSituation: BtpmDomainSituation | null =
    (recon?.effective_domain_diagnosis?.domain_situation as BtpmDomainSituation | null) ??
    originalSituation;
  let effStrategy: string =
    recon?.effective_domain_diagnosis?.answer_strategy ??
    originalStrategy ??
    "unverified_safe_guidance";

  let needsLiveData = !!(recon?.effective_classification.is_user_asking_for_actual_data ?? cls.is_user_asking_for_actual_data);
  let asksToAct = !!(recon?.effective_classification.is_user_asking_assistant_to_act ?? cls.is_user_asking_assistant_to_act);
  let needsVerifiedUi = !!(recon?.effective_classification.needs_verified_ui_steps ?? cls.needs_verified_ui_steps);

  let decisionSource: GuideV2EffectiveDecisionSource =
    arb?.should_override_initial_intent ? "arbitration_recovered" : "original";
  const reasons: string[] = [];
  if (arb?.should_override_initial_intent) reasons.push(`arbitration:${arb.override_reason}`);

  // ------------- Safety vetoes (highest priority) -------------
  let safetyVeto: null | "action" | "live_data" | "prompt" | "secret" = null;
  const workflowFrame = extractWorkflowFrame(q, { route: input.contextRoute ?? null, routeLabel: input.contextLabel ?? null });
  const frameSaysGuidance = workflowFrame.intent_type === "workflow_guidance" || workflowFrame.intent_type === "clarification_needed";
  const frameSaysAction = workflowFrame.intent_type === "perform_action_request";

  if (frameSaysAction || ((ACTION_WORDING.test(q) || asksToAct) && !frameSaysGuidance)) {
    safetyVeto = "action";
    effIntent = "perform_action_request";
    effStrategy = "action_refusal";
    asksToAct = true;
    reasons.push("safety_veto:action");
    trace.push("safety_veto:action");
    trace.push(`workflow_frame_intent:${workflowFrame.intent_type}`);
  } else if (PROMPT_INJECTION_WORDING.test(q)) {
    safetyVeto = "prompt";
    effIntent = "prompt_injection";
    effStrategy = "prompt_refusal";
    reasons.push("safety_veto:prompt_injection");
    trace.push("safety_veto:prompt_injection");
  } else if (SECRET_WORDING.test(q)) {
    safetyVeto = "secret";
    effIntent = "out_of_scope";
    effStrategy = "out_of_scope_refusal";
    reasons.push("safety_veto:secret_request");
    trace.push("safety_veto:secret_request");
  } else if (LIVE_DATA_WORDING.test(q) || needsLiveData) {
    // Only veto when wording is true live-data; arbitration may already have
    // overridden a false live-data into guidance.
    if (LIVE_DATA_WORDING.test(q)) {
      safetyVeto = "live_data";
      effIntent = "operational_data_request";
      effStrategy = "data_refusal";
      needsLiveData = true;
      reasons.push("safety_veto:live_data");
      trace.push("safety_veto:live_data");
    }
  }

  if (!safetyVeto && frameSaysGuidance && asksToAct) {
    // GUIDE-MODE.0.7E: prevent broad action-word or LLM action flags from
    // converting normal self-service questions such as "Where do I update..."
    // into action refusals. Explicit "can you / do this for me" remains
    // frameSaysAction and is refused above.
    asksToAct = false;
    trace.push(`workflow_frame_recovered_guidance_from_action_flag:${workflowFrame.intent_type}`);
    if (effIntent === "perform_action_request") {
      effIntent = "workflow_guidance";
      effStrategy = "verified_or_safe_guidance";
    }
  }

  if (safetyVeto) decisionSource = "safety_veto";

  // ------------- Deterministic wording-driven situation salvage -------------
  if (!safetyVeto) {
    const wordingSituation = normalizeSituationFromWording(q);
    if (wordingSituation) {
      if (!effSituation || effSituation !== wordingSituation) {
        // Only adopt wording-derived situation if upstream did not pick a
        // more specific BTPM situation already.
        const upstreamIsSpecific =
          effSituation !== null &&
          effSituation !== "out_of_scope" &&
          effSituation !== "concept_explanation" &&
          effSituation !== "page_purpose_guidance" &&
          effSituation !== "workflow_how_to";
        if (!upstreamIsSpecific) {
          trace.push(`situation_salvage_from_wording:${effSituation ?? "null"}->${wordingSituation}`);
          effSituation = wordingSituation;
          if (decisionSource === "original") decisionSource = "deterministic_normalized";
          reasons.push(`wording_normalized:${wordingSituation}`);
        }
      }
    }
  }

  // ------------- Apply ontology defaults for the effective situation -------------
  const defaults = effSituation ? SITUATION_DEFAULTS[effSituation] : undefined;
  const canonicalObjects = dedupe([
    ...((defaults?.canonical_objects as string[] | undefined) ?? []),
    ...((recon?.effective_domain_diagnosis?.canonical_objects as string[] | undefined) ??
      (diag?.canonical_objects as string[] | undefined) ?? []),
  ]);
  const possibleObjects = dedupe([
    ...((defaults?.possible_objects as string[] | undefined) ?? []),
    ...((recon?.effective_domain_diagnosis?.possible_objects as string[] | undefined) ??
      (diag?.possible_objects as string[] | undefined) ?? []),
  ]);
  const coreDistinctions = dedupe([
    ...((defaults?.core_distinctions as string[] | undefined) ?? []),
    ...((recon?.effective_domain_diagnosis?.core_distinctions as string[] | undefined) ??
      (diag?.core_distinctions as string[] | undefined) ?? []),
  ]);

  // Strategy fallback from defaults.
  if (!effStrategy && defaults?.answer_strategy) {
    effStrategy = defaults.answer_strategy;
  }

  // ------------- Source priority + navigation policy -------------
  const policy = effSituation ? SITUATION_POLICY[effSituation] : undefined;
  const policyPreferred = policy?.preferred_slugs ?? [];
  const defaultSlugs = (defaults?.recommended_kc_slugs as string[] | undefined) ?? [];
  const diagSlugs =
    (recon?.effective_domain_diagnosis?.recommended_kc_slugs as string[] | undefined) ??
    (diag?.recommended_kc_slugs as string[] | undefined) ?? [];
  const recommendedSlugs = dedupe([...policyPreferred, ...defaultSlugs, ...diagSlugs]);

  const sourcePriority: GuideV2SourcePriorityPolicy = {
    preferred_slugs: dedupe([...policyPreferred, ...defaultSlugs]),
    suppress_primary_slugs: policy?.suppress_primary_slugs ?? [],
    suppress_primary_source_families: policy?.suppress_primary_source_families ?? [],
    required_source_family: policy?.required_source_family ?? null,
  };

  // ------------- Safe / forbidden navigation -------------
  const safeNav: GuideV2SafeNavigation = policy?.safe_navigation ?? {
    primary_area: null,
    secondary_areas: [],
    user_facing_path: [],
  };
  const forbiddenNav: GuideV2ForbiddenNavigation = policy?.forbidden_navigation ?? {
    forbidden_primary_areas: [],
    forbidden_phrases: [],
  };

  // ------------- Safety mode -------------
  const safetyMode: GuideV2SafetyMode = {
    must_refuse_data_access: safetyVeto === "live_data",
    must_refuse_action_execution: safetyVeto === "action",
    must_refuse_prompt_or_secret_access: safetyVeto === "prompt" || safetyVeto === "secret",
    may_answer_with_safe_guidance: safetyVeto !== "live_data" && safetyVeto !== "prompt" && safetyVeto !== "secret",
    may_generate_verified_steps: !safetyVeto && (workflowFrame.intent_type === "workflow_guidance" || !!needsVerifiedUi),
  };

  // ------------- Retrieval hints -------------
  const retrievalHints = {
    feature_areas: dedupe([
      ...((recon?.effective_domain_diagnosis?.retrieval_hints?.feature_areas as string[] | undefined) ??
        (diag?.retrieval_hints?.feature_areas as string[] | undefined) ?? []),
    ]),
    keywords: dedupe([
      ...((recon?.effective_domain_diagnosis?.retrieval_hints?.keywords as string[] | undefined) ??
        (diag?.retrieval_hints?.keywords as string[] | undefined) ?? []),
    ]),
    route_hints: dedupe([
      ...((recon?.effective_domain_diagnosis?.retrieval_hints?.route_hints as string[] | undefined) ??
        (diag?.retrieval_hints?.route_hints as string[] | undefined) ?? []),
      ...(input.contextRoute ? [input.contextRoute] : []),
    ]),
  };

  // ------------- Reason aggregate -------------
  const reason = reasons.length > 0
    ? reasons.join("; ")
    : decisionSource === "original"
    ? "no_change_from_original"
    : decisionSource === "deterministic_normalized"
    ? "deterministic_wording_normalization"
    : "arbitration";

  const confidence = Math.min(
    1,
    Math.max(
      0,
      (recon?.effective_domain_diagnosis?.confidence ?? diag?.confidence ?? cls.confidence ?? 0.5) -
        (safetyVeto ? 0 : 0),
    ),
  );

  return {
    original_intent_type: originalIntent,
    original_feature_area: cls.feature_area ?? null,
    original_workflow_id: cls.workflow_id ?? null,
    original_domain_situation: originalSituation,
    original_answer_strategy: originalStrategy,

    effective_intent_type: effIntent,
    effective_feature_area: effFeature,
    effective_workflow_id: effWorkflow,
    effective_domain_situation: effSituation,
    effective_answer_strategy: effStrategy,

    canonical_objects: canonicalObjects,
    possible_objects: possibleObjects,
    core_distinctions: coreDistinctions,
    recommended_kc_slugs: recommendedSlugs,
    retrieval_hints: retrievalHints,

    source_priority_policy: sourcePriority,
    safe_navigation: safeNav,
    forbidden_navigation: forbiddenNav,
    safety_mode: safetyMode,

    needs_live_data: needsLiveData,
    asks_assistant_to_act: asksToAct,
    needs_verified_ui_steps: needsVerifiedUi,

    decision_source: decisionSource,
    decision_reason: reason,
    confidence,
    trace_notes: trace,
  };
}
