// AI-GUIDE.V2-STABILIZE.2-FIX.1 — Effective Decision as the downstream input.
//
// Thin wrappers that make GuideV2EffectiveDecision the single authoritative
// state object consumed by the Knowledge Pack builder, the Router, and the
// Answer Planner. These wrappers synthesize the legacy classification +
// domainDiagnosis shape expected by the existing modules from the canonical
// effective decision, then post-process results to apply the effective
// decision's source priority policy and safe / forbidden navigation.
//
// No LLM calls. No I/O beyond what the wrapped KP builder already performs.
// Deterministic. Never returns raw chunks, embeddings, prompts, secrets,
// provider bodies or operational PM data.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { GuideEmbeddingProviderRuntimeConfig } from "../guideEmbeddingProviderRuntime.ts";
import type {
  GuideV2AnswerPlan,
  GuideV2DomainDiagnosis,
  GuideV2IntentClassification,
  GuideV2KnowledgePack,
  GuideV2KnowledgePackArticle,
} from "./types.ts";
import {
  buildGuideV2KnowledgePack,
  type BuildKnowledgePackResult,
} from "./knowledge-pack.ts";
import { routeGuideV2Request, type GuideV2RoutingResult } from "./router.ts";
import { planGuideV2Answer } from "./answer-planner.ts";
import type {
  GuideV2EffectiveDecision,
} from "./effective-decision.ts";
import type {
  GuideV2EffectivePipelineState,
  GuideV2IntentArbitrationResult,
} from "./intent-arbitration.ts";

// ---------------------------------------------------------------------------
// Synthesis: build classification + diagnosis shape from effective decision
// so wrapped modules read from a single source of truth.
// ---------------------------------------------------------------------------

function synthClassification(
  ed: GuideV2EffectiveDecision,
  original: GuideV2IntentClassification,
): GuideV2IntentClassification {
  return {
    ...original,
    intent_type: ed.effective_intent_type,
    feature_area: ed.effective_feature_area ?? original.feature_area ?? null,
    workflow_id: ed.effective_workflow_id ?? original.workflow_id ?? null,
    is_user_asking_assistant_to_act: ed.asks_assistant_to_act,
    is_user_asking_for_actual_data: ed.needs_live_data,
    needs_verified_ui_steps: ed.needs_verified_ui_steps,
    confidence: ed.confidence,
    clarification_needed: original.clarification_needed,
  };
}

function synthDiagnosis(
  ed: GuideV2EffectiveDecision,
  upstream: GuideV2DomainDiagnosis | null,
): GuideV2DomainDiagnosis {
  // Preserve any upstream fields that effective decision does not carry.
  const base: GuideV2DomainDiagnosis = upstream
    ? { ...upstream }
    : {
        domain_situation: "concept_explanation",
        canonical_objects: [],
        possible_objects: [],
        not_objects: [],
        core_distinctions: [],
        user_goal_domain: "",
        answer_strategy: "unverified_safe_guidance",
        recommended_kc_slugs: [],
        retrieval_hints: { feature_areas: [], keywords: [], route_hints: [] },
        workflow_candidates: [],
        needs_verified_ui_steps: false,
        needs_live_data: false,
        asks_assistant_to_act: false,
        safety_notes: [],
        confidence: 0.5,
        diagnosis_source: "fallback_rule",
        schema_valid: true,
      };
  return {
    ...base,
    domain_situation: (ed.effective_domain_situation as string) ?? base.domain_situation,
    canonical_objects: ed.canonical_objects.length > 0 ? ed.canonical_objects : base.canonical_objects,
    possible_objects: ed.possible_objects.length > 0 ? ed.possible_objects : base.possible_objects,
    core_distinctions: ed.core_distinctions.length > 0 ? ed.core_distinctions : base.core_distinctions,
    answer_strategy: ed.effective_answer_strategy || base.answer_strategy,
    recommended_kc_slugs: ed.recommended_kc_slugs.length > 0 ? ed.recommended_kc_slugs : base.recommended_kc_slugs,
    retrieval_hints: {
      feature_areas: ed.retrieval_hints.feature_areas.length > 0
        ? ed.retrieval_hints.feature_areas : base.retrieval_hints.feature_areas,
      keywords: ed.retrieval_hints.keywords.length > 0
        ? ed.retrieval_hints.keywords : base.retrieval_hints.keywords,
      route_hints: ed.retrieval_hints.route_hints.length > 0
        ? ed.retrieval_hints.route_hints : base.retrieval_hints.route_hints,
    },
    needs_verified_ui_steps: ed.needs_verified_ui_steps,
    needs_live_data: ed.needs_live_data,
    asks_assistant_to_act: ed.asks_assistant_to_act,
    diagnosis_source: "arbitrated+ontology_normalized",
    schema_valid: true,
  };
}

