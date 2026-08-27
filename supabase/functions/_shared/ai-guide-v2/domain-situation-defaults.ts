// AI-GUIDE.V2-ARCH.1A-FIX — Ontology-grounded defaults per domain_situation.
//
// Declarative defaults used to normalize LLM diagnosis output against the
// BTPM canonical model. NOT a phrase patcher — these defaults only apply
// once the LLM has chosen a domain_situation from the controlled enum.

import type {
  BtpmAnswerStrategy,
  BtpmCanonicalObject,
  BtpmCoreDistinction,
  BtpmDomainSituation,
} from "./domain-ontology.ts";

export interface SituationDefaults {
  canonical_objects: BtpmCanonicalObject[];
  possible_objects: BtpmCanonicalObject[];
  core_distinctions: BtpmCoreDistinction[];
  answer_strategy: BtpmAnswerStrategy;
  /** Allowed strategies — LLM may pick one of these; anything else is coerced to answer_strategy. */
  allowed_strategies?: BtpmAnswerStrategy[];
  recommended_kc_slugs: string[];
  workflow_candidates?: string[];
  asks_assistant_to_act?: boolean;
  needs_live_data?: boolean;
  needs_verified_ui_steps?: boolean;
}

export const SITUATION_DEFAULTS: Partial<Record<BtpmDomainSituation, SituationDefaults>> = {
  blocked_work: {
    canonical_objects: ["task", "blocker"],
    possible_objects: ["risk", "dependency", "execution_update", "comment"],
    core_distinctions: ["risk_vs_blocker", "dependency_vs_blocker", "comment_vs_execution_update"],
    answer_strategy: "troubleshooting_guidance",
    allowed_strategies: ["troubleshooting_guidance", "verified_workflow_guidance", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "risk-vs-blocker-rulebook",
      "how-to-manage-risks-and-blockers",
      "using-risks-and-blockers-page",
      "how-to-update-execution",
      "comment-vs-execution-update-rulebook",
    ],
  },
  future_risk: {
    canonical_objects: ["risk"],
    possible_objects: ["blocker", "dependency", "comment", "execution_update"],
    core_distinctions: ["risk_vs_blocker"],
    answer_strategy: "troubleshooting_guidance",
    allowed_strategies: ["troubleshooting_guidance", "concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "risk-vs-blocker-rulebook",
      "how-to-manage-risks-and-blockers",
      "using-risks-and-blockers-page",
    ],
  },
  dependency_sequencing: {
    canonical_objects: ["task", "dependency"],
    possible_objects: ["blocker"],
    core_distinctions: ["dependency_vs_blocker"],
    answer_strategy: "unverified_safe_guidance",
    allowed_strategies: ["verified_workflow_guidance", "unverified_safe_guidance", "concept_explanation"],
    recommended_kc_slugs: [
      "how-to-add-a-dependency",
      "dependencies-rulebook",
      "faq-are-dependencies-only-visual",
    ],
    workflow_candidates: ["add_dependency"],
  },
  action_execution_request: {
    canonical_objects: [],
    possible_objects: [],
    core_distinctions: ["guide_guidance_vs_live_data_access"],
    answer_strategy: "action_refusal",
    allowed_strategies: ["action_refusal"],
    recommended_kc_slugs: [],
    asks_assistant_to_act: true,
  },
  live_data_request: {
    canonical_objects: [],
    possible_objects: [],
    core_distinctions: ["guide_guidance_vs_live_data_access"],
    answer_strategy: "data_refusal",
    allowed_strategies: ["data_refusal"],
    recommended_kc_slugs: [],
    needs_live_data: true,
  },
  prompt_attack: {
    canonical_objects: [],
    possible_objects: [],
    core_distinctions: [],
    answer_strategy: "prompt_refusal",
    allowed_strategies: ["prompt_refusal"],
    recommended_kc_slugs: [],
  },
  out_of_scope: {
    canonical_objects: [],
    possible_objects: [],
    core_distinctions: [],
    answer_strategy: "out_of_scope_refusal",
    allowed_strategies: ["out_of_scope_refusal"],
    recommended_kc_slugs: [],
  },
  sharepoint_boundary: {
    canonical_objects: ["file", "sharepoint_output"],
    possible_objects: ["status_deck"],
    core_distinctions: ["btpm_record_vs_exported_document"],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "sharepoint-output-behavior",
      "where-project-documents-are-stored",
      "generated-documents-in-btpm",
    ],
  },
  generated_document_boundary: {
    canonical_objects: ["file", "sharepoint_output", "status_deck"],
    possible_objects: [],
    core_distinctions: ["btpm_record_vs_exported_document"],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "generated-documents-in-btpm",
      "sharepoint-output-behavior",
      "where-project-documents-are-stored",
    ],
  },
  powerbi_reporting_boundary: {
    canonical_objects: ["powerbi_report", "kpi_snapshot"],
    possible_objects: ["kpi_definition", "kpi_update"],
    core_distinctions: ["kpi_definition_vs_update_vs_snapshot"],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "powerbi-reporting-boundary",
      "kpi-definition-vs-update-vs-snapshot",
    ],
  },
  // AI-GUIDE.V2-QA.2: generic concept_explanation must NOT inject broad
  // lifecycle/baseline slugs by default — those caused systemic source
  // pollution in answers about Agile, RACI, Power BI, KPIs, etc.
  // Lifecycle / baseline slugs are now only recommended via the specific
  // situations status_or_health_update and baseline_change.
  concept_explanation: {
    canonical_objects: [],
    possible_objects: [],
    core_distinctions: [],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [],
  },
  // AI-GUIDE.V2-QA.2: lifecycle/status/stage/health/progress questions.
  status_or_health_update: {
    canonical_objects: ["project"],
    possible_objects: ["execution_update", "task", "phase"],
    core_distinctions: ["verified_workflow_vs_unverified_guidance"],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance", "troubleshooting_guidance"],
    recommended_kc_slugs: [
      "project-lifecycle-status-stage-health",
      "project-status-overview",
    ],
  },
  // AI-GUIDE.V2-QA.2: baseline / current plan / rebaseline questions.
  baseline_change: {
    canonical_objects: ["project"],
    possible_objects: ["phase", "task", "execution_update"],
    core_distinctions: ["baseline_vs_current_plan", "verified_workflow_vs_unverified_guidance"],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance", "troubleshooting_guidance"],
    recommended_kc_slugs: [
      "project-baseline-vs-current-plan",
    ],
  },
  workflow_how_to: {
    canonical_objects: [],
    possible_objects: [],
    core_distinctions: ["verified_workflow_vs_unverified_guidance"],
    answer_strategy: "unverified_safe_guidance",
    allowed_strategies: ["verified_workflow_guidance", "unverified_safe_guidance", "concept_explanation"],
    recommended_kc_slugs: [],
  },
  page_purpose_guidance: {
    canonical_objects: ["roadmap", "project"],
    possible_objects: ["program", "status_deck"],
    core_distinctions: ["page_purpose_vs_click_by_click_workflow"],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "roadmap-and-gantt",
      "using-roadmap-dashboard",
      "project-status-overview",
    ],
  },
  task_completion_approval_boundary: {
    canonical_objects: ["task"],
    possible_objects: ["execution_update", "comment", "project"],
    core_distinctions: ["verified_workflow_vs_unverified_guidance"],
    answer_strategy: "unverified_safe_guidance",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance", "troubleshooting_guidance"],
    recommended_kc_slugs: [
      "using-task-detail-page",
      "how-to-update-execution",
      "why-cant-i-edit-project-or-task",
      "task-types-rulebook",
      "comment-vs-execution-update-rulebook",
    ],
  },
  // OBS.1-FIX.1 / ARCH.1E-FIX.3: task-planning primary source is Project
  // Planning. Roadmap/Gantt may be supporting visibility only — never primary.
  phase_task_planning: {
    canonical_objects: ["project", "phase", "task"],
    possible_objects: ["dependency", "template"],
    core_distinctions: [
      "page_purpose_vs_click_by_click_workflow",
      "verified_workflow_vs_unverified_guidance",
    ],
    answer_strategy: "unverified_safe_guidance",
    allowed_strategies: ["unverified_safe_guidance", "troubleshooting_guidance", "concept_explanation"],
    recommended_kc_slugs: [
      "using-project-planning-page",
      "how-to-create-phases-and-tasks",
      "using-task-detail-page",
      "task-types-rulebook",
      "program-project-phase-task-rulebook",
    ],
    workflow_candidates: [],
  },

  // ARCH.1E-FIX.3 — explicit task-planning alias (same priority as phase_task_planning).
  task_planning_guidance: {
    canonical_objects: ["project", "phase", "task"],
    possible_objects: ["dependency", "template"],
    core_distinctions: [
      "page_purpose_vs_click_by_click_workflow",
      "verified_workflow_vs_unverified_guidance",
    ],
    answer_strategy: "unverified_safe_guidance",
    allowed_strategies: ["unverified_safe_guidance", "troubleshooting_guidance", "concept_explanation"],
    recommended_kc_slugs: [
      "using-project-planning-page",
      "how-to-create-phases-and-tasks",
      "using-task-detail-page",
      "task-types-rulebook",
      "program-project-phase-task-rulebook",
    ],
    workflow_candidates: [],
  },


  // AI-GUIDE.V2-ARCH.1C — predecessor/prior-task blocked work.
  predecessor_or_dependency_blocked_work: {
    canonical_objects: ["task", "dependency"],
    possible_objects: ["blocker", "execution_update", "comment", "phase", "project"],
    core_distinctions: [
      "dependency_vs_blocker",
      "comment_vs_execution_update",
      "verified_workflow_vs_unverified_guidance",
    ],
    answer_strategy: "troubleshooting_guidance",
    allowed_strategies: [
      "troubleshooting_guidance",
      "verified_workflow_guidance",
      "unverified_safe_guidance",
      "concept_explanation",
    ],
    recommended_kc_slugs: [
      "how-to-add-a-dependency",
      "dependencies-rulebook",
      "faq-are-dependencies-only-visual",
      "how-to-update-execution",
      "using-task-detail-page",
      "comment-vs-execution-update-rulebook",
    ],
    workflow_candidates: [],
  },

  // AI-GUIDE.V2-ARCH.1C — progress / contribution reporting.
  progress_or_contribution_reporting: {
    canonical_objects: ["task", "execution_update", "comment", "project"],
    possible_objects: ["phase", "governance_record", "kpi_update"],
    core_distinctions: [
      "comment_vs_execution_update",
      "guide_guidance_vs_live_data_access",
      "verified_workflow_vs_unverified_guidance",
    ],
    answer_strategy: "troubleshooting_guidance",
    allowed_strategies: [
      "troubleshooting_guidance",
      "unverified_safe_guidance",
      "concept_explanation",
    ],
    recommended_kc_slugs: [
      "how-to-update-execution",
      "comment-vs-execution-update-rulebook",
      "using-task-detail-page",
      "using-project-planning-page",
      "project-lifecycle-status-stage-health",
    ],
    workflow_candidates: [],
  },

  // AI-GUIDE.V2-ARCH.1C — governance event reporting (SteerCo / reviews).
  governance_event_reporting: {
    canonical_objects: ["governance_record", "governance_cadence", "project", "execution_update"],
    possible_objects: ["comment", "file", "sharepoint_output", "status_deck", "task"],
    core_distinctions: [
      "governance_cadence_vs_record",
      "comment_vs_execution_update",
      "btpm_record_vs_exported_document",
      "guide_guidance_vs_live_data_access",
    ],
    answer_strategy: "troubleshooting_guidance",
    allowed_strategies: [
      "troubleshooting_guidance",
      "unverified_safe_guidance",
      "concept_explanation",
    ],
    recommended_kc_slugs: [
      "governance-cadence-vs-record",
      "how-to-record-governance-evidence",
      "using-project-governance",
      "project-governance-traceability",
      "traceability-and-activity-history",
      "using-project-calendar",
      "governance-reporting-power-bi-readiness",
    ],
    workflow_candidates: [],
  },


  // ===========================================================================
  // AI-GUIDE.V2-QA.3 — Domain-boundary specific situations.
  // ===========================================================================

  // Part A — BTPM core concept boundary.
  btpm_core_concept: {
    canonical_objects: [
      "organization", "workspace", "program", "project", "phase", "task",
      "governance_record", "kpi_definition", "risk", "blocker",
      "file", "powerbi_report", "sharepoint_output",
    ],
    possible_objects: ["status_deck", "execution_update", "comment"],
    core_distinctions: [
      "btpm_record_vs_exported_document",
      "guide_guidance_vs_live_data_access",
      "page_purpose_vs_click_by_click_workflow",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "what-is-btpm",
      "understanding-btpm-structure",
      "program-project-phase-task-rulebook",
      "power-bi-in-btpm",
      "sharepoint-output-behavior",
      "generated-documents-in-btpm",
    ],
  },

  // Part B — BTPM Guide capability boundary.
  btpm_guide_capability_boundary: {
    canonical_objects: ["access_permission"],
    possible_objects: ["project", "risk", "blocker", "kpi_definition", "file"],
    core_distinctions: [
      "guide_guidance_vs_live_data_access",
      "btpm_record_vs_exported_document",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "data_refusal", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "what-is-btpm-guide",
      "what-can-btpm-guide-do-for-me",
      "why-btpm-guide-not-answering",
      "why-btpm-guide-not-enough-information",
      "why-btpm-guide-answer-weak-sources",
    ],
  },

  // Part C — KPI / KPI App boundaries.
  kpi_concept: {
    canonical_objects: ["kpi_definition", "kpi_update", "kpi_snapshot"],
    possible_objects: ["project", "powerbi_report"],
    core_distinctions: ["kpi_definition_vs_update_vs_snapshot"],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "manual-vs-automatic-kpis",
      "automatic-kpi-library-and-formulas",
      "btpm-kpi-engine",
      "kpi-definitions-and-updates",
    ],
  },
  kpi_app_integration_concept: {
    canonical_objects: ["kpi_definition", "kpi_snapshot", "powerbi_report"],
    possible_objects: ["kpi_update", "project"],
    core_distinctions: [
      "kpi_definition_vs_update_vs_snapshot",
      "guide_guidance_vs_live_data_access",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "kpi-app-in-btpm",
      "using-kpi-app-admin-page",
      "kpi-readiness-statuses",
      "kpi-automation-protocol",
      "why-kpi-app-report-not-ready",
    ],
  },
  kpi_submission_approval_boundary: {
    canonical_objects: ["kpi_snapshot", "kpi_definition"],
    possible_objects: ["kpi_update", "powerbi_report"],
    core_distinctions: [
      "kpi_definition_vs_update_vs_snapshot",
      "guide_guidance_vs_live_data_access",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance", "data_refusal"],
    recommended_kc_slugs: [
      "can-btpm-automatically-approve-kpi-submissions",
      "kpi-app-in-btpm",
      "kpi-automation-protocol",
      "kpi-readiness-statuses",
      "why-kpi-app-submission-failed",
    ],
  },
  kpi_snapshot_concept: {
    canonical_objects: ["kpi_snapshot", "kpi_update", "kpi_definition"],
    possible_objects: ["project", "powerbi_report"],
    core_distinctions: ["kpi_definition_vs_update_vs_snapshot"],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "official-kpi-snapshots-vs-manual-update-history",
      "how-to-capture-kpi-snapshots",
      "using-project-kpis",
      "kpi-definitions-and-updates",
      "btpm-kpi-engine",
    ],
  },

  // Part E — Power BI admin + staleness.
  powerbi_admin_usage: {
    canonical_objects: ["powerbi_report", "access_permission"],
    possible_objects: ["kpi_snapshot", "kpi_definition"],
    core_distinctions: [
      "kpi_definition_vs_update_vs_snapshot",
      "btpm_record_vs_exported_document",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "using-power-bi-admin-page",
      "power-bi-in-btpm",
      "governance-reporting-power-bi-readiness",
    ],
  },
  powerbi_staleness_or_sync_issue: {
    canonical_objects: ["powerbi_report", "kpi_snapshot"],
    possible_objects: ["kpi_definition", "kpi_update", "project"],
    core_distinctions: [
      "kpi_definition_vs_update_vs_snapshot",
      "btpm_record_vs_exported_document",
    ],
    answer_strategy: "troubleshooting_guidance",
    allowed_strategies: ["troubleshooting_guidance", "concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "why-power-bi-data-is-stale-or-different",
      "using-power-bi-admin-page",
      "power-bi-in-btpm",
      "governance-reporting-power-bi-readiness",
    ],
  },

  // Part F — Generated document source-of-truth boundary.
  generated_document_source_of_truth_boundary: {
    canonical_objects: ["status_deck", "file", "sharepoint_output", "project"],
    possible_objects: ["execution_update", "kpi_snapshot"],
    core_distinctions: [
      "btpm_record_vs_exported_document",
      "guide_guidance_vs_live_data_access",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "weekly-project-status-deck",
      "generated-documents-in-btpm",
      "are-exported-reports-the-live-project-record",
      "roadmap-status-deck",
      "why-cant-i-generate-powerpoint-status-deck",
      "sharepoint-output-behavior",
    ],
  },

  // ===========================================================================
  // AI-GUIDE.V2-HUMANQA.1 — Human-intent routing situations.
  // ===========================================================================

  // Part B — Practical work-structure / modelling guidance.
  // ARCH.1E-FIX.3: Project Planning first; Roadmap is not a creation source.
  work_structure_modelling_guidance: {
    canonical_objects: ["program", "project", "phase", "task"],
    possible_objects: ["template", "governance_record"],
    core_distinctions: [
      "page_purpose_vs_click_by_click_workflow",
      "verified_workflow_vs_unverified_guidance",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance", "troubleshooting_guidance"],
    recommended_kc_slugs: [
      "using-project-planning-page",
      "how-to-create-phases-and-tasks",
      "using-task-detail-page",
      "task-types-rulebook",
      "program-project-phase-task-rulebook",
      "understanding-btpm-structure",
      "using-programs",
      "faq-project-or-task",
    ],
  },

  // ARCH.1E-FIX.3 — KPI/project-health mixed question (NOT a live-data request).
  kpi_project_health_mixed_guidance: {
    canonical_objects: ["project", "kpi_definition", "kpi_update"],
    possible_objects: ["kpi_snapshot", "execution_update", "task", "phase"],
    core_distinctions: [
      "kpi_definition_vs_update_vs_snapshot",
      "guide_guidance_vs_live_data_access",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance", "troubleshooting_guidance"],
    recommended_kc_slugs: [
      "kpi-definitions-and-updates",
      "official-kpi-snapshots-vs-manual-update-history",
      "using-project-kpis",
      "project-lifecycle-status-stage-health",
    ],
  },

  // Part C — External plan / source-of-truth boundary
  // (Excel, PowerPoint, SharePoint planning files vs BTPM record).
  external_plan_source_boundary: {
    canonical_objects: ["project", "phase", "task", "file", "sharepoint_output"],
    possible_objects: ["status_deck", "powerbi_report"],
    core_distinctions: [
      "btpm_record_vs_exported_document",
      "page_purpose_vs_click_by_click_workflow",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance"],
    recommended_kc_slugs: [
      "what-is-btpm",
      "using-project-planning-page",
      "generated-documents-in-btpm",
      "sharepoint-output-behavior",
      "are-exported-reports-the-live-project-record",
      "weekly-project-status-deck",
      "power-bi-in-btpm",
    ],
  },

  // Part D — Comment / execution update / note routing.
  comment_or_execution_update_guidance: {
    canonical_objects: ["comment", "execution_update", "task", "phase", "project"],
    possible_objects: ["governance_record"],
    core_distinctions: ["comment_vs_execution_update"],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance", "troubleshooting_guidance"],
    recommended_kc_slugs: [
      "comment-vs-execution-update-rulebook",
      "how-to-update-execution",
      "using-task-detail-page",
      "traceability-and-activity-history",
      "using-project-planning-page",
    ],
  },

  // Part A — Generic guidance / navigation / reporting intent.
  // Use when the user is asking "where do I see / how do I show / where do I
  // report / what page should I use" WITHOUT asking the assistant to read
  // actual records. NEVER set needs_live_data here.
  guide_or_navigation_reporting_intent: {
    canonical_objects: ["project"],
    possible_objects: ["task", "phase", "execution_update", "comment", "risk", "blocker", "roadmap"],
    core_distinctions: [
      "page_purpose_vs_click_by_click_workflow",
      "guide_guidance_vs_live_data_access",
    ],
    answer_strategy: "concept_explanation",
    allowed_strategies: ["concept_explanation", "unverified_safe_guidance", "troubleshooting_guidance"],
    recommended_kc_slugs: [
      "using-project-overview",
      "using-roadmap-dashboard",
      "project-status-overview",
      "using-risks-and-blockers-page",
      "how-to-update-execution",
      "comment-vs-execution-update-rulebook",
      "project-lifecycle-status-stage-health",
    ],
  },

};

export function getSituationDefaults(s: BtpmDomainSituation): SituationDefaults | undefined {
  return SITUATION_DEFAULTS[s];
}
