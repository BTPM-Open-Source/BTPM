// AI-GUIDE.V2.2 — Hybrid Knowledge Pack Builder.
//
// Pipeline:
//   1. Decide retrieval need from classification.intent_type.
//   2. Embed the question (text-embedding-3-small @ 1536).
//   3. Call ai_guide_v2_match_knowledge_chunks (RLS-enforced).
//   4. Aggregate chunk candidates to article-level candidates.
//   5. Re-resolve visibility through list_decrypted_knowledge_articles
//      so vector rows never become final authorization.
//   6. Score source_confidence + knowledge_sufficiency.
//   7. Emit GuideV2KnowledgePack with metadata signals + excluded sources.
//
// Hard rules:
//   - never returns raw chunk text.
//   - never returns embeddings.
//   - never reads operational PM / SharePoint / Power BI content.
//   - vector index is NOT treated as final source authorization.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  GuideV2DomainDiagnosis,
  GuideV2IntentClassification,
  GuideV2KnowledgePack,
  GuideV2KnowledgePackArticle,
  GuideV2WorkflowRecord,
} from "./types.ts";
import { embedGuideV2Texts } from "./embedding-provider.ts";
import type { GuideEmbeddingProviderRuntimeConfig } from "../guideEmbeddingProviderRuntime.ts";
import {
  matchKnowledgeChunks,
  type VectorChunkCandidate,
} from "./vector-retrieval.ts";
import {
  buildKcWorkflowRecordFromCard,
  isWorkflowCardSlug,
  selectKcWorkflowCardDetailed,
  type KcWorkflowCardArticle,
} from "./kc-workflow-card-resolver.ts";

const EMBED_MODEL_LABEL = "text-embedding-3-small@1536";
const RETRIEVAL_FETCH_COUNT = 30;
const MIN_SIMILARITY = 0.0;
const PRIMARY_MAX = 3;
const SUPPORTING_MAX = 5;
const HIGH_SIM_THRESHOLD = 0.6;
const MEDIUM_SIM_THRESHOLD = 0.45;
const LOW_SIM_THRESHOLD = 0.3;
// V2.2-FIX: stricter supporting-source thresholds.
const SUPPORTING_MIN_HYBRID = 0.4;
const SUPPORTING_MIN_SIMILARITY = 0.45;
// V2.2-FIX.2: primary-source relevance gating thresholds.
const PRIMARY_MIN_HYBRID = 0.4;
const PRIMARY_STRONG_SIMILARITY = 0.65;

// AI-GUIDE.V2-QA.2: broad concept articles that previously polluted answers
// about unrelated topics (Agile, RACI, KPI, Power BI, etc.). They remain
// fully indexed/visible, but are demoted out of the final primary/supporting
// list unless the active domain_situation explicitly recommends them.
const GENERIC_BROAD_SLUGS = new Set<string>([
  "project-lifecycle-status-stage-health",
  "project-baseline-vs-current-plan",
]);

// Source types that count as positive evidence on their own.
// `metadata_forbidden_claim` is intentionally excluded — it's a validation
// signal, not a positive relevance signal.
const POSITIVE_SOURCE_TYPES = new Set<string>([
  "knowledge_article_title",
  "knowledge_article_summary",
  "knowledge_article_tooltip",
  "knowledge_article_body_chunk",
  "metadata_question_example",
  "metadata_answer_rule",
  "metadata_synonym",
]);

export interface BuildKnowledgePackInput {
  userClient: SupabaseClient;
  userId: string;
  organizationId: string;
  question: string;
  classification: GuideV2IntentClassification;
  contextRoute?: string | null;
  contextLabel?: string | null;
  requestId: string;
  // AI-GUIDE.V2-ARCH.1B — optional diagnosis-driven hints (slugs, feature
  // areas, canonical objects). Hints supplement pgvector retrieval — they
  // never bypass visibility/RLS resolution.
  domainDiagnosis?: GuideV2DomainDiagnosis | null;
  // Phase 4D.14A.3D — request-scoped embedding runtime supplied by the
  // caller. Required whenever retrieval will actually run. Absent runtime
  // during a retrieval path is treated as a safe insufficient-pack fallback
  // (never falls back to Global env credentials).
  embeddingRuntime?: GuideEmbeddingProviderRuntimeConfig | null;
}

export interface CandidateFlowRow {
  rank: number;
  article_id: string | null;
  title: string | null;
  slug: string | null;
  tier:
    | "primary"
    | "supporting"
    | "excluded"
    | "diagnosis_injected_excluded"
    | "pre_visibility_excluded";
  source_types: string[];
  similarity: number;
  hybrid_score: number;
  source_confidence: string | null;
  feature_match: boolean;
  workflow_match: boolean;
  route_match: boolean;
  diagnosis_slug_match: boolean;
  chunk_count: number;
  came_from_vector: boolean;
  came_from_diagnosis: boolean;
  visible_after_rls: boolean;
  matched_reasons: string[];
  excluded_reason: string | null;
  exclusion_detail: Record<string, unknown> | null;
}

export interface DiagnosisSlugResolutionRow {
  slug: string;
  resolved_visible: boolean;
  article_id: string | null;
  title: string | null;
  article_status: string | null;
  included_in_pack: boolean;
  included_tier: "primary" | "supporting" | "excluded" | "not_included";
  reason: string;
}

export interface KnowledgePackDebug {
  embedding_ms: number;
  vector_match_ms: number;
  visibility_resolution_ms: number;
  candidates_seen: number;
  articles_after_aggregation: number;
  articles_after_visibility: number;
  excluded_sources: { source_id: string; reason: string }[];
  retrieval_inputs: Record<string, unknown>;
  thresholds: Record<string, number>;
  candidate_flow: CandidateFlowRow[];
  diagnosis_slug_resolution: DiagnosisSlugResolutionRow[];
  workflow_catalog?: {
    visible_workflow_articles: number;
    metadata_ready_count: number;
    metadata_missing_slugs: string[];
    catalog_entries: number;
    selected_workflow_slug: string | null;
    selected_workflow_frame: Record<string, unknown> | null;
    dispatch_kind: string | null;
    rejected_workflow_candidates: Array<{ slug: string; reason: string }>;
  };
}

export interface BuildKnowledgePackResult {
  pack: GuideV2KnowledgePack;
  debug: KnowledgePackDebug;
}