// ---------------------------------------------------------------------------
// Knowledge Pack from Effective Decision
// ---------------------------------------------------------------------------

export interface KpFromEffectiveDecisionInput {
  userClient: SupabaseClient;
  userId: string;
  organizationId: string;
  question: string;
  effectiveDecision: GuideV2EffectiveDecision;
  originalClassification: GuideV2IntentClassification;
  originalDiagnosis: GuideV2DomainDiagnosis | null;
  contextRoute?: string | null;
  contextLabel?: string | null;
  requestId: string;
  // Phase 4D.14A.3D — reuse the same embedding runtime the caller resolved
  // for the initial Knowledge Pack build. Never re-resolved here.
  embeddingRuntime?: GuideEmbeddingProviderRuntimeConfig | null;
}

export interface KpFromEffectiveDecisionResult {
  pack: GuideV2KnowledgePack;
  debug: BuildKnowledgePackResult["debug"];
  effective_decision_signals: {
    built_from_effective_decision: true;
    preferred_slugs: string[];
    preferred_slugs_used: string[];
    suppress_primary_slugs: string[];
    suppress_primary_source_families: string[];
    suppressed_primary_slugs: string[];
    required_source_family: string | null;
    required_source_family_satisfied: boolean;
    promotion_reasons: string[];
  };
}

function familyMatches(slug: string | null, family: string): boolean {
  if (!slug) return false;
  return slug.toLowerCase().includes(family.toLowerCase());
}

