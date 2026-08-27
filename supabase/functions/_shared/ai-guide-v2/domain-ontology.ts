// AI-GUIDE.V2-ARCH.1A — BTPM Domain Ontology (V2-owned).
//
// Controlled vocabularies used by the Domain Diagnosis layer. This file is
// intentionally declarative — no logic, no regex playbooks. The diagnosis
// LLM is constrained to these enums; outputs outside this vocabulary are
// coerced to safe defaults.
//
// Hard separation: must NOT import from supabase/functions/ai-help-chat/*.

export const BTPM_CANONICAL_OBJECTS = [
  "organization",
  "workspace",
  "program",
  "project",
  "phase",
  "task",
  "dependency",
  "risk",
  "blocker",
  "comment",
  "execution_update",
  "kpi_definition",
  "kpi_update",
  "kpi_snapshot",
  "governance_cadence",
  "governance_record",
  "file",
  "sharepoint_output",
  "powerbi_report",
  "status_deck",
  "access_permission",
  "user_invitation",
  "template",
  "roadmap",
  "gantt",
  "agile_backlog",
  "sprint",
  "board",
] as const;
export type BtpmCanonicalObject = (typeof BTPM_CANONICAL_OBJECTS)[number];

export const BTPM_DOMAIN_SITUATIONS = [
  "blocked_work",
  "future_risk",
  "dependency_sequencing",
  // ARCH.1C: predecessor/prior-task wording for a current task that cannot
  // proceed because a related/previous task is not finished.
  "predecessor_or_dependency_blocked_work",
  "task_progress_update",
  // ARCH.1C: user did work that contributes to the project and asks how to
  // report it in BTPM (execution update vs comment vs status).
  "progress_or_contribution_reporting",
  "task_completion_approval_boundary",
  "status_or_health_update",
  "missing_permission",
  "access_request",
  "project_setup",
  "phase_task_planning",
  "baseline_change",
  "governance_evidence_needed",
  // ARCH.1C: user had a planned governance event (SteerCo, review, sponsor
  // check-in) and asks how to report it in BTPM.
  "governance_event_reporting",
  "kpi_value_update",
  "kpi_readiness_issue",
  "sharepoint_boundary",
  "powerbi_reporting_boundary",
  "generated_document_boundary",
  "page_purpose_guidance",
  "concept_explanation",
  "workflow_how_to",
  "live_data_request",
  "action_execution_request",
  "prompt_attack",
  "out_of_scope",
  // AI-GUIDE.V2-QA.3 — domain-boundary specific concept situations.
  "btpm_core_concept",
  "btpm_guide_capability_boundary",
  "kpi_concept",
  "kpi_app_integration_concept",
  "kpi_submission_approval_boundary",
  "kpi_snapshot_concept",
  "powerbi_admin_usage",
  "powerbi_staleness_or_sync_issue",
  "generated_document_source_of_truth_boundary",
  // AI-GUIDE.V2-HUMANQA.1 — human-intent routing.
  "work_structure_modelling_guidance",
  "external_plan_source_boundary",
  "comment_or_execution_update_guidance",
  "guide_or_navigation_reporting_intent",
  // AI-GUIDE.V2-ARCH.1E-FIX.3 — mixed project-health vs KPI guidance question.
  "kpi_project_health_mixed_guidance",
  // AI-GUIDE.V2-ARCH.1E-FIX.3 — explicit task-planning intent (alias of phase_task_planning for arbitration).
  "task_planning_guidance",
] as const;
export type BtpmDomainSituation = (typeof BTPM_DOMAIN_SITUATIONS)[number];

export const BTPM_CORE_DISTINCTIONS = [
  "risk_vs_blocker",
  "dependency_vs_blocker",
  "comment_vs_execution_update",
  "kpi_definition_vs_update_vs_snapshot",
  "governance_cadence_vs_record",
  "baseline_vs_current_plan",
  "btpm_record_vs_exported_document",
  "guide_guidance_vs_live_data_access",
  "verified_workflow_vs_unverified_guidance",
  "page_purpose_vs_click_by_click_workflow",
] as const;
export type BtpmCoreDistinction = (typeof BTPM_CORE_DISTINCTIONS)[number];

export const BTPM_ANSWER_STRATEGIES = [
  "concept_explanation",
  "troubleshooting_guidance",
  "verified_workflow_guidance",
  "unverified_safe_guidance",
  "action_refusal",
  "data_refusal",
  "prompt_refusal",
  "out_of_scope_refusal",
  "clarification",
  "insufficient_knowledge",
] as const;
export type BtpmAnswerStrategy = (typeof BTPM_ANSWER_STRATEGIES)[number];