export async function buildGuideV2KnowledgePack(
  input: BuildKnowledgePackInput,
): Promise<BuildKnowledgePackResult> {
  const excluded: { source_id: string; reason: string }[] = [];
  const debug: KnowledgePackDebug = {
    embedding_ms: 0,
    vector_match_ms: 0,
    visibility_resolution_ms: 0,
    candidates_seen: 0,
    articles_after_aggregation: 0,
    articles_after_visibility: 0,
    excluded_sources: excluded,
    retrieval_inputs: {
      intent_type: input.classification.intent_type,
      feature_area: input.classification.feature_area,
      workflow_id: input.classification.workflow_id,
      context_route: input.contextRoute ?? null,
      diagnosis_situation: input.domainDiagnosis?.domain_situation ?? null,
      diagnosis_recommended_kc_slugs: input.domainDiagnosis?.recommended_kc_slugs ?? [],
      diagnosis_canonical_objects: input.domainDiagnosis?.canonical_objects ?? [],
      diagnosis_possible_objects: input.domainDiagnosis?.possible_objects ?? [],
      diagnosis_core_distinctions: input.domainDiagnosis?.core_distinctions ?? [],
      diagnosis_workflow_candidates: input.domainDiagnosis?.workflow_candidates ?? [],
      retrieval_hint_feature_areas: input.domainDiagnosis?.retrieval_hints?.feature_areas ?? [],
      retrieval_hint_keywords: input.domainDiagnosis?.retrieval_hints?.keywords ?? [],
      retrieval_hint_route_hints: input.domainDiagnosis?.retrieval_hints?.route_hints ?? [],
    },
    thresholds: {
      RETRIEVAL_FETCH_COUNT,
      MIN_SIMILARITY,
      PRIMARY_MAX,
      SUPPORTING_MAX,
      LOW_SIM_THRESHOLD,
      MEDIUM_SIM_THRESHOLD,
      HIGH_SIM_THRESHOLD,
      SUPPORTING_MIN_HYBRID,
      SUPPORTING_MIN_SIMILARITY,
      PRIMARY_MIN_HYBRID,
      PRIMARY_STRONG_SIMILARITY,
    },
    candidate_flow: [],
    diagnosis_slug_resolution: [],
  };

  const route_context = {
    route: input.contextRoute ?? null,
    label: input.contextLabel ?? null,
  };

  // --- 1. Decide retrieval strategy ---------------------------------------
  const intent = input.classification.intent_type;
  const noBroadRetrieval =
    intent === "prompt_injection" || intent === "out_of_scope";
  const operationalRefusal =
    intent === "operational_data_request" || intent === "perform_action_request";

  if (noBroadRetrieval) {
    return {
      pack: emptyPack({
        route_context,
        retrieval_strategy: "fallback",
        source_confidence: "high",
        knowledge_sufficiency: "sufficient",
        metadata_signals: {
          intent_type: intent,
          retrieval_strategy: "fallback",
          reason: "no_broad_retrieval_for_intent",
        },
        excluded,
      }),
      debug,
    };
  }

  // --- 2. Embed question ---------------------------------------------------
  const tEmbed = Date.now();
  if (!input.embeddingRuntime) {
    return {
      pack: emptyPack({
        route_context,
        retrieval_strategy: "fallback",
        source_confidence: "low",
        knowledge_sufficiency: "insufficient",
        metadata_signals: {
          intent_type: intent,
          retrieval_strategy: "fallback",
          embed_error: "embedding_runtime_unavailable",
        },
        excluded,
      }),
      debug,
    };
  }
  const embedRes = await embedGuideV2Texts({
    texts: [input.question],
    modelLabel: EMBED_MODEL_LABEL,
    dimensions: 1536,
    requestId: input.requestId,
    runtime: input.embeddingRuntime,
  });
  debug.embedding_ms = Date.now() - tEmbed;
  if (!embedRes.ok || !embedRes.embeddings?.[0]) {
    return {
      pack: emptyPack({
        route_context,
        retrieval_strategy: "fallback",
        source_confidence: "low",
        knowledge_sufficiency: "insufficient",
        metadata_signals: {
          intent_type: intent,
          retrieval_strategy: "fallback",
          embed_error: embedRes.error?.code ?? "unknown",
        },
        excluded,
      }),
      debug,
    };
  }

  // --- 3. Vector retrieval (RPC, RLS-enforced) -----------------------------
  // ARCH.1B: feed diagnosis feature_area hints into the RPC as a UNION with
  // the classifier feature_area so retrieval can pull diagnosis-aligned content
  // without bypassing RLS or pgvector ranking.
  const featureAreas = new Set<string>();
  if (input.classification.feature_area) featureAreas.add(input.classification.feature_area);
  if (input.domainDiagnosis?.retrieval_hints?.feature_areas) {
    for (const fa of input.domainDiagnosis.retrieval_hints.feature_areas) {
      if (fa) featureAreas.add(fa);
    }
  }
  const matchRes = await matchKnowledgeChunks({
    client: input.userClient,
    organizationId: input.organizationId,
    userId: input.userId,
    queryEmbedding: embedRes.embeddings[0],
    route: input.contextRoute ?? null,
    featureArea: featureAreas.size > 0 ? Array.from(featureAreas) : null,
    intentType: input.classification.intent_type,
    workflowId: input.classification.workflow_id,
    matchCount: RETRIEVAL_FETCH_COUNT,
    minSimilarity: MIN_SIMILARITY,
  });
  debug.vector_match_ms = matchRes.elapsed_ms;
  debug.candidates_seen = matchRes.candidates.length;

  if (!matchRes.ok) {
    return {
      pack: emptyPack({
        route_context,
        retrieval_strategy: "fallback",
        source_confidence: "low",
        knowledge_sufficiency: "insufficient",
        metadata_signals: {
          intent_type: intent,
          retrieval_strategy: "fallback",
          match_error: matchRes.error ?? "unknown",
        },
        excluded,
      }),
      debug,
    };
  }

  // --- 4. Aggregate chunks → article-level candidates ----------------------
  const aggregated = aggregateByArticle(matchRes.candidates, excluded);
  debug.articles_after_aggregation = aggregated.length;

  // --- 5. Re-resolve visibility through KC ---------------------------------
  const tVis = Date.now();
  const visibleArticles = await listVisibleArticleMap(input.userClient);
  const workflowMetadataStatus = await attachWorkflowMetadataForVisibleArticles(input.userClient, visibleArticles);
  debug.visibility_resolution_ms = Date.now() - tVis;

  const articles: GuideV2KnowledgePackArticle[] = [];
  for (const c of aggregated) {
    if (!c.article_id) {
      excluded.push({ source_id: c.slug ?? c.title ?? "unknown", reason: "missing_article_id" });
      continue;
    }
    const visible = visibleArticles.get(c.article_id);
    if (!visible) {
      excluded.push({ source_id: c.article_id, reason: "visibility_not_confirmed" });
      continue;
    }
    if (visible.archived_at) {
      excluded.push({ source_id: c.article_id, reason: "archived" });
      continue;
    }
    if (visible.status !== "published") {
      excluded.push({ source_id: c.article_id, reason: "draft" });
      continue;
    }
    if (visible.article_type === "integration_placeholder") {
      excluded.push({ source_id: c.article_id, reason: "placeholder" });
      continue;
    }
    articles.push({
      article_id: c.article_id,
      slug: visible.slug,
      title: visible.title,
      article_type: visible.article_type,
      category_slug: null,
      related_route: visible.related_route,
      source_confidence: scoreSourceConfidence(c),
      matched_source_types: Array.from(c.matched_source_types).sort(),
      best_similarity: c.best_similarity,
      best_hybrid_score: c.best_hybrid_score,
      route_match: c.route_match,
      feature_match: c.feature_match,
      workflow_match: c.workflow_match,
      summary: visible.summary,
      body_excerpt: visible.body_excerpt,
    });
  }
  debug.articles_after_visibility = articles.length;

  // --- 6. Rank + split primary / supporting --------------------------------
  articles.sort((a, b) => {
    const confRank = confidenceWeight(b.source_confidence) - confidenceWeight(a.source_confidence);
    if (confRank !== 0) return confRank;
    if (b.best_hybrid_score !== a.best_hybrid_score) {
      return b.best_hybrid_score - a.best_hybrid_score;
    }
    return b.best_similarity - a.best_similarity;
  });

  // ARCH.1B-REFINE: resolve diagnosis-recommended slugs DIRECTLY against the
  // visible/published Knowledge Center map (RLS-enforced via the same RPC the
  // KC drawer uses). Visible matches are injected into the article pool even
  // if pgvector retrieval did not return them. Unresolved slugs are excluded
  // with a clear reason. We never bypass visibility/RLS.
  const recommendedSlugs = (input.domainDiagnosis?.recommended_kc_slugs ?? [])
    .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
    .filter((s) => s.length > 0);
  const diagnosisBoostedIds = new Set<string>();
  if (recommendedSlugs.length > 0) {
    // Build slug -> visible article index from the already RLS/visibility/
    // publish-status-resolved map.
    const visibleBySlug = new Map<string, VisibleArticle>();
    for (const v of visibleArticles.values()) {
      if (v.slug) visibleBySlug.set(v.slug.toLowerCase(), v);
    }
    const presentIds = new Set(articles.map((a) => a.article_id));
    const resolvedSlugs = new Set<string>();
    // First, tag any already-present article that matches a recommended slug.
    for (const a of articles) {
      if (recommendedSlugs.includes((a.slug || "").toLowerCase())) {
        diagnosisBoostedIds.add(a.article_id);
        resolvedSlugs.add((a.slug || "").toLowerCase());
        a.matched_source_types = Array.from(
          new Set([...a.matched_source_types, "diagnosis_recommended_slug"]),
        ).sort();
      }
    }
    // Then, inject visible articles for any recommended slug NOT yet present.
    for (const slug of recommendedSlugs) {
      if (resolvedSlugs.has(slug)) continue;
      const v = visibleBySlug.get(slug);
      if (!v) {
        excluded.push({ source_id: slug, reason: "diagnosis_slug_not_visible_or_missing" });
        continue;
      }
      if (v.archived_at || v.status !== "published" ||
          v.article_type === "integration_placeholder") {
        excluded.push({ source_id: slug, reason: "diagnosis_slug_not_visible_or_missing" });
        continue;
      }
      if (presentIds.has(v.id)) {
        diagnosisBoostedIds.add(v.id);
        resolvedSlugs.add(slug);
        continue;
      }
      articles.push({
        article_id: v.id,
        slug: v.slug,
        title: v.title,
        article_type: v.article_type,
        category_slug: null,
        related_route: v.related_route,
        source_confidence: "medium",
        matched_source_types: ["diagnosis_recommended_slug"],
        best_similarity: 0,
        best_hybrid_score: 0,
        route_match: false,
        feature_match: false,
        workflow_match: false,
        summary: v.summary,
        body_excerpt: v.body_excerpt,
      });
      diagnosisBoostedIds.add(v.id);
      presentIds.add(v.id);
      resolvedSlugs.add(slug);
    }
  }
  // Re-sort so injected articles slot into the right place after boosts.
  articles.sort((a, b) => {
    const aBoost = diagnosisBoostedIds.has(a.article_id) ? 1 : 0;
    const bBoost = diagnosisBoostedIds.has(b.article_id) ? 1 : 0;
    if (aBoost !== bBoost) return bBoost - aBoost;
    const confRank = confidenceWeight(b.source_confidence) - confidenceWeight(a.source_confidence);
    if (confRank !== 0) return confRank;
    if (b.best_hybrid_score !== a.best_hybrid_score) {
      return b.best_hybrid_score - a.best_hybrid_score;
    }
    return b.best_similarity - a.best_similarity;
  });


  // For operational/perform_action: keep only safe navigation/concept articles.
  const ranked = operationalRefusal ? articles.slice(0, 3) : articles;

  // V2.2-FIX.2: gate primary candidates by relevance. ARCH.1B: diagnosis-boosted
  // articles bypass the relevance gate (they are visibility-resolved and
  // ontology-recommended for the situation) so the planner always has the
  // intended grounding for the situation.
  const primaryEligible: GuideV2KnowledgePackArticle[] = [];
  for (const a of ranked) {
    const aligned = a.feature_match || a.workflow_match || a.route_match;
    const strongRelevance =
      a.source_confidence === "high" ||
      a.best_hybrid_score >= PRIMARY_MIN_HYBRID ||
      a.best_similarity >= PRIMARY_STRONG_SIMILARITY;
    if (diagnosisBoostedIds.has(a.article_id) || aligned || strongRelevance) {
      primaryEligible.push(a);
      continue;
    }
    excluded.push({
      source_id: a.article_id,
      reason: aligned ? "primary_below_relevance_threshold" : "primary_no_relevance_signal",
    });
  }
  // Diagnosis-boosted entries float to the top of primary so the planner picks
  // them first while still preserving the existing PRIMARY_MAX cap.
  primaryEligible.sort((a, b) => {
    const aBoost = diagnosisBoostedIds.has(a.article_id) ? 1 : 0;
    const bBoost = diagnosisBoostedIds.has(b.article_id) ? 1 : 0;
    return bBoost - aBoost;
  });
  const primary_articles = primaryEligible.slice(0, PRIMARY_MAX);
  const primaryIds = new Set(primary_articles.map((a) => a.article_id));
  const supportingPool = ranked.filter((a) => !primaryIds.has(a.article_id));
  const supporting_articles: GuideV2KnowledgePackArticle[] = [];
  for (const a of supportingPool) {
    if (supporting_articles.length >= SUPPORTING_MAX) break;
    // Diagnosis-boosted entries that did not make primary always count as
    // supporting, since they are ontology-grounded for the situation.
    if (diagnosisBoostedIds.has(a.article_id)) {
      supporting_articles.push(a);
      continue;
    }
    if (a.source_confidence === "low") {
      excluded.push({ source_id: a.article_id, reason: "support_below_confidence" });
      continue;
    }
    const relevant = a.route_match || a.feature_match || a.workflow_match ||
      a.best_similarity >= SUPPORTING_MIN_SIMILARITY;
    if (!relevant) {
      excluded.push({ source_id: a.article_id, reason: "support_no_relevance_signal" });
      continue;
    }
    if (a.best_hybrid_score < SUPPORTING_MIN_HYBRID && !a.workflow_match && !a.route_match) {
      excluded.push({ source_id: a.article_id, reason: "support_below_hybrid_threshold" });
      continue;
    }
    supporting_articles.push(a);
  }

  // --- 6b. QA.2: generic-broad-slug specificity suppression ----------------
  // If a broad concept article (lifecycle / baseline) appears in the final
  // pack but was NOT explicitly recommended by the diagnosis situation, and
  // at least one more specific article exists alongside it, demote it out of
  // the rendered pack. It stays in trace as excluded with a clear reason.
  const recommendedSlugSet = new Set(
    (input.domainDiagnosis?.recommended_kc_slugs ?? [])
      .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
      .filter((s) => s.length > 0),
  );
  const suppressBroad = (
    list: GuideV2KnowledgePackArticle[],
    tier: "primary" | "supporting",
  ): GuideV2KnowledgePackArticle[] => {
    if (list.length === 0) return list;
    const hasMoreSpecific = list.some((a) => !GENERIC_BROAD_SLUGS.has((a.slug || "").toLowerCase()));
    if (!hasMoreSpecific) return list;
    const kept: GuideV2KnowledgePackArticle[] = [];
    for (const a of list) {
      const slug = (a.slug || "").toLowerCase();
      const isBroad = GENERIC_BROAD_SLUGS.has(slug);
      const diagnosisAllowed = recommendedSlugSet.has(slug);
      if (isBroad && !diagnosisAllowed) {
        excluded.push({
          source_id: a.article_id,
          reason: tier === "primary"
            ? "generic_source_below_specificity_threshold"
            : "lower_ranked_generic_candidate",
        });
        continue;
      }
      kept.push(a);
    }
    return kept;
  };
  const primary_articles_final = suppressBroad(primary_articles, "primary");
  const supporting_articles_final = suppressBroad(supporting_articles, "supporting");
  // Reassign for the rest of the pipeline.
  primary_articles.length = 0;
  primary_articles.push(...primary_articles_final);
  supporting_articles.length = 0;
  supporting_articles.push(...supporting_articles_final);

  // --- 7. Source confidence + sufficiency ----------------------------------
  const source_confidence: GuideV2KnowledgePack["source_confidence"] =
    primary_articles[0]?.source_confidence ?? "low";



  let knowledge_sufficiency: GuideV2KnowledgePack["knowledge_sufficiency"];
  if (operationalRefusal) {
    // We never read operational data — the pack only supports a refusal +
    // navigation answer. Mark sufficient if we found relevant guidance.
    knowledge_sufficiency = primary_articles.length > 0 ? "sufficient" : "partial";
  } else if (primary_articles.length > 0 && source_confidence === "high") {
    knowledge_sufficiency = "sufficient";
  } else if (primary_articles.length > 0) {
    knowledge_sufficiency = "partial";
  } else {
    knowledge_sufficiency = "insufficient";
  }

  const retrieval_strategy: GuideV2KnowledgePack["retrieval_strategy"] = "hybrid";
  const baseSignals = buildMetadataSignals({
    classification: input.classification,
    contextRoute: input.contextRoute ?? null,
    retrieval_strategy,
    articles: ranked,
  });
  if (input.domainDiagnosis) {
    baseSignals.diagnosis_used = true;
    baseSignals.diagnosis_situation = input.domainDiagnosis.domain_situation;
    baseSignals.diagnosis_answer_strategy = input.domainDiagnosis.answer_strategy;
    baseSignals.diagnosis_canonical_objects = input.domainDiagnosis.canonical_objects;
    baseSignals.diagnosis_workflow_candidates = input.domainDiagnosis.workflow_candidates;
    baseSignals.diagnosis_recommended_kc_slugs = input.domainDiagnosis.recommended_kc_slugs;
    baseSignals.diagnosis_boosted_article_ids = Array.from(diagnosisBoostedIds);
    baseSignals.retrieval_strategy = "diagnosis_hybrid";
    // ARCH.1E-FIX.3: surface specific-situation salvage signal when the
    // effective diagnosis came from arbitration+ontology normalization AND
    // at least one of its recommended slugs was promoted into the pack.
    const isArbitratedDiagnosis =
      input.domainDiagnosis.diagnosis_source === "arbitrated+ontology_normalized";
    const salvageActivated = isArbitratedDiagnosis && diagnosisBoostedIds.size > 0;
    baseSignals.specific_situation_salvage_activated = salvageActivated;
    baseSignals.specific_situation_salvage_source = isArbitratedDiagnosis
      ? "arbitrated+ontology_normalized"
      : null;
    baseSignals.specific_situation_salvage_promoted_slugs = salvageActivated
      ? primary_articles
          .filter((a) => diagnosisBoostedIds.has(a.article_id))
          .map((a) => a.slug)
          .filter((s): s is string => !!s)
      : [];
  }

  // --- 8. OBS.1-FIX.1: build trace-safe candidate flow + slug resolution ---
  const primaryIdsAll = new Set(primary_articles.map((a) => a.article_id));
  const supportingIdsAll = new Set(supporting_articles.map((a) => a.article_id));
  const articleById = new Map(articles.map((a) => [a.article_id, a]));
  const aggByArticleId = new Map<string, ArticleAggregate>();
  for (const a of aggregated) {
    if (a.article_id) aggByArticleId.set(a.article_id, a);
  }
  const excludedByArticleId = new Map<string, string>();
  for (const e of excluded) excludedByArticleId.set(e.source_id, e.reason);

  const tierOf = (id: string): CandidateFlowRow["tier"] => {
    if (primaryIdsAll.has(id)) return "primary";
    if (supportingIdsAll.has(id)) return "supporting";
    return "excluded";
  };
  const reasonDetail = (
    a: GuideV2KnowledgePackArticle | undefined,
    reason: string | null,
  ): Record<string, unknown> | null => {
    if (!a || !reason) return null;
    if (reason === "support_below_hybrid_threshold") {
      return { actual_hybrid_score: a.best_hybrid_score, required_hybrid_threshold: SUPPORTING_MIN_HYBRID };
    }
    if (reason === "support_below_confidence") {
      return { actual_confidence: a.source_confidence, required_confidence: "medium" };
    }
    if (reason === "support_no_relevance_signal") {
      return { actual_similarity: a.best_similarity, required_similarity_threshold: SUPPORTING_MIN_SIMILARITY };
    }
    if (reason === "primary_below_relevance_threshold" || reason === "primary_no_relevance_signal") {
      return {
        actual_similarity: a.best_similarity,
        required_similarity_threshold: PRIMARY_STRONG_SIMILARITY,
        actual_hybrid_score: a.best_hybrid_score,
        required_hybrid_threshold: PRIMARY_MIN_HYBRID,
      };
    }
    return null;
  };

  const flow: CandidateFlowRow[] = [];
  let rank = 0;
  // 8a. Visible articles (vector + possibly diagnosis-boosted, or pure diagnosis-injected).
  for (const a of [...primary_articles, ...supporting_articles, ...articles.filter(
    (x) => !primaryIdsAll.has(x.article_id) && !supportingIdsAll.has(x.article_id),
  )]) {
    rank += 1;
    const fromDiag = diagnosisBoostedIds.has(a.article_id);
    const agg = aggByArticleId.get(a.article_id);
    const fromVec = !!agg;
    const tier = tierOf(a.article_id);
    const exReason = tier === "excluded" ? (excludedByArticleId.get(a.article_id) ?? null) : null;
    flow.push({
      rank,
      article_id: a.article_id,
      title: a.title,
      slug: a.slug,
      tier,
      source_types: a.matched_source_types,
      similarity: a.best_similarity,
      hybrid_score: a.best_hybrid_score,
      source_confidence: a.source_confidence,
      feature_match: a.feature_match,
      workflow_match: a.workflow_match,
      route_match: a.route_match,
      diagnosis_slug_match: fromDiag,
      chunk_count: agg?.chunk_count ?? 0,
      came_from_vector: fromVec,
      came_from_diagnosis: fromDiag,
      visible_after_rls: true,
      matched_reasons: [
        ...(fromVec ? ["vector_candidate"] : []),
        ...(fromDiag ? ["diagnosis_recommended_slug"] : []),
        ...(a.feature_match ? ["feature_match"] : []),
        ...(a.workflow_match ? ["workflow_match"] : []),
        ...(a.route_match ? ["route_match"] : []),
      ],
      excluded_reason: exReason,
      exclusion_detail: reasonDetail(a, exReason),
    });
  }
  // 8b. Vector aggregates that did NOT survive visibility (RLS / status / placeholder).
  for (const agg of aggregated) {
    if (!agg.article_id || articleById.has(agg.article_id)) continue;
    rank += 1;
    const exReason = excludedByArticleId.get(agg.article_id) ?? "not_visible";
    flow.push({
      rank,
      article_id: agg.article_id,
      title: agg.title,
      slug: agg.slug,
      tier: "pre_visibility_excluded",
      source_types: Array.from(agg.matched_source_types).sort(),
      similarity: agg.best_similarity,
      hybrid_score: agg.best_hybrid_score,
      source_confidence: null,
      feature_match: agg.feature_match,
      workflow_match: agg.workflow_match,
      route_match: agg.route_match,
      diagnosis_slug_match: false,
      chunk_count: agg.chunk_count,
      came_from_vector: true,
      came_from_diagnosis: false,
      visible_after_rls: false,
      matched_reasons: ["vector_candidate"],
      excluded_reason: exReason,
      exclusion_detail: null,
    });
  }
  debug.candidate_flow = flow;

  // 8c. Diagnosis slug resolution table.
  const visibleBySlugFinal = new Map<string, VisibleArticle>();
  for (const v of visibleArticles.values()) {
    if (v.slug) visibleBySlugFinal.set(v.slug.toLowerCase(), v);
  }
  const articleBySlug = new Map(articles.map((a) => [a.slug.toLowerCase(), a]));
  debug.diagnosis_slug_resolution = recommendedSlugs.map((slug): DiagnosisSlugResolutionRow => {
    const v = visibleBySlugFinal.get(slug);
    const inPack = articleBySlug.get(slug);
    if (!v) {
      return {
        slug, resolved_visible: false, article_id: null, title: null, article_status: null,
        included_in_pack: false, included_tier: "not_included",
        reason: "diagnosis_slug_not_visible_or_missing",
      };
    }
    const tier: DiagnosisSlugResolutionRow["included_tier"] = inPack
      ? (primaryIdsAll.has(inPack.article_id)
          ? "primary"
          : supportingIdsAll.has(inPack.article_id) ? "supporting" : "excluded")
      : "not_included";
    return {
      slug,
      resolved_visible: true,
      article_id: v.id,
      title: v.title,
      article_status: v.status,
      included_in_pack: !!inPack,
      included_tier: tier,
      reason: inPack
        ? (diagnosisBoostedIds.has(inPack.article_id)
            ? "diagnosis_recommended_slug"
            : "already_present_from_vector")
        : "visible_but_below_threshold",
    };
  });

  // --- 9. GUIDE-MODE.0.7E: full visible KC workflow catalog ----------
  // Workflow discovery no longer depends on vector-selected primary/supporting
  // articles. We build candidates from every visible published workflow-* KC
  // article and its encrypted workflow_metadata, select semantically first,
  // then fetch the selected article body only to parse verified steps.
  let matched_workflow: GuideV2WorkflowRecord | null = null;
  let workflowSelectedArticleId: string | null = null;
  const workflowLikeQuestion =
    input.classification.intent_type === "workflow_guidance" ||
    input.classification.needs_verified_ui_steps === true ||
    !!input.classification.workflow_id ||
    /\b(?:how\s+do\s+i|where\s+do\s+i|where\s+should\s+i|where\s+can\s+i|can\s+i|could\s+i|how\s+to|where\s+to)\b/i.test(input.question);
  if (!operationalRefusal && workflowLikeQuestion) {
    const fullWorkflowCandidates = visibleWorkflowCandidates(visibleArticles);
    const selection = selectKcWorkflowCardDetailed({
      classification: input.classification,
      candidates: fullWorkflowCandidates,
      canonicalObjects: input.domainDiagnosis?.canonical_objects ?? [],
      userGoal: input.classification.user_goal,
      question: input.question,
      contextRoute: input.contextRoute ?? null,
      contextLabel: input.contextLabel ?? null,
    });

    debug.workflow_catalog = {
      visible_workflow_articles: fullWorkflowCandidates.length,
      metadata_ready_count: workflowMetadataStatus.metadataReadyCount,
      metadata_missing_slugs: workflowMetadataStatus.metadataMissingSlugs,
      catalog_entries: selection.catalog_total,
      selected_workflow_slug: selection.selected?.slug ?? null,
      selected_workflow_frame: selection.semantic_frame ? {
        intent_type: selection.semantic_frame.intent_type,
        object_family: selection.semantic_frame.object_family,
        action: selection.semantic_frame.action,
        modifier: selection.semantic_frame.modifier,
        source_object: selection.semantic_frame.source_object,
        target_object: selection.semantic_frame.target_object,
        scope: selection.semantic_frame.scope,
        ambiguity_flag: selection.semantic_frame.ambiguity_flag,
        generated_artifact_type: (selection.semantic_frame as Record<string, unknown>).generated_artifact_type ?? null,
        generated_artifact_confidence: (selection.semantic_frame as Record<string, unknown>).generated_artifact_confidence ?? null,
        helper_terms_present: (selection.semantic_frame as Record<string, unknown>).helper_terms_present ?? [],
      } : null,
      dispatch_kind: selection.dispatch_kind,
      rejected_workflow_candidates: selection.rejected_candidates.slice(0, 25),
    };

    baseSignals.kc_workflow_catalog_workflow_like_question = workflowLikeQuestion;
    baseSignals.kc_workflow_catalog_visible_workflow_articles = fullWorkflowCandidates.length;
    baseSignals.kc_workflow_catalog_metadata_ready_count = workflowMetadataStatus.metadataReadyCount;
    baseSignals.kc_workflow_catalog_metadata_missing_slugs = workflowMetadataStatus.metadataMissingSlugs;
    baseSignals.kc_workflow_catalog_entries = selection.catalog_total;
    baseSignals.kc_workflow_catalog_dispatch_kind = selection.dispatch_kind;
    baseSignals.kc_workflow_catalog_selected_slug = selection.selected?.slug ?? null;
    baseSignals.kc_workflow_catalog_selected_frame = debug.workflow_catalog.selected_workflow_frame;

    if (selection.dispatch_kind === "clarification_needed") {
      baseSignals.kc_workflow_card_clarification_needed = true;
    }
    if (selection.dispatch_kind === "unsupported_safe_guidance") {
      baseSignals.kc_workflow_card_unsupported_composite = true;
    }
    // Same-family verified workflow slugs (e.g. project-level vs task-level
    // blocker) — used by the planner to build clarification questions instead
    // of falsely refusing with "no verified workflow exists".
    const sameFamilySlugs = (selection.same_family_matches ?? []).map((c) => c.workflow_slug);
    if (sameFamilySlugs.length > 0) {
      baseSignals.kc_workflow_card_same_family_matches = sameFamilySlugs;
    }
    if (selection.rejected_candidates.length > 0) {
      baseSignals.kc_workflow_card_rejected_candidates = selection.rejected_candidates.slice(0, 25);
      // Conceptual fix: an object_family/modifier mismatch only matters when
      // the user's requested object family is known AND no verified workflow
      // for that family exists. Otherwise rejection of unrelated catalog
      // entries (e.g. "object_family:project!=blocker" while looking at the
      // blocker question) created false-positive refusals like
      // "BTPM does not have a verified workflow for ..." even when a verified
      // blocker workflow actually exists in KC.
      const frameFamily = selection.semantic_frame?.object_family;
      const frameFamilyKnown = !!frameFamily && frameFamily !== "unknown";
      const hasSameFamilyVerified = sameFamilySlugs.length > 0;
      baseSignals.kc_workflow_card_object_mismatch =
        frameFamilyKnown && !hasSameFamilyVerified &&
        selection.rejected_candidates.some((r) => r.reason.startsWith("object_family:"));
      const frameModifier = selection.semantic_frame?.modifier;
      const frameModifierSpecific = !!frameModifier && frameModifier !== "none";
      baseSignals.kc_workflow_card_modifier_mismatch =
        frameFamilyKnown && frameModifierSpecific && !hasSameFamilyVerified &&
        selection.rejected_candidates.some((r) => r.reason.startsWith("modifier:"));
    }

    if (selection.dispatch_kind === "verified_workflow" && selection.selected) {
      const selected = selection.selected;
      workflowSelectedArticleId = selected.article_id;
      await fetchWorkflowCardBodies(input.userClient, visibleArticles, [selected.article_id]);
      const visibleSelected = visibleArticles.get(selected.article_id);
      const selectedWithBody: KcWorkflowCardArticle = {
        ...selected,
        body: visibleSelected?.workflow_card_body ?? null,
        workflow_metadata: visibleSelected?.workflow_metadata ?? selected.workflow_metadata ?? null,
      };
      matched_workflow = buildKcWorkflowRecordFromCard({
        classification: input.classification,
        candidate: selectedWithBody,
        selected_entry: selection.selected_entry,
      });
      if (matched_workflow) {
        baseSignals.kc_workflow_card_matched = true;
        baseSignals.kc_workflow_card_source_slug = matched_workflow.source_articles[0] ?? null;
        baseSignals.kc_workflow_card_workflow_id = matched_workflow.workflow_id;
      } else {
        baseSignals.kc_workflow_card_parse_failed = true;
        baseSignals.kc_workflow_card_parse_failed_slug = selected.slug;
      }
    }
  }

  if (matched_workflow && workflowSelectedArticleId) {
    const selectedVisible = visibleArticles.get(workflowSelectedArticleId);
    const alreadyPrimary = primary_articles.some((a) => a.article_id === workflowSelectedArticleId);
    const alreadySupporting = supporting_articles.some((a) => a.article_id === workflowSelectedArticleId);
    if (selectedVisible && !alreadyPrimary && !alreadySupporting) {
      const injected = visibleToKnowledgePackArticle(
        selectedVisible,
        ["workflow_catalog_metadata", "workflow_card_selected"],
        "high",
      );
      primary_articles.unshift(injected);
      if (primary_articles.length > PRIMARY_MAX) {
        const demoted = primary_articles.pop();
        if (demoted) supporting_articles.unshift(demoted);
      }
      supporting_articles.splice(SUPPORTING_MAX);
      baseSignals.kc_workflow_catalog_injected_selected_article = selectedVisible.slug;
    }
  }

  const final_source_confidence: GuideV2KnowledgePack["source_confidence"] = matched_workflow ? "high" : source_confidence;
  const final_knowledge_sufficiency: GuideV2KnowledgePack["knowledge_sufficiency"] = matched_workflow ? "sufficient" : knowledge_sufficiency;

  return {
    pack: {
      primary_articles,
      supporting_articles,
      metadata_signals: baseSignals,
      route_context,
      matched_workflow,
      source_confidence: final_source_confidence,
      knowledge_sufficiency: final_knowledge_sufficiency,
      retrieval_strategy,
      excluded_sources: excluded,
    },
    debug,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface ArticleAggregate {
  article_id: string | null;
  slug: string | null;
  title: string | null;
  best_similarity: number;
  best_hybrid_score: number;
  matched_source_types: Set<string>;
  route_match: boolean;
  feature_match: boolean;
  workflow_match: boolean;
  chunk_count: number;
  has_title_or_summary_match: boolean;
  has_question_example_match: boolean;
  has_positive_source_match: boolean;
}

function isTitleOrSummary(source_type: string): boolean {
  return (
    source_type === "knowledge_article_title" ||
    source_type === "knowledge_article_summary" ||
    source_type === "knowledge_article_tooltip"
  );
}

function aggregateByArticle(
  candidates: VectorChunkCandidate[],
  excluded: { source_id: string; reason: string }[],
): ArticleAggregate[] {
  const byKey = new Map<string, ArticleAggregate>();
  for (const c of candidates) {
    const key = c.article_id ?? c.article_slug ?? c.source_id;
    if (!key) continue;
    let agg = byKey.get(key);
    const positive = POSITIVE_SOURCE_TYPES.has(c.source_type);
    if (!agg) {
      agg = {
        article_id: c.article_id,
        slug: c.article_slug,
        title: c.article_title,
        best_similarity: c.similarity,
        best_hybrid_score: c.hybrid_score,
        matched_source_types: new Set([c.source_type]),
        route_match: c.route_match,
        feature_match: c.feature_match,
        workflow_match: c.workflow_match,
        chunk_count: 1,
        has_title_or_summary_match: isTitleOrSummary(c.source_type),
        has_question_example_match: c.source_type === "metadata_question_example",
        has_positive_source_match: positive,
      };
      byKey.set(key, agg);
      continue;
    }
    agg.best_similarity = Math.max(agg.best_similarity, c.similarity);
    agg.best_hybrid_score = Math.max(agg.best_hybrid_score, c.hybrid_score);
    agg.matched_source_types.add(c.source_type);
    agg.route_match = agg.route_match || c.route_match;
    agg.feature_match = agg.feature_match || c.feature_match;
    agg.workflow_match = agg.workflow_match || c.workflow_match;
    agg.chunk_count++;
    if (isTitleOrSummary(c.source_type)) agg.has_title_or_summary_match = true;
    if (c.source_type === "metadata_question_example") agg.has_question_example_match = true;
    if (positive) agg.has_positive_source_match = true;
  }
  const out: ArticleAggregate[] = [];
  for (const a of byKey.values()) {
    // V2.2-FIX: forbidden-claim-only matches are not positive support.
    if (!a.has_positive_source_match && !a.route_match && !a.workflow_match && !a.feature_match) {
      excluded.push({
        source_id: a.article_id ?? a.slug ?? "unknown",
        reason: "metadata_forbidden_claim_only",
      });
      continue;
    }
    if (a.best_similarity < LOW_SIM_THRESHOLD && !a.route_match && !a.workflow_match) {
      excluded.push({
        source_id: a.article_id ?? a.slug ?? "unknown",
        reason: "low_similarity",
      });
      continue;
    }
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Visibility re-resolution via existing KC RPC.
// list_decrypted_knowledge_articles enforces the same RLS path the BTPM Guide
// drawer already uses; we intersect candidates against it.
// ---------------------------------------------------------------------------

interface VisibleArticle {
  id: string;
  slug: string;
  title: string;
  status: string;
  article_type: string;
  archived_at: string | null;
  related_route: string | null;
  summary: string | null;
  body_excerpt: string | null;
  // GUIDE-MODE.0.5 — internal-only: full visibility-resolved body, retained
  // ONLY for workflow-card slugs so the resolver can parse procedural steps.
  // Never surfaced to the user response or admin trace output.
  workflow_card_body: string | null;
  workflow_metadata: KcWorkflowCardArticle["workflow_metadata"] | null;
}

// V2.6-FIX: produce a safe body excerpt for grounding. We only use text the
// KC drawer would already show the user (visibility-resolved decrypted body),
// strip markdown/HTML noise, and cap length. No raw chunk text, no embeddings.
function safeBodyExcerpt(body: string | null, maxChars = 700): string | null {
  if (!body) return null;
  let t = String(body);
  // strip code fences
  t = t.replace(/```[\s\S]*?```/g, " ");
  // strip HTML tags
  t = t.replace(/<[^>]+>/g, " ");
  // strip markdown headings/list markers, links -> text
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/^[\s>*\-+]+/gm, "");
  t = t.replace(/[*_`>#]+/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= maxChars) return t;
  // Trim at sentence boundary near limit.
  const cut = t.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (lastStop > 200 ? cut.slice(0, lastStop + 1) : cut).trim() + "…";
}

async function listVisibleArticleMap(
  client: SupabaseClient,
): Promise<Map<string, VisibleArticle>> {
  const map = new Map<string, VisibleArticle>();
  const { data, error } = await client.rpc("list_decrypted_knowledge_articles", {
    _category_id: null,
    _include_unpublished: false,
  });
  if (error) return map;
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const id = row.id as string | undefined;
    if (!id) continue;
    const summary = (row.summary as string | null) ?? null;
    const tooltip = (row.tooltip_excerpt as string | null) ?? null;
    const slug = String(row.slug ?? "");
    map.set(id, {
      id,
      slug,
      title: String(row.title ?? ""),
      status: String(row.status ?? ""),
      article_type: String(row.article_type ?? ""),
      archived_at: (row.archived_at as string | null) ?? null,
      related_route: (row.related_route as string | null) ?? null,
      summary: summary && summary.trim().length > 0 ? summary : tooltip,
      // list RPC does not return body; left null. body_excerpt is populated
      // only when callers separately resolve full body (currently only for
      // workflow-card bodies — and even then kept internal-only).
      body_excerpt: null,
      workflow_card_body: null,
      workflow_metadata: null,
    });
  }
  return map;
}


function isVisiblePublishedWorkflowArticle(v: VisibleArticle): boolean {
  return isWorkflowCardSlug(v.slug) &&
    v.status === "published" &&
    !v.archived_at &&
    v.article_type !== "integration_placeholder";
}

async function attachWorkflowMetadataForVisibleArticles(
  client: SupabaseClient,
  visibleArticles: Map<string, VisibleArticle>,
): Promise<{ metadataReadyCount: number; metadataMissingSlugs: string[] }> {
  const workflowIds = Array.from(visibleArticles.values())
    .filter(isVisiblePublishedWorkflowArticle)
    .map((v) => v.id);
  if (workflowIds.length === 0) return { metadataReadyCount: 0, metadataMissingSlugs: [] };
  try {
    const { data, error } = await client.rpc("list_knowledge_article_ai_metadata_for_visible_articles", {
      _article_ids: workflowIds,
    });
    if (error) {
      return {
        metadataReadyCount: 0,
        metadataMissingSlugs: Array.from(visibleArticles.values())
          .filter(isVisiblePublishedWorkflowArticle)
          .map((v) => v.slug)
          .sort(),
      };
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const id = String(row.article_id ?? "");
      const entry = visibleArticles.get(id);
      if (!entry) continue;
      entry.workflow_metadata = (row.workflow_metadata as KcWorkflowCardArticle["workflow_metadata"]) ?? null;
    }
  } catch (_e) {
    return {
      metadataReadyCount: 0,
      metadataMissingSlugs: Array.from(visibleArticles.values())
        .filter(isVisiblePublishedWorkflowArticle)
        .map((v) => v.slug)
        .sort(),
    };
  }
  const visibleWorkflowArticles = Array.from(visibleArticles.values()).filter(isVisiblePublishedWorkflowArticle);
  const ready = visibleWorkflowArticles.filter((v) => !!v.workflow_metadata).length;
  const missing = visibleWorkflowArticles.filter((v) => !v.workflow_metadata).map((v) => v.slug).sort();
  return { metadataReadyCount: ready, metadataMissingSlugs: missing };
}

function visibleWorkflowCandidates(visibleArticles: Map<string, VisibleArticle>): KcWorkflowCardArticle[] {
  return Array.from(visibleArticles.values())
    .filter(isVisiblePublishedWorkflowArticle)
    .map((v) => ({
      article_id: v.id,
      slug: v.slug,
      title: v.title,
      related_route: v.related_route,
      body: v.workflow_card_body,
      workflow_metadata: v.workflow_metadata,
    }));
}

function visibleToKnowledgePackArticle(
  v: VisibleArticle,
  matchedSourceTypes: string[],
  confidence: "high" | "medium" | "low" = "high",
): GuideV2KnowledgePackArticle {
  return {
    article_id: v.id,
    slug: v.slug,
    title: v.title,
    article_type: v.article_type,
    category_slug: null,
    related_route: v.related_route,
    source_confidence: confidence,
    matched_source_types: matchedSourceTypes,
    best_similarity: 0,
    best_hybrid_score: 0,
    route_match: false,
    feature_match: false,
    workflow_match: true,
    summary: v.summary,
    body_excerpt: v.body_excerpt,
  };
}

// GUIDE-MODE.0.5-FIX: fetch full decrypted body for workflow-card articles
// via the visibility-aware single-article RPC. Mutates the provided map in
// place. Fails closed (leaves workflow_card_body null) on any error. Caller
// must restrict input IDs to articles already visible+published in the map.
async function fetchWorkflowCardBodies(
  client: SupabaseClient,
  visibleArticles: Map<string, VisibleArticle>,
  articleIds: string[],
): Promise<void> {
  await Promise.all(
    articleIds.map(async (id) => {
      const entry = visibleArticles.get(id);
      if (!entry) return;
      if (!isWorkflowCardSlug(entry.slug)) return;
      try {
        const { data, error } = await client.rpc("get_decrypted_knowledge_article", {
          _id: id,
        });
        if (error) return;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || typeof row !== "object") return;
        const r = row as Record<string, unknown>;
        // Sanity: confirm row identity and publish/visibility still match what
        // the list RPC reported. Defense-in-depth — never bypass the visibility
        // resolution that gated entry into the map in the first place.
        if (String(r.id ?? "") !== id) return;
        if (String(r.slug ?? "") !== entry.slug) return;
        if (String(r.status ?? "") !== "published") return;
        if (r.archived_at) return;
        const body = (r.body as string | null) ?? null;
        if (!body || typeof body !== "string") return;
        entry.workflow_card_body = body;
      } catch (_e) {
        // fail closed
      }
    }),
  );
}


// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

function scoreSourceConfidence(a: ArticleAggregate): "high" | "medium" | "low" {
  const strongMatch =
    a.workflow_match ||
    a.feature_match ||
    a.has_title_or_summary_match ||
    a.has_question_example_match;
  if (a.best_similarity >= HIGH_SIM_THRESHOLD && strongMatch) return "high";
  if (a.best_similarity >= MEDIUM_SIM_THRESHOLD) return "medium";
  return "low";
}

function confidenceWeight(c: "high" | "medium" | "low"): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Metadata signals + empty pack helper
// ---------------------------------------------------------------------------

function buildMetadataSignals(args: {
  classification: GuideV2IntentClassification;
  contextRoute: string | null;
  retrieval_strategy: GuideV2KnowledgePack["retrieval_strategy"];
  articles: GuideV2KnowledgePackArticle[];
}): Record<string, unknown> {
  const sourceTypes = new Set<string>();
  let bestSim = 0;
  let bestHybrid = 0;
  for (const a of args.articles) {
    for (const t of a.matched_source_types) sourceTypes.add(t);
    if (a.best_similarity > bestSim) bestSim = a.best_similarity;
    if (a.best_hybrid_score > bestHybrid) bestHybrid = a.best_hybrid_score;
  }
  return {
    intent_type: args.classification.intent_type,
    feature_area: args.classification.feature_area,
    workflow_id: args.classification.workflow_id,
    context_route: args.contextRoute,
    retrieval_strategy: args.retrieval_strategy,
    source_types: Array.from(sourceTypes).sort(),
    article_count: args.articles.length,
    top_similarity: bestSim,
    top_hybrid_score: bestHybrid,
  };
}

function emptyPack(args: {
  route_context: { route: string | null; label: string | null };
  retrieval_strategy: GuideV2KnowledgePack["retrieval_strategy"];
  source_confidence: GuideV2KnowledgePack["source_confidence"];
  knowledge_sufficiency: GuideV2KnowledgePack["knowledge_sufficiency"];
  metadata_signals: Record<string, unknown>;
  excluded: { source_id: string; reason: string }[];
}): GuideV2KnowledgePack {
  return {
    primary_articles: [],
    supporting_articles: [],
    metadata_signals: args.metadata_signals,
    route_context: args.route_context,
    matched_workflow: null,
    source_confidence: args.source_confidence,
    knowledge_sufficiency: args.knowledge_sufficiency,
    retrieval_strategy: args.retrieval_strategy,
    excluded_sources: args.excluded,
  };
}