export async function buildGuideV2KnowledgePackFromEffectiveDecision(
  input: KpFromEffectiveDecisionInput,
): Promise<KpFromEffectiveDecisionResult> {
  const ed = input.effectiveDecision;
  const synthCls = synthClassification(ed, input.originalClassification);
  const synthDiag = synthDiagnosis(ed, input.originalDiagnosis);

  const built = await buildGuideV2KnowledgePack({
    userClient: input.userClient,
    userId: input.userId,
    organizationId: input.organizationId,
    question: input.question,
    classification: synthCls,
    contextRoute: input.contextRoute ?? null,
    contextLabel: input.contextLabel ?? null,
    requestId: input.requestId,
    domainDiagnosis: synthDiag,
    embeddingRuntime: input.embeddingRuntime ?? null,
  });

  const pack = built.pack;
  const policy = ed.source_priority_policy;
  const preferred = policy.preferred_slugs.map((s) => s.toLowerCase());
  const suppressSlugs = policy.suppress_primary_slugs.map((s) => s.toLowerCase());
  const suppressFamilies = policy.suppress_primary_source_families.map((s) => s.toLowerCase());
  const requiredFamily = policy.required_source_family
    ? policy.required_source_family.toLowerCase()
    : null;

  const promotionReasons: string[] = [];
  const preferredUsed: string[] = [];
  const suppressedFromPrimary: string[] = [];

  // 1. Demote suppressed primary slugs / families into supporting.
  const keepPrimary: GuideV2KnowledgePackArticle[] = [];
  const demoted: GuideV2KnowledgePackArticle[] = [];
  for (const a of pack.primary_articles) {
    const slug = (a.slug || "").toLowerCase();
    if (suppressSlugs.includes(slug)) {
      demoted.push(a);
      suppressedFromPrimary.push(slug);
      promotionReasons.push(`effective_decision_suppressed_broad_primary_source:${slug}`);
      continue;
    }
    if (suppressFamilies.some((f) => familyMatches(slug, f))) {
      demoted.push(a);
      suppressedFromPrimary.push(slug);
      promotionReasons.push(`effective_decision_suppressed_broad_primary_source_family:${slug}`);
      continue;
    }
    keepPrimary.push(a);
  }
  let newPrimary = keepPrimary;
  let newSupporting = [...pack.supporting_articles, ...demoted];

  // 2. Promote preferred slugs from supporting into primary if visible.
  if (preferred.length > 0) {
    const inPrimary = new Set(newPrimary.map((a) => (a.slug || "").toLowerCase()));
    const promotedFromSupport: GuideV2KnowledgePackArticle[] = [];
    const remainingSupport: GuideV2KnowledgePackArticle[] = [];
    for (const a of newSupporting) {
      const slug = (a.slug || "").toLowerCase();
      if (preferred.includes(slug) && !inPrimary.has(slug)) {
        promotedFromSupport.push(a);
        preferredUsed.push(slug);
        promotionReasons.push(`effective_decision_preferred_slug_promoted:${slug}`);
        inPrimary.add(slug);
      } else {
        remainingSupport.push(a);
      }
    }
    // Reorder primary so promoted preferred sit first, capped at 3.
    const orderedPreferredPrimary: GuideV2KnowledgePackArticle[] = [];
    const otherPrimary: GuideV2KnowledgePackArticle[] = [];
    for (const a of [...promotedFromSupport, ...newPrimary]) {
      const slug = (a.slug || "").toLowerCase();
      if (preferred.includes(slug)) {
        if (!preferredUsed.includes(slug)) preferredUsed.push(slug);
        orderedPreferredPrimary.push(a);
      } else {
        otherPrimary.push(a);
      }
    }
    newPrimary = [...orderedPreferredPrimary, ...otherPrimary].slice(0, 3);
    newSupporting = remainingSupport;
  }

  // 3. Required source family: ensure at least one primary slug matches.
  let requiredSatisfied = true;
  if (requiredFamily) {
    requiredSatisfied = newPrimary.some((a) => familyMatches(a.slug, requiredFamily));
    if (!requiredSatisfied) {
      // Try to promote first supporting that matches the family.
      const idx = newSupporting.findIndex((a) => familyMatches(a.slug, requiredFamily));
      if (idx >= 0) {
        const promoted = newSupporting.splice(idx, 1)[0];
        newPrimary = [promoted, ...newPrimary].slice(0, 3);
        promotionReasons.push(`effective_decision_source_family_required:${requiredFamily}`);
        requiredSatisfied = true;
      }
    }
  }

  const finalPack: GuideV2KnowledgePack = {
    ...pack,
    primary_articles: newPrimary,
    supporting_articles: newSupporting.slice(0, 5),
    metadata_signals: {
      ...(pack.metadata_signals as Record<string, unknown>),
      built_from_effective_decision: true,
      effective_decision_preferred_slugs_used: preferredUsed,
      effective_decision_suppressed_primary_slugs: suppressedFromPrimary,
      effective_decision_required_source_family: requiredFamily,
      effective_decision_required_source_family_satisfied: requiredSatisfied,
      effective_decision_source_priority_applied: promotionReasons,
    },
  };

  return {
    pack: finalPack,
    debug: built.debug,
    effective_decision_signals: {
      built_from_effective_decision: true,
      preferred_slugs: policy.preferred_slugs,
      preferred_slugs_used: preferredUsed,
      suppress_primary_slugs: policy.suppress_primary_slugs,
      suppress_primary_source_families: policy.suppress_primary_source_families,
      suppressed_primary_slugs: suppressedFromPrimary,
      required_source_family: policy.required_source_family ?? null,
      required_source_family_satisfied: requiredSatisfied,
      promotion_reasons: promotionReasons,
    },
  };
}

// ---------------------------------------------------------------------------
// Router from Effective Decision
// ---------------------------------------------------------------------------

export interface RouteFromEffectiveDecisionInput {
  effectiveDecision: GuideV2EffectiveDecision;
  knowledgePack: GuideV2KnowledgePack;
  originalClassification: GuideV2IntentClassification;
  originalDiagnosis: GuideV2DomainDiagnosis | null;
  arbitration: GuideV2IntentArbitrationResult | null;
  contextRoute?: string | null;
  contextLabel?: string | null;
}

export function routeGuideV2RequestFromEffectiveDecision(
  input: RouteFromEffectiveDecisionInput,
): GuideV2RoutingResult & { routed_from_effective_decision: true } {
  const ed = input.effectiveDecision;
  const synthCls = synthClassification(ed, input.originalClassification);
  const synthDiag = synthDiagnosis(ed, input.originalDiagnosis);
  const result = routeGuideV2Request({
    classification: synthCls,
    knowledgePack: input.knowledgePack,
    contextRoute: input.contextRoute ?? null,
    contextLabel: input.contextLabel ?? null,
    domainDiagnosis: synthDiag,
    arbitration: input.arbitration,
  });
  return {
    ...result,
    routed_from_effective_decision: true,
    diagnostics: {
      ...(result.diagnostics ?? {}),
      effective_decision_intent_type: ed.effective_intent_type,
      effective_decision_situation: ed.effective_domain_situation,
      effective_decision_source: ed.decision_source,
    },
  };
}

