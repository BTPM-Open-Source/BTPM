// AI-GUIDE.V2 — active user-facing BTPM Guide runtime.
//
// Phase 4D.14A.3C wired this endpoint as the primary Guide chat runtime for
// end users. V1 (`ai-help-chat`) is retained only as an emergency
// break-glass path. This function still MUST NOT persist messages here (the
// V1 route continues to own conversation persistence) and MUST NOT expose
// internal transport metadata (raw chunk text, embeddings, provider
// secrets, or text-model identifiers) in browser responses.
//
// Hard separation:
//   - Must NOT import from supabase/functions/ai-help-chat/index.ts
//   - Must NOT reuse v1 keyword/router/prompt logic
//   - Must NOT return raw chunk text, embeddings, provider secrets, or
//     text-model identifiers (provider labels only).

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

// Kept in lockstep with supabase/functions/ai-guide-v2-trace/index.ts VERSION
// so the user-facing sidecar and the Admin Pipeline Trace always report the
// same runtime label. Pipeline modules are already shared.
const VERSION = "AI-GUIDE.V2-STABILIZE.2-OBS.2";
const MAX_QUESTION_LEN = 2000;
type Mode =
  | "classify_only"
  | "diagnose_only"
  | "knowledge_pack_only"
  | "route_only"
  | "plan_only"
  | "render_only"
  | "validate_only";
const DEFAULT_MODE: Mode = "classify_only";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("method_not_allowed", "Use POST.", 405, DEFAULT_MODE);

  const reqId = crypto.randomUUID();
  const tStart = Date.now();

  // --- Auth ---
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return errorJson("unauthorized", "Missing bearer token.", 401, DEFAULT_MODE);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnon) {
    return errorJson("server_misconfigured", "Auth not configured.", 500, DEFAULT_MODE);
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
  if (userErr || !userData?.user) {
    return errorJson("unauthorized", "Unauthorized.", 401, DEFAULT_MODE);
  }
  const userId = userData.user.id;

  // Phase 4D.14A.3C — active Organization comes only from get_my_active_context.
  // Provider runtime (OpenAI or Azure) is resolved lazily on the first LLM call.
  let organizationId: string;
  try {
    organizationId = await resolveActiveOrganizationId(userClient);
  } catch (e) {
    const safe = toSafeActiveOrganizationPublicError(e);
    return errorJson(safe.error, safe.note, 403, DEFAULT_MODE);
  }

  return await handleGuideV2Request({
    req,
    reqId,
    tStart,
    userClient,
    userId,
    organizationId,
  });
});

