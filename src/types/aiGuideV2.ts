// AI-GUIDE.V2.0 — V2 contracts (skeleton only, not wired to runtime)
// These types freeze the public contract for BTPM Guide V2.
// V1 runtime (supabase/functions/ai-help-chat) must not import from this file.

export type GuideV2IntentType =
  | "workflow_guidance"
  | "concept"
  | "troubleshooting"
  | "operational_data_request"
  | "perform_action_request"
  | "prompt_injection"
  | "out_of_scope"
  | "unknown";

export interface GuideV2IntentClassification {
  intent_type: GuideV2IntentType;
  feature_area: string | null;
  workflow_id: string | null;
  user_goal: string;
  is_user_asking_assistant_to_act: boolean;
  is_user_asking_for_actual_data: boolean;
  needs_verified_ui_steps: boolean;
  confidence: number;
  clarification_needed: boolean;
  clarification_question?: string;
}

export type GuideV2AnswerMode =
  | "verified_workflow"
  | "unverified_workflow_safe_limit"
  | "unsupported_workflow"
  | "kc_concept"
  | "troubleshooting"
  | "data_refusal_with_navigation"
  | "action_refusal_with_guidance"
  | "prompt_injection_refusal"
  | "out_of_scope_refusal"
  | "insufficient_knowledge";

export type GuideV2WorkflowStatus = "verified" | "unverified" | "unsupported";

export interface GuideV2WorkflowStep {
  order: number;
  instruction: string;
  ui_control?: string;
  expected_result?: string;
}

export interface GuideV2WorkflowRecord {
  workflow_id: string;
  title: string;
  feature_area: string;
  status: GuideV2WorkflowStatus;
  route_patterns: string[];
  path: string[];
  steps: GuideV2WorkflowStep[];
  not_supported: string[];
  permission_notes: string[];
  if_missing_control: string;
  next_suggestions: string[];
  source_articles: string[];
  verification_source: string;
  last_verified_step: string;
}

export type GuideV2ChunkSourceType =
  | "knowledge_article"
  | "article_summary"
  | "question_example"
  | "workflow"
  | "troubleshooting"
  | "answer_rule";

export interface GuideV2KnowledgeChunk {
  chunk_id: string;
  source_type: GuideV2ChunkSourceType;
  source_id: string;
  article_id?: string;
  article_slug?: string;
  title: string;
  text: string;
  metadata: Record<string, unknown>;
  visibility_scope: string;
  content_hash: string;
  embedding_model?: string;
  vector_ready: boolean;
}

export interface GuideV2KnowledgePackArticle {
  article_id: string;
  slug: string;
  title: string;
  article_type: string | null;
  category_slug: string | null;
  related_route: string | null;
  source_confidence: "high" | "medium" | "low";
  matched_source_types: string[];
  best_similarity: number;
  best_hybrid_score: number;
  route_match: boolean;
  feature_match: boolean;
  workflow_match: boolean;
}

export interface GuideV2KnowledgePack {
  primary_articles: GuideV2KnowledgePackArticle[];
  supporting_articles: GuideV2KnowledgePackArticle[];
  metadata_signals: Record<string, unknown>;
  route_context: { route: string | null; label: string | null };
  matched_workflow: GuideV2WorkflowRecord | null;
  source_confidence: "high" | "medium" | "low";
  knowledge_sufficiency: "sufficient" | "partial" | "insufficient";
  retrieval_strategy: "vector" | "hybrid" | "metadata" | "fallback";
  excluded_sources: { source_id: string; reason: string }[];
}


export interface GuideV2GuidedCard {
  card_type: "workflow" | "concept" | "troubleshooting" | "safe_limit" | "refusal";
  title: string;
  path: string[];
  steps: GuideV2WorkflowStep[];
  current_page_hint: string | null;
  permission_note: string | null;
  if_missing_control: string | null;
  next_suggestions: string[];
  sources: { article_id: string; title: string; slug: string }[];
}

export interface GuideV2AnswerPlan {
  answer_mode: GuideV2AnswerMode;
  title: string;
  opening: string;
  allowed_steps: GuideV2WorkflowStep[];
  must_say: string[];
  must_not_say: string[];
  safe_limit_reason: string | null;
  navigation_guidance: string | null;
  permission_note: string | null;
  source_of_truth_note: string | null;
  sources: { article_id: string; title: string; slug: string }[];
  next_suggestions: string[];
  guided_card: GuideV2GuidedCard | null;
  grounding_snippets?: { article_id: string; title: string; slug: string; snippet: string }[];
  // ARCH.1D — domain guidance points for unverified safe-limit modes.
  safe_guidance_points?: string[];
  // QA.4 — concept-answer shape obligations.
  concept_answer_shape?:
    | "definition"
    | "comparison"
    | "page_purpose"
    | "decision_rule"
    | "troubleshooting_explanation"
    | "safe_unverified_workflow_guidance"
    | null;
  key_definitions?: { term: string; meaning?: string }[];
  practical_distinctions?: string[];
  decision_rules?: string[];
  safe_examples?: string[];
  common_boundaries?: string[];
  source_priority_notes?: string[];
}