// ---------------------------------------------------------------------------
// Answer Planner from Effective Decision
// ---------------------------------------------------------------------------

export interface PlanFromEffectiveDecisionInput {
  question: string;
  effectiveDecision: GuideV2EffectiveDecision;
  routingResult: GuideV2RoutingResult;
  knowledgePack: GuideV2KnowledgePack;
  originalClassification: GuideV2IntentClassification;
  originalDiagnosis: GuideV2DomainDiagnosis | null;
  contextRoute?: string | null;
  contextLabel?: string | null;
}

export interface PlanFromEffectiveDecisionResult {
  plan: GuideV2AnswerPlan;
  effective_decision_signals: {
    planned_from_effective_decision: true;
    safe_navigation_source: "effective_decision" | "planner_default";
    forbidden_navigation_applied: boolean;
    primary_area: string | null;
  };
}

function dedupePush(target: string[], items: string[]): void {
  const seen = new Set(target.map((s) => s.toLowerCase()));
  for (const it of items) {
    if (!it) continue;
    const k = it.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    target.push(it);
  }
}

export function planGuideV2AnswerFromEffectiveDecision(
  input: PlanFromEffectiveDecisionInput,
): PlanFromEffectiveDecisionResult {
  const ed = input.effectiveDecision;
  const synthCls = synthClassification(ed, input.originalClassification);
  const synthDiag = synthDiagnosis(ed, input.originalDiagnosis);
  const basePlan = planGuideV2Answer({
    classification: synthCls,
    knowledgePack: input.knowledgePack,
    routingResult: input.routingResult,
    contextRoute: input.contextRoute ?? null,
    contextLabel: input.contextLabel ?? null,
    domainDiagnosis: synthDiag,
    question: input.question,
  });

  const plan: GuideV2AnswerPlan = { ...basePlan };
  let safeNavSource: "effective_decision" | "planner_default" = "planner_default";
  let forbiddenApplied = false;

  // Override navigation_guidance with effective decision's safe_navigation
  // when present. The planner's value (often a broad article route) loses
  // to the canonical effective decision per STABILIZE.2-FIX.1.
  const safeNav = ed.safe_navigation;
  if (safeNav.primary_area) {
    const path = safeNav.user_facing_path.length > 0
      ? safeNav.user_facing_path.join(" → ")
      : safeNav.primary_area;
    plan.navigation_guidance = path;
    safeNavSource = "effective_decision";
    const must: string[] = Array.isArray(plan.must_say) ? [...plan.must_say] : [];
    dedupePush(must, [
      `Primary BTPM area for this situation: ${safeNav.primary_area}.`,
    ]);
    if (safeNav.secondary_areas.length > 0) {
      dedupePush(must, [
        `Secondary areas that may apply: ${safeNav.secondary_areas.join(", ")}.`,
      ]);
    }
    plan.must_say = must;
  }

  // Inject forbidden phrases / areas into must_not_say so the renderer is
  // blocked from generating them. Pipeline invariants remain the last-resort
  // safety gate if the renderer still emits a forbidden phrase.
  const forbidden = ed.forbidden_navigation;
  const mustNot: string[] = Array.isArray(plan.must_not_say) ? [...plan.must_not_say] : [];
  if (forbidden.forbidden_phrases.length > 0) {
    dedupePush(mustNot, forbidden.forbidden_phrases);
    forbiddenApplied = true;
  }
  if (forbidden.forbidden_primary_areas.length > 0) {
    dedupePush(mustNot, forbidden.forbidden_primary_areas.map(
      (a) => `Do not present ${a} as the primary area for this situation.`,
    ));
    forbiddenApplied = true;
  }
  plan.must_not_say = mustNot;

  // Surface effective decision's source priority notes for transparency.
  const notes: string[] = Array.isArray(plan.source_priority_notes)
    ? [...plan.source_priority_notes]
    : [];
  if (ed.source_priority_policy.preferred_slugs.length > 0) {
    dedupePush(notes, [
      `Preferred sources for this situation: ${ed.source_priority_policy.preferred_slugs.join(", ")}.`,
    ]);
  }
  plan.source_priority_notes = notes;

  return {
    plan,
    effective_decision_signals: {
      planned_from_effective_decision: true,
      safe_navigation_source: safeNavSource,
      forbidden_navigation_applied: forbiddenApplied,
      primary_area: safeNav.primary_area,
    },
  };
}