async function handleGuideV2Request(ctx: {
  req: Request;
  reqId: string;
  tStart: number;
  userClient: ReturnType<typeof createClient>;
  userId: string;
  organizationId: string;
}): Promise<Response> {
  const {
    req,
    reqId,
    tStart,
    userClient,
    userId,
    organizationId,
  } = ctx;
  void userId;

  // --- Body parse ---
  let body: {
    question?: unknown;
    context_route?: unknown;
    context_label?: unknown;
    conversation_id?: unknown;
    mode?: unknown;
    debug?: unknown;
  } = {};
  try {
    body = await req.json();
  } catch {
    return errorJson("bad_request", "Invalid JSON body.", 400, DEFAULT_MODE);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return errorJson("bad_request", "Field 'question' is required.", 400, DEFAULT_MODE);
  if (question.length > MAX_QUESTION_LEN) {
    return errorJson("bad_request", `Field 'question' exceeds ${MAX_QUESTION_LEN} chars.`, 400, DEFAULT_MODE);
  }

  const contextRoute = typeof body.context_route === "string" ? body.context_route.slice(0, 200) : null;
  const contextLabel = typeof body.context_label === "string" ? body.context_label.slice(0, 200) : null;
  const wantDebug = body.debug === true;
  const allowedModes: Mode[] = [
    "classify_only",
    "diagnose_only",
    "knowledge_pack_only",
    "route_only",
    "plan_only",
    "render_only",
    "validate_only",
  ];
  const mode: Mode = allowedModes.includes(body.mode as Mode)
    ? (body.mode as Mode)
    : DEFAULT_MODE;

  // Phase 4D.14A.3C.1 — resolve the request-scoped provider runtime exactly
  // once, inline, after body validation and before any LLM call. The same
  // `runtime` value is reused for the classifier, domain diagnosis, initial
  // render, and regenerate-once. No nested closure, no mutable error slot,
  // and no fallback to Global OpenAI credentials.
  let runtime: GuideTextProviderRuntimeConfig;
  try {
    runtime = await resolveGuideTextProviderRuntime({
      organizationId,
      functionName: "ai-guide-v2-chat",
      reason: "btpm-guide-v2-chat",
      requestId: reqId,
    });
  } catch (e) {
    const safe = toSafeGuideProviderPublicError(e);
    console.error(
      `[ai-guide-v2-chat] provider_runtime_unavailable code=${safe.error} req=${reqId}`,
    );
    return errorJson(safe.error, safe.note, 503, mode);
  }


  // --- Classify (always) ---
  const tClassify = Date.now();
  let classifierResult;
  try {
    classifierResult = await classifyGuideV2Intent({
      message: question,
      contextRoute,
      contextLabel,
      requestId: reqId,
      providerRuntime: runtime,
    });
  } catch {
    console.error(`[ai-guide-v2-chat] classify_failed req=${reqId}`);
    return errorJson("classifier_failed", "Classification failed.", 502, mode);
  }
  const classifier_ms = Date.now() - tClassify;

  // --- classify_only short-circuit ---
  if (mode === "classify_only") {
    const responseBody: Record<string, unknown> = {
      ok: true,
      version: VERSION,
      mode,
      classification: classifierResult.classification,
    };
    if (wantDebug) {
      responseBody.debug = {
        ...classifierResult.debug,
        request_id: reqId,
        elapsed_ms: Date.now() - tStart,
        classifier_ms,
      };
    }
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- diagnose_only short-circuit ---
  if (mode === "diagnose_only") {
    const tDiag = Date.now();
    let diagnosisResult;
    try {
      diagnosisResult = await diagnoseGuideV2Domain({
        question,
        classification: classifierResult.classification,
        contextRoute,
        contextLabel,
        requestId: reqId,
        providerRuntime: runtime,
      });
    } catch {
      console.error(`[ai-guide-v2-chat] diagnose_failed req=${reqId}`);
      return errorJson("diagnosis_failed", "Domain diagnosis failed.", 502, mode);
    }
    const diagnosis_ms = Date.now() - tDiag;
    const responseBody: Record<string, unknown> = {
      ok: true,
      version: VERSION,
      mode,
      classification: classifierResult.classification,
      domain_diagnosis: diagnosisResult.diagnosis,
    };
    if (wantDebug) {
      responseBody.debug = {
        ...classifierResult.debug,
        request_id: reqId,
        elapsed_ms: Date.now() - tStart,
        classifier_ms,
        diagnosis_ms,
        diagnosis_debug: redactModelFromDebug(diagnosisResult.debug),
      };
    }
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ARCH.1B: run domain diagnosis between classification and retrieval, so
  // the knowledge pack, router, and planner can use ontology-grounded hints.
  let diagnosisResultMain: Awaited<ReturnType<typeof diagnoseGuideV2Domain>> | null = null;
  try {
    diagnosisResultMain = await diagnoseGuideV2Domain({
      question,
      classification: classifierResult.classification,
      contextRoute,
      contextLabel,
      requestId: reqId,
      providerRuntime: runtime,
    });
  } catch {
    console.error(`[ai-guide-v2-chat] diagnose_main_failed req=${reqId}`);
  }
  const domainDiagnosis = diagnosisResultMain?.diagnosis ?? null;

  // Phase 4D.14A.3D — resolve embedding runtime ONCE per invocation, after
  // classification/diagnosis, only when the execution path will retrieve.
  // Skip for intents that intentionally bypass broad retrieval.
  const embedIntent = classifierResult.classification.intent_type;
  const needsEmbedding = embedIntent !== "prompt_injection" && embedIntent !== "out_of_scope";
  let embeddingRuntime: GuideEmbeddingProviderRuntimeConfig | null = null;
  if (needsEmbedding) {
    try {
      embeddingRuntime = await resolveGuideEmbeddingProviderRuntime({
        organizationId,
        functionName: "ai-guide-v2-chat",
        reason: "btpm-guide-v2-query-embedding",
        requestId: reqId,
      });
    } catch (e) {
      const safe = toSafeGuideEmbeddingPublicError(e);
      console.error(
        `[ai-guide-v2-chat] embedding_runtime_unavailable code=${safe.error} req=${reqId}`,
      );
      return errorJson(safe.error, safe.note, 503, mode);
    }
  }

  // Initial (diagnostic) knowledge pack — used only to feed arbitration with
  // article/source evidence. STABILIZE.2-FIX.1: the downstream effective pack
  // is rebuilt from the canonical effective decision below.
  let packResult;
  try {
    packResult = await buildGuideV2KnowledgePack({
      userClient,
      userId,
      organizationId,
      question,
      classification: classifierResult.classification,
      contextRoute,
      contextLabel,
      requestId: reqId,
      domainDiagnosis,
      embeddingRuntime,
    });
  } catch (e) {
    console.error(`[ai-guide-v2-chat] knowledge_pack_failed req=${reqId}`, e instanceof Error ? e.message : "unknown");
    return errorJson("knowledge_pack_failed", "Knowledge pack build failed.", 502, mode);
  }

  // Evidence-aware intent arbitration between initial KP and routing.
  const arbitration = arbitrateGuideV2Intent({
    question,
    classification: classifierResult.classification,
    domainDiagnosis,
    knowledgePack: packResult.pack,
    contextRoute,
    contextLabel,
  });

  // Reconciled (diagnostic/intermediate) state retained for trace continuity.
  const reconciledState = buildEffectivePipelineState(
    classifierResult.classification,
    domainDiagnosis,
    arbitration,
  );
  const initialPackSummary = {
    primary_count: packResult.pack.primary_articles.length,
    supporting_count: packResult.pack.supporting_articles.length,
    knowledge_sufficiency: packResult.pack.knowledge_sufficiency,
    source_confidence: packResult.pack.source_confidence,
  };

  // STABILIZE.2: canonical effective decision (single authoritative state).
  const effectiveDecision = resolveGuideV2EffectiveDecision({
    question,
    classification: classifierResult.classification,
    domainDiagnosis: domainDiagnosis,
    arbitration,
    reconciledState,
    contextRoute,
    contextLabel,
  });

  // STABILIZE.2-FIX.1: effective Knowledge Pack is built from the canonical
  // effective decision. Source priority policy (preferred / suppressed slugs
  // and required source family) is enforced here, not in invariants.
  let effectivePack = packResult.pack;
  let packRebuilt = false;
  let edKpSignals: Record<string, unknown> | null = null;
  try {
    const ed = await buildGuideV2KnowledgePackFromEffectiveDecision({
      userClient,
      userId,
      organizationId,
      question,
      effectiveDecision,
      originalClassification: classifierResult.classification,
      originalDiagnosis: domainDiagnosis,
      contextRoute,
      contextLabel,
      requestId: reqId,
      embeddingRuntime,
    });
    effectivePack = ed.pack;
    packRebuilt = true;
    edKpSignals = ed.effective_decision_signals as unknown as Record<string, unknown>;
  } catch (e) {
    console.error(`[ai-guide-v2-chat] effective_kp_failed req=${reqId}`, e instanceof Error ? e.message : "unknown");
  }

  const needsRouting =
    mode === "route_only" || mode === "plan_only" || mode === "render_only" || mode === "validate_only";
  const routingResult = needsRouting
    ? routeGuideV2RequestFromEffectiveDecision({
        effectiveDecision,
        knowledgePack: effectivePack,
        originalClassification: classifierResult.classification,
        originalDiagnosis: domainDiagnosis,
        arbitration,
        contextRoute,
        contextLabel,
      })
    : null;

  const needsPlan = mode === "plan_only" || mode === "render_only" || mode === "validate_only";
  const plannedFromEd = needsPlan && routingResult
    ? planGuideV2AnswerFromEffectiveDecision({
        question,
        effectiveDecision,
        routingResult,
        knowledgePack: effectivePack,
        originalClassification: classifierResult.classification,
        originalDiagnosis: domainDiagnosis,
        contextRoute,
        contextLabel,
      })
    : null;
  const answerPlan = plannedFromEd?.plan ?? null;
  // Align with ai-guide-v2-trace runtime: renderer + validator must run against
  // the post-arbitration effective classification/diagnosis, not the raw
  // classifier output. This keeps the V1 vs V2 Evaluation surface on the same
  // runtime/version as the Pipeline Trace.
  const effectiveClassification = reconciledState.effective_classification;
  const effectiveDiagnosis = reconciledState.effective_domain_diagnosis;
  void effectiveDiagnosis;


  // --- render_only / validate_only generate the user-facing answer ---
  let renderedAnswer: Awaited<ReturnType<typeof renderGuideV2Answer>> | null = null;
  let renderSafety: ReturnType<typeof checkRenderSafety> | null = null;
  const needsRender = (mode === "render_only" || mode === "validate_only") && routingResult && answerPlan;
  if (needsRender && routingResult && answerPlan) {
    try {
      renderedAnswer = await renderGuideV2Answer({
        question,
        classification: effectiveClassification,
        knowledgePack: effectivePack,
        routingResult,
        answerPlan,
        contextRoute,
        contextLabel,
        requestId: reqId,
        providerRuntime: runtime,
      });
      if (renderedAnswer.ok) {
        renderSafety = checkRenderSafety(renderedAnswer.answer, answerPlan);
      }
    } catch {
      console.error(`[ai-guide-v2-chat] render_failed req=${reqId}`);
      return errorJson("renderer_failed", "Renderer failed.", 502, mode);
    }
  }

  // --- validate_only: run validator, regenerate once on fail, fail closed otherwise ---
  let validation: ReturnType<typeof validateGuideV2Answer> | null = null;
  let finalAnswer: string | null = null;
  let regenerated = false;
  let failClosed = false;
  let regeneratedAnswer: Awaited<ReturnType<typeof renderGuideV2Answer>> | null = null;
  let regeneratedSafety: ReturnType<typeof checkRenderSafety> | null = null;
  let validationAfterRegen: ReturnType<typeof validateGuideV2Answer> | null = null;

  if (mode === "validate_only" && routingResult && answerPlan && renderedAnswer) {
    const renderedText = renderedAnswer.ok ? renderedAnswer.answer : "";
    validation = validateGuideV2Answer({
      question,
      classification: effectiveClassification,
      knowledgePack: effectivePack,
      routingResult,
      answerPlan,
      renderedAnswer: renderedText,
      renderSafety,
    });

    if (validation.final_action === "return") {
      finalAnswer = renderedText;
    } else if (validation.final_action === "regenerate_once" && renderedAnswer.ok) {
      // One stricter regeneration attempt.
      const reasons = [
        ...validation.violations,
        ...validation.unsupported_claims.map((c) => `unsupported:${c}`),
        ...validation.speculative_ui_claims.map((c) => `speculative:${c}`),
        ...validation.operational_data_claims.map((c) => `live_data:${c}`),
        ...validation.action_completion_claims.map((c) => `action_completion:${c}`),
        ...validation.internal_leakage_claims.map((c) => `internal_leakage:${c}`),
        ...validation.source_mismatch_claims.map((c) => `source_mismatch:${c}`),
      ].slice(0, 12).join("; ");
      try {
        regeneratedAnswer = await renderGuideV2Answer({
          question,
          classification: effectiveClassification,
          knowledgePack: effectivePack,
          routingResult,
          answerPlan,
          contextRoute,
          contextLabel,
          requestId: reqId,
          regenerationHint: reasons,
          providerRuntime: runtime,
        });
        regenerated = true;
        if (regeneratedAnswer.ok) {
          regeneratedSafety = checkRenderSafety(regeneratedAnswer.answer, answerPlan);
        }
      } catch {
        console.error(`[ai-guide-v2-chat] regenerate_failed req=${reqId}`);
      }
      const regenText = regeneratedAnswer?.ok ? regeneratedAnswer.answer : "";
      validationAfterRegen = validateGuideV2Answer({
        question,
        classification: effectiveClassification,
        knowledgePack: effectivePack,
        routingResult,
        answerPlan,
        renderedAnswer: regenText,
        renderSafety: regeneratedSafety,
        alreadyRegenerated: true,
      });
      if (validationAfterRegen.severity !== "fail") {
        finalAnswer = regenText;
      } else {
        failClosed = true;
        finalAnswer = validationAfterRegen.safe_fallback_answer
          ?? guideV2SafeFallbackAnswer(answerPlan.answer_mode);
      }
    } else {
      // fail_closed straight away
      failClosed = true;
      finalAnswer = validation.safe_fallback_answer
        ?? guideV2SafeFallbackAnswer(answerPlan.answer_mode);
    }
  }

  // --- STABILIZE.1+2: pipeline invariants. Runs AFTER normal validation. ---
  let pipelineInvariants: ReturnType<typeof validateGuideV2PipelineInvariants> | null = null;
  if (mode === "validate_only" && answerPlan) {
    pipelineInvariants = validateGuideV2PipelineInvariants({
      question,
      initialClassification: classifierResult.classification,
      originalDiagnosis: domainDiagnosis,
      arbitration,
      reconciledState,
      effectiveDecision,
      effectivePack,
      routingResult,
      answerPlan,
      renderedAnswer: renderedAnswer?.ok ? renderedAnswer.answer : "",
      validation,
      finalAnswer: finalAnswer ?? "",
    });
    if (pipelineInvariants.hard_block_final_return) {
      finalAnswer =
        pipelineInvariants.replacement_answer ??
        guideV2SafeFallbackAnswer(answerPlan.answer_mode);
      // STABILIZE.2: when a useful deterministic safe answer is produced,
      // mark as repaired (NOT fail_closed). Only fail closed when no
      // replacement could be produced.
      if (pipelineInvariants.repaired_by_invariant) {
        failClosed = false;
      } else {
        failClosed = true;
      }
    }
  }

  const responseBody: Record<string, unknown> = {
    ok: true,
    version: VERSION,
    request_id: reqId,
    mode,
    classification: classifierResult.classification,
    domain_diagnosis: domainDiagnosis,
    intent_arbitration: arbitration,
    reconciled_state: {
      ...reconciledState,
      knowledge_pack_rebuilt: packRebuilt,
      initial_knowledge_pack_summary: initialPackSummary,
    },
    effective_decision: effectiveDecision,
    knowledge_pack: packResult.pack,
    knowledge_pack_effective: effectivePack,
    knowledge_pack_effective_signals: edKpSignals,
  };
  if (routingResult) responseBody.routing_result = routingResult;
  if (answerPlan) {
    responseBody.answer_plan = answerPlan;
    responseBody.answer_plan_effective_signals =
      plannedFromEd?.effective_decision_signals ?? null;
  }
  if (renderedAnswer) {
    // Phase 4D.14A.3C.1 — text-model identifier is intentionally omitted
    // from browser-facing JSON. Provider label may remain.
    responseBody.rendered_answer = {
      ok: renderedAnswer.ok,
      answer: renderedAnswer.answer,
      provider: renderedAnswer.provider,
      safety_notes: renderedAnswer.safety_notes ?? [],
      error: renderedAnswer.error,
    };
  }
  if (renderSafety) responseBody.render_safety = renderSafety;
  if (mode === "validate_only") {
    responseBody.validation = validation;
    responseBody.pipeline_invariants = pipelineInvariants;
    responseBody.regenerated = regenerated;
    responseBody.fail_closed = failClosed;
    responseBody.final_answer = finalAnswer;
    if (regenerated && regeneratedAnswer) {
      // Phase 4D.14A.3C.1 — text-model identifier omitted from browser JSON.
      responseBody.regenerated_answer = {
        ok: regeneratedAnswer.ok,
        answer: regeneratedAnswer.answer,
        provider: regeneratedAnswer.provider,
        safety_notes: regeneratedAnswer.safety_notes ?? [],
        error: regeneratedAnswer.error,
      };
      responseBody.regenerated_render_safety = regeneratedSafety;
      responseBody.validation_after_regenerate = validationAfterRegen;
    }
  }
  if (wantDebug) {
    responseBody.debug = {
      request_id: reqId,
      elapsed_ms: Date.now() - tStart,
      classifier_ms,
      embedding_ms: packResult.debug.embedding_ms,
      vector_match_ms: packResult.debug.vector_match_ms,
      visibility_resolution_ms: packResult.debug.visibility_resolution_ms,
      candidates_seen: packResult.debug.candidates_seen,
      articles_after_aggregation: packResult.debug.articles_after_aggregation,
      articles_after_visibility: packResult.debug.articles_after_visibility,
      excluded_sources: packResult.debug.excluded_sources,
    };
  }
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}


// Phase 4D.14A.3C.1 — strip any `model` field from an internal debug object
// before it is returned in a browser response. Provider labels may remain.
function redactModelFromDebug(debug: unknown): unknown {
  if (!debug || typeof debug !== "object") return debug;
  const { model: _model, ...rest } = debug as Record<string, unknown>;
  void _model;
  return rest;
}

function errorJson(code: string, message: string, status: number, mode: Mode): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      version: VERSION,
      mode,
      error: { code, message },
    }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
