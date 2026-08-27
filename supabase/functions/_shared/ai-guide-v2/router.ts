// AI-GUIDE.V2.3 — Deterministic V2 router.
//
// Given a classification + knowledge pack, decide:
//   - answer_mode
//   - whether procedural steps may be generated
//   - whether action/data must be refused
//   - which workflow record (if any) is attached
//
// Deterministic: no LLM calls. No I/O. Pure function over inputs.

import type {
  GuideV2AnswerMode,
  GuideV2DomainDiagnosis,
  GuideV2IntentArbitrationResult,
  GuideV2IntentClassification,
  GuideV2KnowledgePack,
  GuideV2WorkflowRecord,
  GuideV2WorkflowStatus,
} from "./types.ts";
import { findWorkflowById } from "./workflow-registry.ts";

export interface GuideV2RoutingResult {
  answer_mode: GuideV2AnswerMode;
  workflow_id: string | null;
  workflow_status: GuideV2WorkflowStatus | null;
  matched_workflow: GuideV2WorkflowRecord | null;
  route_reason: string;
  can_generate_procedural_steps: boolean;
  must_refuse_data_access: boolean;
  must_refuse_action_execution: boolean;
  requires_safe_limit: boolean;
  knowledge_sufficiency: GuideV2KnowledgePack["knowledge_sufficiency"];
  source_confidence: GuideV2KnowledgePack["source_confidence"];
  next_required_layer: "answer_planner" | "safe_refusal" | "clarification" | "none";
  // ARCH.1E — whether routing used arbitration override
  used_arbitration_override?: boolean;
  arbitration_reason?: string;
  diagnostics?: Record<string, unknown>;
}

export interface RouteInput {
  classification: GuideV2IntentClassification;
  knowledgePack: GuideV2KnowledgePack;
  contextRoute?: string | null;
  contextLabel?: string | null;
  // AI-GUIDE.V2-ARCH.1B — optional domain diagnosis. Used only for non-safety
  // routing nudges (concept vs troubleshooting vs unverified safe-limit when
  // KC support exists). Never overrides safety classifications.
  domainDiagnosis?: GuideV2DomainDiagnosis | null;
  // AI-GUIDE.V2-ARCH.1E — optional arbitration result. When present and
  // should_override_initial_intent is true, router uses the reconciled
  // intent/situation instead of the raw classifier.
  arbitration?: GuideV2IntentArbitrationResult | null;
}

const BASE = {
  workflow_id: null as string | null,
  workflow_status: null as GuideV2WorkflowStatus | null,
  matched_workflow: null as GuideV2WorkflowRecord | null,
  can_generate_procedural_steps: false,
  must_refuse_data_access: false,
  must_refuse_action_execution: false,
  requires_safe_limit: false,
};

export function routeGuideV2Request(input: RouteInput): GuideV2RoutingResult {
  const result = routeGuideV2RequestInternal(input);
  const arb = input.arbitration;
  if (arb && arb.should_override_initial_intent) {
    return {
      ...result,
      used_arbitration_override: true,
      arbitration_reason: arb.override_reason,
      route_reason: `${result.route_reason} | arbitration_override:${arb.initial_intent_type}->${arb.final_intent_type}`,
    };
  }
  return { ...result, used_arbitration_override: false, arbitration_reason: "no_override" };
}

