// AI-GUIDE.V2-OBS — Admin-only Pipeline Trace Viewer endpoint.
//
// Runs the same V2 pipeline as the active user-facing `ai-guide-v2-chat`
// (validate_only mode) and emits a per-stage trace (timings, status, key
// fields, safe JSON) for admin diagnostics. Trace is Admin-only and does
// NOT persist anything. Does NOT expose raw chunks, embeddings, secrets,
// provider prompts/bodies, operational PM data, or text-model identifiers.


import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { classifyGuideV2Intent } from "../_shared/ai-guide-v2/classifier.ts";
import { buildGuideV2KnowledgePack } from "../_shared/ai-guide-v2/knowledge-pack.ts";
import { routeGuideV2Request } from "../_shared/ai-guide-v2/router.ts";
import { planGuideV2Answer } from "../_shared/ai-guide-v2/answer-planner.ts";
import { renderGuideV2Answer, checkRenderSafety } from "../_shared/ai-guide-v2/renderer.ts";
import { validateGuideV2Answer, guideV2SafeFallbackAnswer } from "../_shared/ai-guide-v2/validator.ts";
import { diagnoseGuideV2Domain } from "../_shared/ai-guide-v2/domain-diagnosis.ts";
import { arbitrateGuideV2Intent, buildEffectivePipelineState } from "../_shared/ai-guide-v2/intent-arbitration.ts";
import { validateGuideV2PipelineInvariants } from "../_shared/ai-guide-v2/pipeline-invariants.ts";
import { resolveGuideV2EffectiveDecision } from "../_shared/ai-guide-v2/effective-decision.ts";
import {
  buildGuideV2KnowledgePackFromEffectiveDecision,
  routeGuideV2RequestFromEffectiveDecision,
  planGuideV2AnswerFromEffectiveDecision,
} from "../_shared/ai-guide-v2/effective-pipeline.ts";
import { resolveActiveOrganizationId, toSafeActiveOrganizationPublicError } from "../_shared/activeOrganizationContext.ts";
import { resolveGuideTextProviderRuntime, toSafeGuideProviderPublicError, type GuideTextProviderRuntimeConfig } from "../_shared/guideTextProviderRuntime.ts";
import { resolveGuideEmbeddingProviderRuntime, toSafeGuideEmbeddingPublicError, type GuideEmbeddingProviderRuntimeConfig } from "../_shared/guideEmbeddingProviderRuntime.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VERSION = "AI-GUIDE.V2-STABILIZE.2-OBS.2";
const MAX_QUESTION_LEN = 2000;

type Status = "pass" | "warn" | "fail" | "skipped";

interface Stage {
  status: Status;
  elapsed_ms: number;
  summary: string;
  key_fields: Record<string, unknown>;
  warnings: string[];
  errors: string[];
  safe_json: unknown;
}

function emptyStage(): Stage {
  return {
    status: "skipped",
    elapsed_ms: 0,
    summary: "",
    key_fields: {},
    warnings: [],
    errors: [],
    safe_json: null,
  };
}