export interface GuideV2ValidationResult {
  ok: boolean;
  severity: "pass" | "warn" | "fail";
  violations: string[];
  unsupported_claims: string[];
  speculative_ui_claims: string[];
  operational_data_claims: string[];
  action_completion_claims: string[];
  internal_leakage_claims: string[];
  source_mismatch_claims: string[];
  final_action: "return" | "regenerate_once" | "fail_closed";
  safe_fallback_answer?: string;
  diagnostics?: Record<string, unknown>;
}

export interface GuideV2ResponsePayload {
  ok: boolean;
  conversation_id: string | null;
  answer: string;
  answer_mode: GuideV2AnswerMode | null;
  classification: GuideV2IntentClassification | null;
  knowledge_pack_summary: {
    primary_count: number;
    supporting_count: number;
    retrieval_strategy: GuideV2KnowledgePack["retrieval_strategy"];
    source_confidence: GuideV2KnowledgePack["source_confidence"];
    knowledge_sufficiency: GuideV2KnowledgePack["knowledge_sufficiency"];
  } | null;
  answer_plan: GuideV2AnswerPlan | null;
  validation: GuideV2ValidationResult | null;
  sources: { article_id: string; title: string; slug: string }[];
  guided_mode_available: boolean;
  guided_card: GuideV2GuidedCard | null;
  error?: string;
}

// AI-GUIDE.V2-ARCH.1A — Domain Diagnosis contract (client mirror).
export interface GuideV2DomainDiagnosis {
  domain_situation: string;
  canonical_objects: string[];
  possible_objects: string[];
  not_objects: string[];
  core_distinctions: string[];
  user_goal_domain: string;
  answer_strategy: string;
  recommended_kc_slugs: string[];
  retrieval_hints: {
    feature_areas: string[];
    keywords: string[];
    route_hints: string[];
  };
  workflow_candidates: string[];
  needs_verified_ui_steps: boolean;
  needs_live_data: boolean;
  asks_assistant_to_act: boolean;
  safety_notes: string[];
  confidence: number;
  diagnosis_source:
    | "llm_structured"
    | "fallback_rule"
    | "llm_structured+coerced"
    | "arbitrated+ontology_normalized";
  schema_valid: boolean;
}

// AI-GUIDE.V2-ARCH.1E — Evidence-aware intent arbitration result (client mirror).
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
  arbitration_source: "deterministic" | "deterministic_with_llm_adjudication" | "no_override";
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

// AI-GUIDE.V2-STABILIZE.2 — Canonical Effective Decision (client mirror).
export interface GuideV2EffectiveDecision {
  original_intent_type: GuideV2IntentType;
  original_feature_area: string | null;
  original_workflow_id: string | null;
  original_domain_situation: string | null;
  original_answer_strategy: string | null;
  effective_intent_type: GuideV2IntentType;
  effective_feature_area: string | null;
  effective_workflow_id: string | null;
  effective_domain_situation: string | null;
  effective_answer_strategy: string;
  canonical_objects: string[];
  possible_objects: string[];
  core_distinctions: string[];
  recommended_kc_slugs: string[];
  retrieval_hints: { feature_areas: string[]; keywords: string[]; route_hints: string[] };
  source_priority_policy: {
    preferred_slugs: string[];
    suppress_primary_slugs: string[];
    suppress_primary_source_families: string[];
    required_source_family?: string | null;
  };
  safe_navigation: { primary_area: string | null; secondary_areas: string[]; user_facing_path: string[] };
  forbidden_navigation: { forbidden_primary_areas: string[]; forbidden_phrases: string[] };
  safety_mode: {
    must_refuse_data_access: boolean;
    must_refuse_action_execution: boolean;
    must_refuse_prompt_or_secret_access: boolean;
    may_answer_with_safe_guidance: boolean;
    may_generate_verified_steps: boolean;
  };
  needs_live_data: boolean;
  asks_assistant_to_act: boolean;
  needs_verified_ui_steps: boolean;
  decision_source: "original" | "deterministic_normalized" | "arbitration_recovered" | "safety_veto";
  decision_reason: string;
  confidence: number;
  trace_notes: string[];
}