function routeGuideV2RequestInternal(input: RouteInput): GuideV2RoutingResult {
  const { classification, knowledgePack, domainDiagnosis, arbitration } = input;
  const sufficiency = knowledgePack.knowledge_sufficiency;
  const confidence = knowledgePack.source_confidence;
  let intent = classification.intent_type;
  const diagnosticsNote: string[] = [];

  // ARCH.1E: if arbitration says override, use reconciled intent.
  let usedArbitration = false;
  let arbitrationReason = "";
  if (arbitration && arbitration.should_override_initial_intent) {
    intent = arbitration.final_intent_type;
    usedArbitration = true;
    arbitrationReason = arbitration.override_reason;
    diagnosticsNote.push(
      `arbitration_override:${arbitration.initial_intent_type}->${arbitration.final_intent_type}`,
    );
  }


  // ARCH.1B: when the classifier says "unknown" but diagnosis identifies a
  // concrete BTPM situation AND retrieval found KC support, nudge to the
  // matching intent so we plan a real answer instead of insufficient_knowledge.
  // Safety intents (prompt_injection / out_of_scope / data / action) are NOT
  // overridden.
  // ARCH.1B-FIX.3: page_purpose_guidance and boundary explanations are
  // safe diagnosis-grounded concept answers. When diagnosis is confident,
  // route them to concept regardless of KC sufficiency so the deterministic
  // diagnosis-aware renderer can answer (instead of insufficient_knowledge).
  const diagConfident = !!domainDiagnosis && (domainDiagnosis.confidence ?? 0) >= 0.5;
  const conceptSituationsAlwaysAllowed = new Set([
    "page_purpose_guidance",
    "sharepoint_boundary",
    "generated_document_boundary",
    "powerbi_reporting_boundary",
    "concept_explanation",
    // HUMANQA.1/HUMANQA.2 — guidance-intent situations should reach planner
    // even when KC sufficiency is borderline.
    "guide_or_navigation_reporting_intent",
    "comment_or_execution_update_guidance",
    "work_structure_modelling_guidance",
    "external_plan_source_boundary",
    "progress_or_contribution_reporting",
    "phase_task_planning",
    "btpm_core_concept",
    "btpm_guide_capability_boundary",
    "kpi_concept",
    "kpi_app_integration_concept",
    "kpi_submission_approval_boundary",
    "kpi_snapshot_concept",
    "powerbi_admin_usage",
    "powerbi_staleness_or_sync_issue",
    "generated_document_source_of_truth_boundary",
    "status_or_health_update",
    "baseline_change",
  ]);

  if (
    intent === "unknown" &&
    domainDiagnosis &&
    (sufficiency === "sufficient" || sufficiency === "partial" ||
      (diagConfident && conceptSituationsAlwaysAllowed.has(domainDiagnosis.domain_situation)))
  ) {
    const ds = domainDiagnosis.domain_situation;
    const strat = domainDiagnosis.answer_strategy;
    if (strat === "troubleshooting_guidance" || ds === "blocked_work") {
      intent = "troubleshooting";
      diagnosticsNote.push("intent_nudged:unknown->troubleshooting(diagnosis)");
    } else if (strat === "concept_explanation" || ds === "concept_explanation" ||
      ds === "sharepoint_boundary" || ds === "generated_document_boundary" ||
      ds === "powerbi_reporting_boundary" || ds === "page_purpose_guidance" ||
      // HUMANQA.1 — new guidance-intent situations route to concept.
      ds === "guide_or_navigation_reporting_intent" ||
      ds === "comment_or_execution_update_guidance" ||
      ds === "work_structure_modelling_guidance" ||
      ds === "external_plan_source_boundary" ||
      ds === "progress_or_contribution_reporting") {
      intent = "concept";
      diagnosticsNote.push("intent_nudged:unknown->concept(diagnosis)");
    } else if (strat === "verified_workflow_guidance" || strat === "unverified_safe_guidance" ||
      ds === "dependency_sequencing" || ds === "workflow_how_to") {
      intent = "workflow_guidance";
      diagnosticsNote.push("intent_nudged:unknown->workflow_guidance(diagnosis)");
    }
  }


  // 1. prompt_injection
  if (intent === "prompt_injection") {
    return {
      ...BASE,
      answer_mode: "prompt_injection_refusal",
      requires_safe_limit: true,
      knowledge_sufficiency: sufficiency,
      source_confidence: confidence,
      next_required_layer: "safe_refusal",
      route_reason: "intent=prompt_injection → safe refusal, no broad retrieval",
    };
  }

  // 2. out_of_scope
  if (intent === "out_of_scope") {
    return {
      ...BASE,
      answer_mode: "out_of_scope_refusal",
      requires_safe_limit: true,
      knowledge_sufficiency: sufficiency,
      source_confidence: confidence,
      next_required_layer: "safe_refusal",
      route_reason: "intent=out_of_scope → safe refusal",
    };
  }

  // 3. operational_data_request
  if (intent === "operational_data_request") {
    return {
      ...BASE,
      answer_mode: "data_refusal_with_navigation",
      must_refuse_data_access: true,
      knowledge_sufficiency: sufficiency,
      source_confidence: confidence,
      next_required_layer: "safe_refusal",
      route_reason: "intent=operational_data_request → V2 cannot read PM/SharePoint/Power BI data",
    };
  }

  // 4. perform_action_request
  if (intent === "perform_action_request") {
    return {
      ...BASE,
      answer_mode: "action_refusal_with_guidance",
      must_refuse_action_execution: true,
      knowledge_sufficiency: sufficiency,
      source_confidence: confidence,
      next_required_layer: "safe_refusal",
      route_reason: "intent=perform_action_request → V2 cannot perform actions",
    };
  }

  // 5. workflow_guidance
  if (intent === "workflow_guidance") {
    // GUIDE-MODE.0.5: prefer KC-derived verified workflow from the knowledge
    // pack before consulting the hardcoded registry. The KC resolver only
    // returns a record when the matched workflow-card article is visible,
    // published, and parsed to at least one numbered step.
    const kcWf = knowledgePack.matched_workflow;
    if (kcWf && kcWf.status === "verified" && kcWf.steps.length > 0) {
      return {
        ...BASE,
        answer_mode: "verified_workflow",
        workflow_id: kcWf.workflow_id,
        workflow_status: "verified",
        matched_workflow: kcWf,
        can_generate_procedural_steps: true,
        knowledge_sufficiency: sufficiency,
        source_confidence: confidence,
        next_required_layer: "answer_planner",
        route_reason: `KC workflow card matched: ${kcWf.source_articles[0] ?? kcWf.workflow_id}`,
      };
    }
    const wf = findWorkflowById(classification.workflow_id);
    if (wf && wf.status === "verified") {
      return {
        ...BASE,
        answer_mode: "verified_workflow",
        workflow_id: wf.workflow_id,
        workflow_status: "verified",
        matched_workflow: wf,
        can_generate_procedural_steps: true,
        knowledge_sufficiency: sufficiency,
        source_confidence: confidence,
        next_required_layer: "answer_planner",
        route_reason: `verified workflow matched: ${wf.workflow_id}`,
      };
    }
    if (wf && wf.status === "unverified") {
      return {
        ...BASE,
        answer_mode: "unverified_workflow_safe_limit",
        workflow_id: wf.workflow_id,
        workflow_status: "unverified",
        matched_workflow: wf,
        requires_safe_limit: true,
        knowledge_sufficiency: sufficiency,
        source_confidence: confidence,
        next_required_layer: "answer_planner",
        route_reason: `unverified workflow matched: ${wf.workflow_id} → safe-limited KC guidance only`,
      };
    }
    if (wf && wf.status === "unsupported") {
      return {
        ...BASE,
        answer_mode: "unsupported_workflow",
        workflow_id: wf.workflow_id,
        workflow_status: "unsupported",
        matched_workflow: wf,
        requires_safe_limit: true,
        knowledge_sufficiency: sufficiency,
        source_confidence: confidence,
        next_required_layer: "answer_planner",
        route_reason: `unsupported workflow: ${wf.workflow_id}`,
      };
    }
    // workflow_id null OR unknown id → fall back to safe KC concept / safe limit
    if (sufficiency === "sufficient" || sufficiency === "partial") {
      const needsSteps = classification.needs_verified_ui_steps === true;
      return {
        ...BASE,
        answer_mode: needsSteps ? "unverified_workflow_safe_limit" : "kc_concept",
        requires_safe_limit: needsSteps,
        knowledge_sufficiency: sufficiency,
        source_confidence: confidence,
        next_required_layer: "answer_planner",
        route_reason: needsSteps
          ? "workflow_guidance without registry match but UI steps requested → safe limit"
          : "workflow_guidance without registry match → KC concept fallback",
      };
    }
    return {
      ...BASE,
      answer_mode: "insufficient_knowledge",
      requires_safe_limit: true,
      knowledge_sufficiency: sufficiency,
      source_confidence: confidence,
      next_required_layer: "safe_refusal",
      route_reason: "workflow_guidance with no registry match and insufficient KC",
    };
  }

  // 6. concept
  if (intent === "concept") {
    const dsx = domainDiagnosis?.domain_situation ?? "";
    const conceptDiagnosisOverride =
      diagConfident && conceptSituationsAlwaysAllowed.has(dsx);
    if (sufficiency === "sufficient" || sufficiency === "partial" || conceptDiagnosisOverride) {
      return {
        ...BASE,
        answer_mode: "kc_concept",
        knowledge_sufficiency: sufficiency,
        source_confidence: confidence,
        next_required_layer: "answer_planner",
        route_reason: conceptDiagnosisOverride && sufficiency === "insufficient"
          ? `intent=concept; diagnosis(${dsx}) confident → kc_concept despite insufficient KC`
          : "intent=concept with KC support",
      };
    }
    return {
      ...BASE,
      answer_mode: "insufficient_knowledge",
      knowledge_sufficiency: sufficiency,
      source_confidence: confidence,
      next_required_layer: "safe_refusal",
      route_reason: "intent=concept but KC insufficient",
    };
  }

  // 7. troubleshooting
  if (intent === "troubleshooting") {
    // V2.8-FIX.4: in-scope BTPM troubleshooting must always reach the
    // troubleshooting planner so the renderer can produce a safe, non-empty
    // answer (deterministic blocker-aware fallback when KC is thin).
    return {
      ...BASE,
      answer_mode: "troubleshooting",
      knowledge_sufficiency: sufficiency,
      source_confidence: confidence,
      next_required_layer: "answer_planner",
      route_reason:
        sufficiency === "sufficient" || sufficiency === "partial"
          ? "intent=troubleshooting with KC support; no exact UI steps unless verified workflow exists"
          : "intent=troubleshooting with insufficient KC → safe troubleshooting fallback (no invented UI)",
    };
  }

  // 8. unknown
  if (classification.clarification_needed) {
    return {
      ...BASE,
      answer_mode: "insufficient_knowledge",
      knowledge_sufficiency: sufficiency,
      source_confidence: confidence,
      next_required_layer: "clarification",
      route_reason: "intent=unknown and classifier requests clarification",
    };
  }
  return {
    ...BASE,
    answer_mode: "insufficient_knowledge",
    knowledge_sufficiency: sufficiency,
    source_confidence: confidence,
    next_required_layer: "safe_refusal",
    route_reason: "intent=unknown",
  };
}