function errorJson(code: string, message: string, status: number): Response {
  return new Response(
    JSON.stringify({ ok: false, version: VERSION, error: { code, message } }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("method_not_allowed", "Use POST.", 405);

  const reqId = crypto.randomUUID();
  const tStart = Date.now();
  const startedAt = new Date().toISOString();

  // --- Auth ---
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return errorJson("unauthorized", "Missing bearer token.", 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnon) {
    return errorJson("server_misconfigured", "Auth not configured.", 500);
  }
  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const verifier = createSupabaseTokenVerifier(userClient);
    await assertBrowserSessionOnly(req, verifier);
  } catch (guardError) {
    return toSafeErrorResponse(guardError, corsHeaders);
  }

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return errorJson("unauthorized", "Unauthorized.", 401);
  const userId = userData.user.id;

  // --- Body parse ---
  let body: {
    question?: unknown;
    context_route?: unknown;
    context_label?: unknown;
    debug?: unknown;
  } = {};
  try { body = await req.json(); } catch {
    return errorJson("bad_request", "Invalid JSON body.", 400);
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return errorJson("bad_request", "Field 'question' is required.", 400);
  if (question.length > MAX_QUESTION_LEN) {
    return errorJson("bad_request", `Field 'question' exceeds ${MAX_QUESTION_LEN} chars.`, 400);
  }
  const contextRoute = typeof body.context_route === "string" ? body.context_route.slice(0, 200) : null;
  const contextLabel = typeof body.context_label === "string" ? body.context_label.slice(0, 200) : null;

  // --- Resolve org via canonical active-context RPC + admin check ---
  let organizationId: string;
  try {
    organizationId = await resolveActiveOrganizationId(userClient);
  } catch (e) {
    const safe = toSafeActiveOrganizationPublicError(e);
    return errorJson(safe.error, safe.note, 403);
  }

  const { data: isAdmin, error: adminErr } = await userClient.rpc("is_org_admin", {
    _user_id: userId,
    _organization_id: organizationId,
  });
  if (adminErr || isAdmin !== true) {
    return errorJson("forbidden", "Org Admin only.", 403);
  }

  // Resolve request-scoped provider runtime once per trace invocation.
  let providerRuntime: GuideTextProviderRuntimeConfig | null = null;
  try {
    providerRuntime = await resolveGuideTextProviderRuntime({
      organizationId,
      functionName: "ai-guide-v2-trace",
      reason: "btpm-guide-v2-trace",
      requestId: reqId,
    });
  } catch (e) {
    const safe = toSafeGuideProviderPublicError(e);
    return errorJson(safe.error, safe.note, 503);
  }

  // Phase 4D.14A.3D — resolve embedding runtime once per trace invocation
  // (trace runs the full pipeline through validate_only). Reused for the
  // initial Knowledge Pack build and the effective KP rebuild.
  let embeddingRuntime: GuideEmbeddingProviderRuntimeConfig | null = null;
  try {
    embeddingRuntime = await resolveGuideEmbeddingProviderRuntime({
      organizationId,
      functionName: "ai-guide-v2-trace",
      reason: "btpm-guide-v2-trace-embedding",
      requestId: reqId,
    });
  } catch (e) {
    const safe = toSafeGuideEmbeddingPublicError(e);
    return errorJson(safe.error, safe.note, 503);
  }

  // --- Trace stages ---
  const trace: Record<string, Stage> = {
    input: emptyStage(),
    classification: emptyStage(),
    domain_diagnosis: emptyStage(),
    knowledge_pack: emptyStage(),
    workflow_catalog: emptyStage(),
    intent_arbitration: emptyStage(),
    reconciled_state: emptyStage(),
    effective_decision: emptyStage(),
    knowledge_pack_effective: emptyStage(),
    workflow_catalog_effective: emptyStage(),
    routing: emptyStage(),
    answer_plan: emptyStage(),
    rendering: emptyStage(),
    validation: emptyStage(),
    pipeline_invariants: emptyStage(),
    final: emptyStage(),
  };

  // 1. Input
  trace.input = {
    status: "pass",
    elapsed_ms: 0,
    summary: `question (${question.length} chars), route=${contextRoute ?? "—"}, label=${contextLabel ?? "—"}`,
    key_fields: {
      question_length: question.length,
      context_route: contextRoute,
      context_label: contextLabel,
      request_id: reqId,
      organization_id: organizationId,
    },
    warnings: [],
    errors: [],
    safe_json: { question, context_route: contextRoute, context_label: contextLabel },
  };

  // 2. Classification
  let classifierResult: Awaited<ReturnType<typeof classifyGuideV2Intent>> | null = null;
  {
    const t = Date.now();
    try {
      classifierResult = await classifyGuideV2Intent({
        message: question, contextRoute, contextLabel, requestId: reqId,
        providerRuntime,
      });
      const cls = classifierResult.classification as Record<string, unknown>;
      const conf = typeof cls.confidence === "number" ? cls.confidence : null;
      const source = String(cls.classification_source ?? "");
      const warnings: string[] = [];
      let status: Status = "pass";
      if (source.includes("fallback") || (conf !== null && conf < 0.4)) {
        status = "warn";
        warnings.push(conf !== null ? `low_confidence:${conf}` : "fallback_source");
      }
      trace.classification = {
        status,
        elapsed_ms: Date.now() - t,
        summary: `intent=${cls.intent_type ?? "?"} workflow=${cls.workflow_id ?? "—"} conf=${conf ?? "—"}`,
        key_fields: {
          intent_type: cls.intent_type,
          workflow_id: cls.workflow_id,
          feature_area: cls.feature_area,
          confidence: cls.confidence,
          needs_verified_ui_steps: cls.needs_verified_ui_steps,
          asks_assistant_to_act: cls.asks_assistant_to_act,
          needs_live_data: cls.needs_live_data,
          classification_source: cls.classification_source,
          schema_valid: cls.schema_valid,
        },
        warnings, errors: [],
        safe_json: cls,
      };
    } catch (e) {
      trace.classification = {
        status: "fail", elapsed_ms: Date.now() - t,
        summary: "classifier_failed", key_fields: {}, warnings: [],
        errors: [e instanceof Error ? e.message : "unknown"], safe_json: null,
      };
    }
  }
  if (!classifierResult) return finishEarly(trace, reqId, startedAt, tStart);

  // 3. Domain Diagnosis
  let domainDiagnosis: Record<string, unknown> | null = null;
  {
    const t = Date.now();
    try {
      const r = await diagnoseGuideV2Domain({
        question, classification: classifierResult.classification,
        contextRoute, contextLabel, requestId: reqId,
        providerRuntime,
      });
      domainDiagnosis = r.diagnosis as Record<string, unknown>;
      const conf = typeof domainDiagnosis?.confidence === "number" ? domainDiagnosis.confidence as number : null;
      const source = String(domainDiagnosis?.diagnosis_source ?? "");
      const warnings: string[] = [];
      let status: Status = "pass";
      if (source.includes("fallback") || source.includes("coerce") || (conf !== null && conf < 0.4)) {
        status = "warn";
        if (conf !== null) warnings.push(`low_confidence:${conf}`);
        if (source) warnings.push(`source:${source}`);
      }
      trace.domain_diagnosis = {
        status, elapsed_ms: Date.now() - t,
        summary: `situation=${domainDiagnosis?.domain_situation ?? "?"} strategy=${domainDiagnosis?.answer_strategy ?? "?"} conf=${conf ?? "—"}`,
        key_fields: {
          domain_situation: domainDiagnosis?.domain_situation,
          answer_strategy: domainDiagnosis?.answer_strategy,
          canonical_objects: domainDiagnosis?.canonical_objects,
          possible_objects: domainDiagnosis?.possible_objects,
          not_objects: domainDiagnosis?.not_objects,
          workflow_candidates: domainDiagnosis?.workflow_candidates,
          recommended_kc_slugs: domainDiagnosis?.recommended_kc_slugs,
          retrieval_hints: domainDiagnosis?.retrieval_hints,
          needs_verified_ui_steps: domainDiagnosis?.needs_verified_ui_steps,
          needs_live_data: domainDiagnosis?.needs_live_data,
          asks_assistant_to_act: domainDiagnosis?.asks_assistant_to_act,
          confidence: domainDiagnosis?.confidence,
          diagnosis_source: domainDiagnosis?.diagnosis_source,
          safety_notes: domainDiagnosis?.safety_notes,
          schema_valid: domainDiagnosis?.schema_valid,
        },
        warnings, errors: [], safe_json: domainDiagnosis,
      };
    } catch (e) {
      trace.domain_diagnosis = {
        status: "warn", elapsed_ms: Date.now() - t,
        summary: "diagnosis_failed (continuing without)",
        key_fields: {}, warnings: ["diagnosis_failed"],
        errors: [e instanceof Error ? e.message : "unknown"], safe_json: null,
      };
    }
  }

  // 4. Knowledge Pack
  let pack: Awaited<ReturnType<typeof buildGuideV2KnowledgePack>>["pack"] | null = null;
  let packDebug: Awaited<ReturnType<typeof buildGuideV2KnowledgePack>>["debug"] | null = null;
  {
    const t = Date.now();
    try {
      const r = await buildGuideV2KnowledgePack({
        userClient, userId, organizationId,
        question, classification: classifierResult.classification,
        contextRoute, contextLabel, requestId: reqId, domainDiagnosis,
        embeddingRuntime,
      });
      pack = r.pack;
      packDebug = r.debug;
      const packAny = pack as unknown as Record<string, unknown>;
      const primary = (packAny.primary_articles as Array<Record<string, unknown>>) ?? [];
      const supporting = (packAny.supporting_articles as Array<Record<string, unknown>>) ?? [];
      const excluded = (packAny.excluded_sources as Array<Record<string, unknown>>) ?? [];
      const metaSignals = (packAny.metadata_signals as Record<string, unknown>) ?? {};
      const dbgAny = packDebug as unknown as Record<string, unknown>;
      const candidateFlow = (dbgAny?.candidate_flow as Array<Record<string, unknown>>) ?? [];
      const slugResolution = (dbgAny?.diagnosis_slug_resolution as Array<Record<string, unknown>>) ?? [];
      const retrievalInputs = (dbgAny?.retrieval_inputs as Record<string, unknown>) ?? {};
      const thresholds = (dbgAny?.thresholds as Record<string, unknown>) ?? {};

      const warnings: string[] = [];
      let status: Status = "pass";
      const suff = String(packAny.knowledge_sufficiency ?? "");
      const sourceConf = String(packAny.source_confidence ?? "");
      if (suff === "insufficient") { status = "warn"; warnings.push("insufficient_knowledge"); }
      if (primary.length === 0) { status = "warn"; warnings.push("no_primary_articles"); }
      if ((suff === "sufficient" || suff === "partial") && primary.length === 0 && supporting.length === 0) {
        status = "warn";
        warnings.push("no_primary_or_supporting_but_sufficient");
      }
      const diagMissing = slugResolution
        .filter((d) => !d.included_in_pack)
        .map((d) => String(d.slug));
      if (diagMissing.length > 0) warnings.push(`diagnosis_slugs_missing:${diagMissing.join(",")}`);
      const recSlugs = (retrievalInputs.diagnosis_recommended_kc_slugs as string[]) ?? [];
      const diagSituation = retrievalInputs.diagnosis_situation as string | null;
      if (diagSituation && recSlugs.length === 0) warnings.push("diagnosis_recommended_slugs_empty");

      const topSim = Math.max(0, ...candidateFlow.map((c) => Number(c.similarity ?? 0)));
      const topHybrid = Math.max(0, ...candidateFlow.map((c) => Number(c.hybrid_score ?? 0)));

      const retrieval_summary = {
        retrieval_strategy: metaSignals.retrieval_strategy ?? packAny.retrieval_strategy,
        vector_retrieval_run: true,
        diagnosis_used: !!domainDiagnosis,
        diagnosis_situation: diagSituation,
        source_confidence: sourceConf || null,
        knowledge_sufficiency: suff || null,
        candidates_seen: packDebug?.candidates_seen ?? null,
        articles_after_visibility: packDebug?.articles_after_visibility ?? null,
        primary_count: primary.length,
        supporting_count: supporting.length,
        excluded_count: excluded.length,
        top_similarity: topSim,
        top_hybrid_score: topHybrid,
        warning_flags: warnings,
      };

      trace.knowledge_pack = {
        status, elapsed_ms: Date.now() - t,
        summary: `primary=${primary.length} support=${supporting.length} excluded=${excluded.length} suff=${suff || "—"} conf=${sourceConf || "—"}`,
        key_fields: {
          retrieval_strategy: retrieval_summary.retrieval_strategy,
          source_confidence: retrieval_summary.source_confidence,
          knowledge_sufficiency: retrieval_summary.knowledge_sufficiency,
          primary_count: primary.length,
          supporting_count: supporting.length,
          excluded_count: excluded.length,
          diagnosis_used: !!domainDiagnosis,
          diagnosis_situation: diagSituation,
          candidates_seen: packDebug?.candidates_seen ?? null,
          articles_after_visibility: packDebug?.articles_after_visibility ?? null,
          vector_retrieval_run: true,
          top_similarity: topSim,
          top_hybrid_score: topHybrid,
          diagnosis_recommended_slugs: recSlugs,
          diagnosis_slugs_missing: diagMissing,
        },
        warnings, errors: [],
        safe_json: {
          knowledge_pack_trace: {
            retrieval_summary,
            retrieval_inputs: retrievalInputs,
            thresholds,
            diagnosis_slug_resolution: slugResolution,
            candidate_flow: candidateFlow,
            excluded_sources: excluded,
            metadata_signals: metaSignals,
          },
        },
      };
    } catch (e) {
      trace.knowledge_pack = {
        status: "fail", elapsed_ms: Date.now() - t,
        summary: "knowledge_pack_failed", key_fields: {}, warnings: [],
        errors: [e instanceof Error ? e.message : "unknown"], safe_json: null,
      };
    }
  }
  if (!pack) return finishEarly(trace, reqId, startedAt, tStart);

  // 4a. Workflow Catalog Dispatch (deterministic semantic gate run inside the
  // initial Knowledge Pack build via kc-workflow-card-resolver). Surfacing it
  // as its own stage makes the workflow-frame → catalog → dispatch decision
  // visible (object_family, action, modifier, scope, generated artifact type,
  // dispatch kind, rejections), which previously lived only inside the KP
  // debug payload.
  {
    const wc = (packDebug as unknown as Record<string, unknown>)?.workflow_catalog as
      | Record<string, unknown>
      | undefined;
    if (wc) {
      const dispatchKind = String(wc.dispatch_kind ?? "—");
      const selectedSlug = (wc.selected_workflow_slug as string | null) ?? null;
      const rejected = (wc.rejected_workflow_candidates as Array<Record<string, unknown>>) ?? [];
      const frame = (wc.selected_workflow_frame as Record<string, unknown> | null) ?? null;
      const warnings: string[] = [];
      let status: Status = "pass";
      if (dispatchKind === "clarification_needed") {
        status = "warn"; warnings.push("clarification_needed");
      } else if (dispatchKind === "unsupported_safe_guidance") {
        status = "warn"; warnings.push("unsupported_safe_guidance");
      } else if (dispatchKind === "action_refusal") {
        status = "warn"; warnings.push("action_refusal");
      } else if (!selectedSlug && dispatchKind !== "—") {
        status = "warn"; warnings.push("no_selected_workflow");
      }
      const missing = (wc.metadata_missing_slugs as string[]) ?? [];
      if (missing.length > 0) warnings.push(`metadata_missing:${missing.length}`);

      trace.workflow_catalog = {
        status,
        elapsed_ms: 0,
        summary: `dispatch=${dispatchKind} slug=${selectedSlug ?? "—"} frame=${frame ? `${frame.object_family}/${frame.action}${frame.generated_artifact_type ? `/${frame.generated_artifact_type}` : ""}` : "—"} rejected=${rejected.length}`,
        key_fields: {
          dispatch_kind: dispatchKind,
          selected_workflow_slug: selectedSlug,
          selected_workflow_frame: frame,
          visible_workflow_articles: wc.visible_workflow_articles ?? null,
          metadata_ready_count: wc.metadata_ready_count ?? null,
          metadata_missing_slugs: missing,
          catalog_entries: wc.catalog_entries ?? null,
          rejected_workflow_candidates_count: rejected.length,
          rejected_workflow_candidates: rejected.slice(0, 15),
        },
        warnings,
        errors: [],
        safe_json: wc,
      };
    } else {
      trace.workflow_catalog = {
        status: "skipped", elapsed_ms: 0,
        summary: "workflow_catalog dispatch not run (no workflow-* candidates)",
        key_fields: {}, warnings: [], errors: [], safe_json: null,
      };
    }
  }



  // 4b. Intent Arbitration (ARCH.1E)
  let arbitration: ReturnType<typeof arbitrateGuideV2Intent> | null = null;
  {
    const t = Date.now();
    try {
      arbitration = arbitrateGuideV2Intent({
        question,
        classification: classifierResult.classification,
        domainDiagnosis: (domainDiagnosis as unknown) as Parameters<typeof arbitrateGuideV2Intent>[0]["domainDiagnosis"],
        knowledgePack: pack,
        contextRoute,
        contextLabel,
      });
      const a = arbitration as unknown as Record<string, unknown>;
      const overrode = !!a.should_override_initial_intent;
      const warnings: string[] = [];
      if (overrode) warnings.push(`override:${a.initial_intent_type}->${a.final_intent_type}`);
      if ((a.safety_notes as string[]).length > 0) {
        warnings.push(`safety_notes:${(a.safety_notes as string[]).join(",")}`);
      }
      trace.intent_arbitration = {
        status: overrode ? "warn" : "pass",
        elapsed_ms: Date.now() - t,
        summary: `initial=${a.initial_intent_type} final=${a.final_intent_type} override=${overrode} reason=${a.override_reason}`,
        key_fields: {
          initial_intent_type: a.initial_intent_type,
          final_intent_type: a.final_intent_type,
          final_domain_situation: a.final_domain_situation,
          should_override_initial_intent: overrode,
          override_reason: a.override_reason,
          arbitration_source: a.arbitration_source,
          needs_live_data: a.needs_live_data,
          asks_assistant_to_act: a.asks_assistant_to_act,
          safety_notes: a.safety_notes,
          evidence_signals: a.evidence_signals,
          confidence: a.confidence,
        },
        warnings, errors: [], safe_json: a,
      };
    } catch (e) {
      trace.intent_arbitration = {
        status: "warn", elapsed_ms: Date.now() - t,
        summary: "arbitration_failed (continuing without)",
        key_fields: {}, warnings: ["arbitration_failed"],
        errors: [e instanceof Error ? e.message : "unknown"], safe_json: null,
      };
    }
  }

  // 4c. Reconciled state + effective Knowledge Pack rebuild (ARCH.1E-FIX.1)
  const reconciledState = buildEffectivePipelineState(
    classifierResult.classification,
    (domainDiagnosis as unknown) as Parameters<typeof buildEffectivePipelineState>[1],
    arbitration,
  );
  trace.reconciled_state = {
    status: reconciledState.knowledge_pack_rebuild_required ? "warn" : "pass",
    elapsed_ms: 0,
    summary: `classification=${reconciledState.classification_source} diagnosis=${reconciledState.diagnosis_source} rebuild=${reconciledState.knowledge_pack_rebuild_required} reason=${reconciledState.knowledge_pack_rebuild_reason}`,
    key_fields: {
      classification_source: reconciledState.classification_source,
      diagnosis_source: reconciledState.diagnosis_source,
      effective_intent_type: reconciledState.effective_classification.intent_type,
      effective_domain_situation: reconciledState.effective_domain_diagnosis?.domain_situation ?? null,
      effective_answer_strategy: reconciledState.effective_domain_diagnosis?.answer_strategy ?? null,
      effective_recommended_kc_slugs: reconciledState.effective_domain_diagnosis?.recommended_kc_slugs ?? [],
      effective_diagnosis_source: reconciledState.effective_domain_diagnosis?.diagnosis_source ?? null,
      effective_safety_notes: reconciledState.effective_domain_diagnosis?.safety_notes ?? [],
      knowledge_pack_rebuild_required: reconciledState.knowledge_pack_rebuild_required,
      knowledge_pack_rebuild_reason: reconciledState.knowledge_pack_rebuild_reason,
      effective_context_source: reconciledState.effective_context_source,
      trace_notes: reconciledState.trace_notes,
    },
    warnings: [], errors: [],
    safe_json: reconciledState,
  };

  const effectiveClassification = reconciledState.effective_classification;
  const effectiveDiagnosis = reconciledState.effective_domain_diagnosis;

  // 4d. STABILIZE.2 — Canonical Effective Decision (authoritative).
  const effectiveDecision = resolveGuideV2EffectiveDecision({
    question,
    classification: classifierResult.classification,
    domainDiagnosis: (domainDiagnosis as unknown) as Parameters<typeof resolveGuideV2EffectiveDecision>[0]["domainDiagnosis"],
    arbitration,
    reconciledState,
    contextRoute,
    contextLabel,
  });
  trace.effective_decision = {
    status: effectiveDecision.decision_source === "safety_veto" ? "warn" : "pass",
    elapsed_ms: 0,
    summary: `intent=${effectiveDecision.effective_intent_type} situation=${effectiveDecision.effective_domain_situation ?? "—"} source=${effectiveDecision.decision_source} confidence=${effectiveDecision.confidence.toFixed(2)}`,
    key_fields: {
      original_intent_type: effectiveDecision.original_intent_type,
      effective_intent_type: effectiveDecision.effective_intent_type,
      original_domain_situation: effectiveDecision.original_domain_situation,
      effective_domain_situation: effectiveDecision.effective_domain_situation,
      effective_answer_strategy: effectiveDecision.effective_answer_strategy,
      decision_source: effectiveDecision.decision_source,
      decision_reason: effectiveDecision.decision_reason,
      recommended_kc_slugs: effectiveDecision.recommended_kc_slugs,
      preferred_slugs: effectiveDecision.source_priority_policy.preferred_slugs,
      suppress_primary_source_families: effectiveDecision.source_priority_policy.suppress_primary_source_families,
      required_source_family: effectiveDecision.source_priority_policy.required_source_family,
      safe_navigation: effectiveDecision.safe_navigation,
      forbidden_navigation: effectiveDecision.forbidden_navigation,
      safety_mode: effectiveDecision.safety_mode,
      needs_live_data: effectiveDecision.needs_live_data,
      asks_assistant_to_act: effectiveDecision.asks_assistant_to_act,
      needs_verified_ui_steps: effectiveDecision.needs_verified_ui_steps,
      confidence: effectiveDecision.confidence,
      trace_notes: effectiveDecision.trace_notes,
    },
    warnings: effectiveDecision.decision_source === "safety_veto" ? ["safety_veto_active"] : [],
    errors: [],
    safe_json: effectiveDecision,
  };

  // STABILIZE.2-FIX.1: effective Knowledge Pack is now ALWAYS built from the
  // canonical effective decision (single authoritative state). The previous
  // "rebuild only when arbitration overrides" path is replaced by an
  // always-on effective KP that enforces source priority policy + nav rules.
  let effectivePack = pack;
  let packRebuilt = false;
  let edKpSignals: Record<string, unknown> | null = null;
  let effectivePackDebug: Awaited<ReturnType<typeof buildGuideV2KnowledgePackFromEffectiveDecision>>["debug"] | null = null;
  let rebuildError: string | null = null;
  {
    const t = Date.now();
    try {
      const ed = await buildGuideV2KnowledgePackFromEffectiveDecision({
        userClient, userId, organizationId,
        question, effectiveDecision,
        originalClassification: classifierResult.classification,
        originalDiagnosis: (domainDiagnosis as unknown) as Parameters<typeof buildGuideV2KnowledgePackFromEffectiveDecision>[0]["originalDiagnosis"],
        contextRoute, contextLabel, requestId: reqId,
        embeddingRuntime,
      });
      effectivePack = ed.pack;
      packRebuilt = true;
      edKpSignals = ed.effective_decision_signals as unknown as Record<string, unknown>;
      effectivePackDebug = ed.debug;
      const packAny = effectivePack as unknown as Record<string, unknown>;
      const primary = (packAny.primary_articles as Array<Record<string, unknown>>) ?? [];
      const supporting = (packAny.supporting_articles as Array<Record<string, unknown>>) ?? [];
      trace.knowledge_pack_effective = {
        status: primary.length === 0 ? "warn" : "pass",
        elapsed_ms: Date.now() - t,
        summary: `built_from_effective_decision primary=${primary.length} support=${supporting.length} preferred_used=${(edKpSignals?.preferred_slugs_used as string[] | undefined)?.length ?? 0} suppressed=${(edKpSignals?.suppressed_primary_slugs as string[] | undefined)?.length ?? 0}`,
        key_fields: {
          built_from_effective_decision: true,
          rebuilt_after_arbitration: reconciledState.knowledge_pack_rebuild_required,
          rebuild_reason: "effective_decision_authoritative",
          primary_count: primary.length,
          supporting_count: supporting.length,
          knowledge_sufficiency: packAny.knowledge_sufficiency,
          source_confidence: packAny.source_confidence,
          primary_slugs: primary.map((a) => a.slug),
          supporting_slugs: supporting.map((a) => a.slug),
          preferred_slugs: edKpSignals?.preferred_slugs ?? [],
          preferred_slugs_used: edKpSignals?.preferred_slugs_used ?? [],
          suppressed_primary_slugs: edKpSignals?.suppressed_primary_slugs ?? [],
          suppress_primary_source_families: edKpSignals?.suppress_primary_source_families ?? [],
          required_source_family: edKpSignals?.required_source_family ?? null,
          required_source_family_satisfied: edKpSignals?.required_source_family_satisfied ?? true,
          source_priority_applied: edKpSignals?.promotion_reasons ?? [],
        },
        warnings: (edKpSignals?.promotion_reasons as string[] | undefined)?.length
          ? ["effective_decision_source_priority_applied"]
          : [],
        errors: [],
        safe_json: {
          knowledge_pack_effective: effectivePack,
          effective_decision_signals: edKpSignals,
        },
      };
    } catch (e) {
      rebuildError = e instanceof Error ? e.message : "unknown";
      trace.knowledge_pack_effective = {
        status: "warn", elapsed_ms: Date.now() - t,
        summary: "effective_kp_failed (falling back to initial KP)",
        key_fields: { built_from_effective_decision: false, rebuild_error: rebuildError },
        warnings: ["effective_kp_failed"], errors: [rebuildError], safe_json: null,
      };
    }
  }

  // 4e. Workflow Catalog Dispatch (effective) — the deterministic semantic
  // gate re-runs inside the effective KP build with the effective decision's
  // synthesized classification/diagnosis. Surfacing it separately makes any
  // post-arbitration change in the selected workflow / dispatch kind visible.
  {
    const wc = (effectivePackDebug as unknown as Record<string, unknown> | null)?.workflow_catalog as
      | Record<string, unknown>
      | undefined;
    const wcInitial = (packDebug as unknown as Record<string, unknown>)?.workflow_catalog as
      | Record<string, unknown>
      | undefined;
    if (wc) {
      const dispatchKind = String(wc.dispatch_kind ?? "—");
      const selectedSlug = (wc.selected_workflow_slug as string | null) ?? null;
      const rejected = (wc.rejected_workflow_candidates as Array<Record<string, unknown>>) ?? [];
      const frame = (wc.selected_workflow_frame as Record<string, unknown> | null) ?? null;
      const initialSlug = (wcInitial?.selected_workflow_slug as string | null) ?? null;
      const initialDispatch = wcInitial ? String(wcInitial.dispatch_kind ?? "—") : "—";
      const changedSlug = initialSlug !== selectedSlug;
      const changedDispatch = initialDispatch !== dispatchKind;
      const warnings: string[] = [];
      let status: Status = "pass";
      if (dispatchKind === "clarification_needed") { status = "warn"; warnings.push("clarification_needed"); }
      else if (dispatchKind === "unsupported_safe_guidance") { status = "warn"; warnings.push("unsupported_safe_guidance"); }
      else if (dispatchKind === "action_refusal") { status = "warn"; warnings.push("action_refusal"); }
      if (changedSlug) warnings.push(`slug_changed_after_arbitration:${initialSlug ?? "—"}->${selectedSlug ?? "—"}`);
      if (changedDispatch) warnings.push(`dispatch_changed_after_arbitration:${initialDispatch}->${dispatchKind}`);

      trace.workflow_catalog_effective = {
        status,
        elapsed_ms: 0,
        summary: `dispatch=${dispatchKind} slug=${selectedSlug ?? "—"} frame=${frame ? `${frame.object_family}/${frame.action}${frame.generated_artifact_type ? `/${frame.generated_artifact_type}` : ""}` : "—"} rejected=${rejected.length}${changedSlug ? " [slug_changed]" : ""}`,
        key_fields: {
          dispatch_kind: dispatchKind,
          selected_workflow_slug: selectedSlug,
          selected_workflow_frame: frame,
          changed_after_arbitration: changedSlug || changedDispatch,
          initial_selected_workflow_slug: initialSlug,
          initial_dispatch_kind: initialDispatch,
          visible_workflow_articles: wc.visible_workflow_articles ?? null,
          metadata_ready_count: wc.metadata_ready_count ?? null,
          catalog_entries: wc.catalog_entries ?? null,
          rejected_workflow_candidates_count: rejected.length,
          rejected_workflow_candidates: rejected.slice(0, 15),
        },
        warnings,
        errors: [],
        safe_json: wc,
      };
    } else {
      trace.workflow_catalog_effective = {
        status: "skipped", elapsed_ms: 0,
        summary: rebuildError
          ? "skipped (effective KP failed)"
          : "workflow_catalog dispatch not re-run (no workflow-* candidates)",
        key_fields: {}, warnings: [], errors: [], safe_json: null,
      };
    }
  }




  // 5. Routing
  let routingResult: ReturnType<typeof routeGuideV2Request> | null = null;
  {
    const t = Date.now();
    try {
      routingResult = routeGuideV2RequestFromEffectiveDecision({
        effectiveDecision,
        knowledgePack: effectivePack,
        originalClassification: classifierResult.classification,
        originalDiagnosis: (domainDiagnosis as unknown) as Parameters<typeof routeGuideV2RequestFromEffectiveDecision>[0]["originalDiagnosis"],
        arbitration,
        contextRoute, contextLabel,
      });
      const r = routingResult as unknown as Record<string, unknown>;
      const reason = String(r.route_reason ?? "");
      const warnings: string[] = [];
      let status: Status = "pass";
      if (reason.includes("fallback") || reason.includes("override")) {
        warnings.push(`route_reason:${reason}`);
      }
      trace.routing = {
        status, elapsed_ms: Date.now() - t,
        summary: `mode=${r.answer_mode ?? "—"} wf=${r.workflow_id ?? "—"} reason=${reason || "—"}`,
        key_fields: {
          answer_mode: r.answer_mode,
          workflow_id: r.workflow_id,
          workflow_status: r.workflow_status,
          matched_workflow_title: r.matched_workflow_title,
          route_reason: r.route_reason,
          used_arbitration_override: r.used_arbitration_override,
          arbitration_reason: r.arbitration_reason,
          can_generate_procedural_steps: r.can_generate_procedural_steps,
          must_refuse_data_access: r.must_refuse_data_access,
          must_refuse_action_execution: r.must_refuse_action_execution,
          requires_safe_limit: r.requires_safe_limit,
          next_required_layer: r.next_required_layer,
        },
        warnings, errors: [], safe_json: r,
      };
    } catch (e) {
      trace.routing = {
        status: "fail", elapsed_ms: Date.now() - t,
        summary: "router_failed", key_fields: {}, warnings: [],
        errors: [e instanceof Error ? e.message : "unknown"], safe_json: null,
      };
    }
  }
  if (!routingResult) return finishEarly(trace, reqId, startedAt, tStart);

  // 6. Answer Plan
  let answerPlan: ReturnType<typeof planGuideV2Answer> | null = null;
  {
    const t = Date.now();
    try {
      const planned = planGuideV2AnswerFromEffectiveDecision({
        question, effectiveDecision, routingResult,
        knowledgePack: effectivePack,
        originalClassification: classifierResult.classification,
        originalDiagnosis: (domainDiagnosis as unknown) as Parameters<typeof planGuideV2AnswerFromEffectiveDecision>[0]["originalDiagnosis"],
        contextRoute, contextLabel,
      });
      answerPlan = planned.plan;
      const _planSignals = planned.effective_decision_signals;
      const p = answerPlan as unknown as Record<string, unknown>;
      const steps = (p.allowed_steps as Array<Record<string, unknown>>) ?? [];
      const mustSay = (p.must_say as string[]) ?? [];
      const mustNotSay = (p.must_not_say as string[]) ?? [];
      const grounding = (p.grounding_snippets as unknown[]) ?? [];
      const sourcesArr = (p.sources as Array<Record<string, unknown>>) ?? [];

      // OBS.1-FIX.1: source provenance — link every answer-plan source to its
      // origin (pack primary/supporting, diagnosis-injected, or fallback).
      const packAny2 = effectivePack as unknown as Record<string, unknown>;
      const primarySlugs = new Set(
        ((packAny2.primary_articles as Array<Record<string, unknown>>) ?? [])
          .map((a) => String(a.slug ?? "").toLowerCase()),
      );
      const supportingSlugs = new Set(
        ((packAny2.supporting_articles as Array<Record<string, unknown>>) ?? [])
          .map((a) => String(a.slug ?? "").toLowerCase()),
      );
      const recSlugSet = new Set(
        (((packDebug as unknown as Record<string, unknown>)?.retrieval_inputs as Record<string, unknown>)
          ?.diagnosis_recommended_kc_slugs as string[] ?? [])
          .map((s) => String(s ?? "").toLowerCase()),
      );
      const flow = (((packDebug as unknown as Record<string, unknown>)?.candidate_flow as Array<Record<string, unknown>>) ?? []);
      const flowBySlug = new Map<string, Record<string, unknown>>();
      for (const f of flow) flowBySlug.set(String(f.slug ?? "").toLowerCase(), f);
      const provenance = sourcesArr.map((s) => {
        const slug = String(s.slug ?? "").toLowerCase();
        const f = flowBySlug.get(slug);
        const inPrimary = primarySlugs.has(slug);
        const inSupport = supportingSlugs.has(slug);
        const fromDiag = !!f?.came_from_diagnosis || recSlugSet.has(slug);
        const fromVec = !!f?.came_from_vector;
        let prov = "unknown";
        if (inPrimary) prov = "primary_article";
        else if (inSupport) prov = "supporting_article";
        else if (fromDiag) prov = "diagnosis_recommended_slug";
        else if (p.safe_limit_reason) prov = "safe_limit_fallback_source";
        return {
          title: s.title, slug: s.slug, article_id: s.article_id ?? f?.article_id ?? null,
          provenance: prov,
          source_confidence: f?.source_confidence ?? null,
          came_from_vector: fromVec,
          came_from_diagnosis: fromDiag,
          came_from_fallback: !inPrimary && !inSupport && !fromDiag && !fromVec,
        };
      });
      const warnings: string[] = [];
      if (primarySlugs.size === 0 && supportingSlugs.size === 0 && sourcesArr.length > 0) {
        warnings.push("answer_plan_sources_without_pack_articles");
      }
      if (provenance.some((p) => p.provenance === "unknown")) warnings.push("source_provenance_unknown");

      trace.answer_plan = {
        status: warnings.length > 0 ? "warn" : "pass", elapsed_ms: Date.now() - t,
        summary: `mode=${p.answer_mode ?? "—"} shape=${(p.concept_answer_shape as string) ?? "—"} steps=${steps.length} must_say=${mustSay.length} must_not_say=${mustNotSay.length} safe_guidance=${((p.safe_guidance_points as string[]) ?? []).length}`,
        key_fields: {
          answer_mode: p.answer_mode,
          concept_answer_shape: (p.concept_answer_shape as string) ?? null,
          key_definitions: (p.key_definitions as unknown[]) ?? [],
          practical_distinctions: (p.practical_distinctions as string[]) ?? [],
          decision_rules: (p.decision_rules as string[]) ?? [],
          safe_examples: (p.safe_examples as string[]) ?? [],
          common_boundaries: (p.common_boundaries as string[]) ?? [],
          source_priority_notes: (p.source_priority_notes as string[]) ?? [],
          opening: p.opening,
          allowed_steps_count: steps.length,
          allowed_steps_titles: steps.map((s) => s.title ?? s.step_title ?? ""),
          must_say: mustSay,
          must_not_say: mustNotSay,
          grounding_snippets_count: grounding.length,
          safe_guidance_points: (p.safe_guidance_points as string[]) ?? [],
          safe_guidance_points_count: ((p.safe_guidance_points as string[]) ?? []).length,
          sources: sourcesArr.map((s) => ({ title: s.title, slug: s.slug })),
          source_provenance: provenance,
          guided_card: p.guided_card ?? null,
          safe_limit_reason: p.safe_limit_reason ?? null,
          planned_from_effective_decision: _planSignals.planned_from_effective_decision,
          safe_navigation_source: _planSignals.safe_navigation_source,
          forbidden_navigation_applied: _planSignals.forbidden_navigation_applied,
          primary_area: _planSignals.primary_area,
        },
        warnings, errors: [], safe_json: { ...p, source_provenance: provenance },
      };
    } catch (e) {
      trace.answer_plan = {
        status: "fail", elapsed_ms: Date.now() - t,
        summary: "planner_failed", key_fields: {}, warnings: [],
        errors: [e instanceof Error ? e.message : "unknown"], safe_json: null,
      };
    }
  }
  if (!answerPlan) return finishEarly(trace, reqId, startedAt, tStart);

  // 7. Rendering
  let renderedAnswer: Awaited<ReturnType<typeof renderGuideV2Answer>> | null = null;
  let renderSafety: ReturnType<typeof checkRenderSafety> | null = null;
  {
    const t = Date.now();
    try {
      renderedAnswer = await renderGuideV2Answer({
        question, classification: effectiveClassification,
        knowledgePack: effectivePack,
        routingResult, answerPlan, contextRoute, contextLabel, requestId: reqId,
        providerRuntime,
      });
      if (renderedAnswer.ok) {
        renderSafety = checkRenderSafety(renderedAnswer.answer, answerPlan);
      }
      const answerText = renderedAnswer.ok ? renderedAnswer.answer : "";
      const safetyFailed = renderSafety && Array.isArray(renderSafety.failed_checks)
        ? (renderSafety.failed_checks as unknown[])
        : [];
      const warnings: string[] = [];
      let status: Status = renderedAnswer.ok ? "pass" : "fail";
      if (safetyFailed.length > 0) { status = "warn"; warnings.push(`render_safety:${safetyFailed.length}`); }
      trace.rendering = {
        status, elapsed_ms: Date.now() - t,
        summary: `provider=${renderedAnswer.provider ?? "—"} len=${answerText.length} safety_failed=${safetyFailed.length}`,
        key_fields: {
          provider: renderedAnswer.provider,
          rendered_answer_length: answerText.length,
          render_safety_ok: !!renderSafety && safetyFailed.length === 0,
          failed_render_safety_checks: safetyFailed,
          safety_notes: renderedAnswer.safety_notes ?? [],
          render_error: renderedAnswer.error ?? null,
        },
        warnings, errors: renderedAnswer.ok ? [] : [String(renderedAnswer.error ?? "render_failed")],
        safe_json: {
          rendered_answer: answerText,
          render_safety: renderSafety,
        },
      };
    } catch (e) {
      trace.rendering = {
        status: "fail", elapsed_ms: Date.now() - t,
        summary: "renderer_threw", key_fields: {}, warnings: [],
        errors: [e instanceof Error ? e.message : "unknown"], safe_json: null,
      };
    }
  }

  // 8. Validation + 9. Final
  if (renderedAnswer) {
    const t = Date.now();
    const renderedText = renderedAnswer.ok ? renderedAnswer.answer : "";
    let validation = validateGuideV2Answer({
      question, classification: effectiveClassification,
      knowledgePack: effectivePack,
      routingResult, answerPlan, renderedAnswer: renderedText, renderSafety,
    });

    let regenerated = false;
    let failClosed = false;
    let regeneratedAnswer: Awaited<ReturnType<typeof renderGuideV2Answer>> | null = null;
    let validationAfter: typeof validation | null = null;
    let finalAnswer: string;
    let finalStatus: "returned" | "regenerated_once" | "fail_closed";

    if (validation.final_action === "return") {
      finalAnswer = renderedText;
      finalStatus = "returned";
    } else if (validation.final_action === "regenerate_once" && renderedAnswer.ok) {
      const reasons = [
        ...validation.violations,
        ...(validation.unsupported_claims ?? []),
      ].slice(0, 12).join("; ");
      try {
        regeneratedAnswer = await renderGuideV2Answer({
          question, classification: effectiveClassification,
          knowledgePack: effectivePack,
          routingResult, answerPlan, contextRoute, contextLabel,
          requestId: reqId, regenerationHint: reasons,
          providerRuntime,
        });
        regenerated = true;
      } catch { /* ignore */ }
      const regenText = regeneratedAnswer?.ok ? regeneratedAnswer.answer : "";
      const regenSafety = regeneratedAnswer?.ok ? checkRenderSafety(regeneratedAnswer.answer, answerPlan) : null;
      validationAfter = validateGuideV2Answer({
        question, classification: effectiveClassification,
        knowledgePack: effectivePack,
        routingResult, answerPlan, renderedAnswer: regenText,
        renderSafety: regenSafety, alreadyRegenerated: true,
      });
      if (validationAfter.severity !== "fail") {
        finalAnswer = regenText;
        finalStatus = "regenerated_once";
      } else {
        failClosed = true;
        finalAnswer = validationAfter.safe_fallback_answer
          ?? guideV2SafeFallbackAnswer(answerPlan.answer_mode);
        finalStatus = "fail_closed";
      }
    } else {
      failClosed = true;
      finalAnswer = validation.safe_fallback_answer
        ?? guideV2SafeFallbackAnswer(answerPlan.answer_mode);
      finalStatus = "fail_closed";
    }

    const finalValidation = validationAfter ?? validation;
    const sev = finalValidation.severity;
    const status: Status = sev === "fail" ? "fail" : sev === "warn" ? "warn" : "pass";

    trace.validation = {
      status, elapsed_ms: Date.now() - t,
      summary: `severity=${sev} action=${finalValidation.final_action} regenerated=${regenerated} fail_closed=${failClosed}`,
      key_fields: {
        severity: finalValidation.severity,
        final_action: finalValidation.final_action,
        regenerated,
        fail_closed: failClosed,
        violations: finalValidation.violations,
        unsupported_claims: finalValidation.unsupported_claims,
        speculative_ui_claims: finalValidation.speculative_ui_claims,
        operational_data_claims: finalValidation.operational_data_claims,
        action_completion_claims: finalValidation.action_completion_claims,
        internal_leakage_claims: finalValidation.internal_leakage_claims,
        source_mismatch_claims: finalValidation.source_mismatch_claims,
      },
      warnings: [], errors: [],
      safe_json: {
        first_pass: validation,
        regenerated_pass: validationAfter,
        safe_fallback_used: failClosed,
      },
    };

    // STABILIZE.1+2: pipeline invariants run after normal validation.
    const invariants = validateGuideV2PipelineInvariants({
      question,
      initialClassification: classifierResult.classification,
      originalDiagnosis: (domainDiagnosis as unknown) as Parameters<typeof validateGuideV2PipelineInvariants>[0]["originalDiagnosis"],
      arbitration,
      reconciledState,
      effectiveDecision,
      effectivePack,
      routingResult,
      answerPlan,
      renderedAnswer: renderedText,
      validation: finalValidation,
      finalAnswer,
    });
    let appliedReplacement = false;
    let repairedByInvariant = false;
    if (invariants.hard_block_final_return) {
      const replacement =
        invariants.replacement_answer ??
        guideV2SafeFallbackAnswer(answerPlan.answer_mode);
      finalAnswer = replacement;
      appliedReplacement = true;
      if (invariants.repaired_by_invariant) {
        // STABILIZE.2: useful deterministic safe answer produced → NOT fail_closed.
        repairedByInvariant = true;
        finalStatus = "repaired_by_invariant";
        failClosed = false;
      } else {
        finalStatus = "fail_closed";
        failClosed = true;
      }
    }
    trace.pipeline_invariants = {
      status: invariants.severity === "fail" ? "fail" : invariants.severity === "warn" ? "warn" : "pass",
      elapsed_ms: 0,
      summary: `severity=${invariants.severity} failures=${invariants.invariant_failures.length} warnings=${invariants.invariant_warnings.length} hard_block=${invariants.hard_block_final_return} recovery=${invariants.applied_recovery} repaired=${repairedByInvariant}`,
      key_fields: {
        ok: invariants.ok,
        severity: invariants.severity,
        invariant_failures: invariants.invariant_failures,
        invariant_warnings: invariants.invariant_warnings,
        hard_block_final_return: invariants.hard_block_final_return,
        applied_recovery: invariants.applied_recovery,
        final_answer_allowed: invariants.final_answer_allowed,
        replacement_applied: appliedReplacement,
        repaired_by_invariant: repairedByInvariant,
        effective_intent_type: invariants.diagnostics?.effective_intent_type ?? null,
        effective_domain_situation: invariants.diagnostics?.effective_domain_situation ?? null,
        used_arbitration_override: invariants.diagnostics?.used_arbitration_override ?? null,
        decision_source: invariants.diagnostics?.decision_source ?? null,
        decision_reason: invariants.diagnostics?.decision_reason ?? null,
      },
      warnings: invariants.invariant_warnings,
      errors: invariants.invariant_failures,
      safe_json: invariants,
    };

    // Sources from plan
    const planSources = ((answerPlan as unknown as Record<string, unknown>).sources as Array<Record<string, unknown>>) ?? [];
    trace.final = {
      status: invariants.severity === "fail" && !repairedByInvariant ? "fail" : status,
      elapsed_ms: Date.now() - tStart,
      summary: `${finalStatus} (${(finalAnswer ?? "").length} chars)${appliedReplacement ? (repairedByInvariant ? " [repaired_by_invariant]" : " [invariant_replacement]") : ""}`,
      key_fields: {
        final_status: finalStatus,
        final_answer_mode: (answerPlan as unknown as Record<string, unknown>).answer_mode,
        final_source_titles: planSources.map((s) => s.title ?? s.slug ?? ""),
        invariant_replacement_applied: appliedReplacement,
        repaired_by_invariant: repairedByInvariant,
        fail_closed: failClosed,
      },
      warnings: [], errors: [],
      safe_json: { final_answer: finalAnswer },
    };
  } else {
    trace.validation.status = "skipped";
    trace.pipeline_invariants.status = "skipped";
    trace.final.status = "skipped";
  }

  const completedAt = new Date().toISOString();
  return new Response(JSON.stringify({
    ok: true,
    version: VERSION,
    request_id: reqId,
    started_at: startedAt,
    completed_at: completedAt,
    elapsed_ms: Date.now() - tStart,
    trace,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

function finishEarly(
  trace: Record<string, Stage>,
  reqId: string,
  startedAt: string,
  tStart: number,
): Response {
  return new Response(JSON.stringify({
    ok: true,
    version: VERSION,
    request_id: reqId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    elapsed_ms: Date.now() - tStart,
    trace,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
