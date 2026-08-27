// AI-GUIDE.V2.1C — Admin-triggered reindex processor.
// Processes queued embedding jobs and populates ai_guide_v2_knowledge_chunks.
// Auth: org admin only. Writes via service-role (RLS deny-all on target tables).
// Does NOT generate answers, does NOT modify v1, does NOT wire frontend.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { embedGuideV2Texts } from "../_shared/ai-guide-v2/embedding-provider.ts";
import {
  buildChunksForArticle,
  type BuiltChunk,
  type KcArticleAiMetadataInput,
  type KcArticleInput,
} from "../_shared/ai-guide-v2/chunk-builder.ts";
import {
  resolveActiveOrganizationId,
  toSafeActiveOrganizationPublicError,
} from "../_shared/activeOrganizationContext.ts";
import {
  resolveGuideEmbeddingProviderRuntime,
  toSafeGuideEmbeddingPublicError,
  type GuideEmbeddingProviderRuntimeConfig,
} from "../_shared/guideEmbeddingProviderRuntime.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VERSION = "AI-GUIDE.V2.1C";
const EMBED_MODEL_LABEL = "text-embedding-3-small@1536";
const EMBED_DIMS = 1536 as const;
const BATCH_SIZE = 96;
const MAX_CHUNKS_PER_RUN = 6000; // soft cap to stay within edge timeout

interface ReindexBody {
  job_id?: string;
  scope?: "full" | "article" | "metadata" | "workflow";
  article_id?: string;
  force?: boolean;
}

interface RunStats {
  articles_seen: number;
  chunks_built: number;
  chunks_upserted: number;
  chunks_skipped_unchanged: number;
  chunks_archived_stale: number;
  embed_batches: number;
  embed_failures: number;
  excluded_archived: number;
  excluded_placeholder: number;
  excluded_draft: number;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function reqId(): string {
  return crypto.randomUUID();
}

async function resolveAuthenticatedUserId(
  userClient: SupabaseClient,
  token: string,
): Promise<string | null> {
  const { data: claimsRes, error: claimsErr } = await userClient.auth.getClaims(token);
  const claimsUserId = claimsRes?.claims?.sub;
  if (!claimsErr && typeof claimsUserId === "string" && claimsUserId.length > 0) {
    return claimsUserId;
  }

  const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
  if (!userErr && userRes?.user?.id) {
    return userRes.user.id;
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed", version: VERSION });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: "server not configured", version: VERSION });
  }

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { ok: false, error: "missing bearer token", version: VERSION });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const verifier = createSupabaseTokenVerifier(userClient);
    await assertBrowserSessionOnly(req, verifier);
  } catch (guardError) {
    return toSafeErrorResponse(guardError, corsHeaders);
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = authHeader.slice(7).trim();
  const userId = await resolveAuthenticatedUserId(userClient, token);
  if (!userId) {
    return json(401, { ok: false, error: "invalid token", version: VERSION });
  }

  // Phase 4D.14A.3D — canonical active-Organization resolution (never via
  // profiles.organization_id) and Org Admin check against it.
  let orgId: string;
  try {
    orgId = await resolveActiveOrganizationId(userClient);
  } catch (e) {
    const safe = toSafeActiveOrganizationPublicError(e);
    return json(403, { ok: false, error: safe.error, note: safe.note, version: VERSION });
  }
  const { data: isAdminData, error: isAdminErr } = await userClient.rpc("is_org_admin", {
    _user_id: userId, _organization_id: orgId,
  });
  if (isAdminErr || isAdminData !== true) {
    return json(403, { ok: false, error: "admin required", version: VERSION });
  }

  let body: ReindexBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid json body", version: VERSION });
  }

  // Acquire job
  let jobId: string | null = body.job_id ?? null;
  if (!jobId) {
    if (!body.scope || !["full", "article", "metadata", "workflow"].includes(body.scope)) {
      return json(400, { ok: false, error: "scope or job_id required", version: VERSION });
    }
    const { data: newJob, error: newJobErr } = await userClient.rpc(
      "ai_guide_v2_admin_reindex_knowledge",
      { p_scope: body.scope, p_article_id: body.article_id ?? null, p_force: body.force ?? false },
    );
    if (newJobErr || !newJob || newJob.length === 0) {
      return json(500, { ok: false, error: "could not create job", version: VERSION });
    }
    jobId = newJob[0].job_id as string;
  }

  // Load job row via admin client
  const { data: jobRow, error: jobErr } = await adminClient
    .from("ai_guide_v2_embedding_jobs").select("*").eq("id", jobId).single();
  if (jobErr || !jobRow) {
    return json(404, { ok: false, error: "job not found", version: VERSION });
  }
  if (jobRow.organization_id !== orgId) {
    return json(403, { ok: false, error: "cross-org job", version: VERSION });
  }
  if (!["queued", "failed"].includes(jobRow.status)) {
    return json(409, { ok: false, error: `job not runnable (status=${jobRow.status})`, version: VERSION });
  }

  const requestId = reqId();

  // Phase 4D.14A.3D — resolve embedding runtime BEFORE marking job running
  // and BEFORE reading/decrypting any article body. Failure here leaves the
  // job in its current state (never transitions to running, never falls
  // back to Global OpenAI credentials).
  let embeddingRuntime: GuideEmbeddingProviderRuntimeConfig;
  try {
    embeddingRuntime = await resolveGuideEmbeddingProviderRuntime({
      organizationId: jobRow.organization_id as string,
      functionName: "ai-guide-v2-reindex",
      reason: "btpm-guide-v2-reindex-embedding",
      requestId,
    });
  } catch (e) {
    const safe = toSafeGuideEmbeddingPublicError(e);
    return json(503, { ok: false, error: safe.error, note: safe.note, version: VERSION, job_id: jobId });
  }

  // Transition to running
  await adminClient.from("ai_guide_v2_embedding_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), error_code: null, error_summary: null })
    .eq("id", jobId);

  const stats: RunStats = {
    articles_seen: 0, chunks_built: 0, chunks_upserted: 0, chunks_skipped_unchanged: 0,
    chunks_archived_stale: 0, embed_batches: 0, embed_failures: 0,
    excluded_archived: 0, excluded_placeholder: 0, excluded_draft: 0,
  };
  const force = !!(jobRow.stats?.force);
  const scopeArticleId: string | null = jobRow.source_article_id ?? null;

  try {
    // Fetch articles (admin user sees all via RPC).
    // We need body/summary/tooltip text — use get_decrypted_knowledge_article per row.
    const { data: list, error: listErr } = await userClient.rpc(
      "list_decrypted_knowledge_articles",
      { _category_id: null, _include_unpublished: true },
    );
    if (listErr) throw new Error(`list_articles: ${listErr.message}`);

    const articles = ((list ?? []) as Array<Record<string, unknown>>).filter((r) => {
      if (scopeArticleId && r.id !== scopeArticleId) return false;
      return true;
    });

    // Pre-tally exclusions
    for (const a of articles) {
      const status = String(a.status);
      const at = String(a.article_type);
      const archivedAt = a.archived_at;
      if (at === "integration_placeholder") stats.excluded_placeholder++;
      else if (archivedAt || status === "archived") stats.excluded_archived++;
      else if (status === "draft") stats.excluded_draft++;
    }

    // Process only published+non-placeholder for active indexing
    const indexable = articles.filter((a) => {
      const status = String(a.status);
      const at = String(a.article_type);
      const archivedAt = a.archived_at;
      return status === "published" && at !== "integration_placeholder" && !archivedAt;
    });

    const allBuilt: BuiltChunk[] = [];
    for (const row of indexable) {
      if (allBuilt.length >= MAX_CHUNKS_PER_RUN) break;
      stats.articles_seen++;
      const articleId = String(row.id);

      // Fetch body via existing RPC (user JWT, admin sees all)
      const { data: detail, error: detailErr } = await userClient.rpc(
        "get_decrypted_knowledge_article", { _id: articleId },
      );
      if (detailErr || !detail || (detail as unknown[]).length === 0) continue;
      const d = (detail as Array<Record<string, unknown>>)[0];

      // Fetch AI metadata via visible RPC (admin)
      const { data: metaList } = await userClient.rpc(
        "list_knowledge_article_ai_metadata_for_visible_articles",
        { _article_ids: [articleId] },
      );
      const meta = ((metaList ?? []) as Array<Record<string, unknown>>)[0] ?? null;

      const articleInput: KcArticleInput = {
        id: articleId,
        organization_id: orgId,
        slug: String(d.slug ?? row.slug ?? ""),
        title: (d.title as string | null) ?? null,
        summary: (d.summary as string | null) ?? null,
        body: (d.body as string | null) ?? null,
        tooltip_excerpt: (d.tooltip_excerpt as string | null) ?? null,
        status: String(d.status ?? "draft"),
        article_type: String(d.article_type ?? "concept"),
        archived_at: (d.archived_at as string | null) ?? null,
        visibility: String(d.visibility ?? "all_users"),
        workspace_id: (d.workspace_id as string | null) ?? null,
        related_route: (d.related_route as string | null) ?? null,
        updated_at: String(d.updated_at ?? new Date().toISOString()),
      };
      const metaInput: KcArticleAiMetadataInput | null = meta ? {
        article_id: articleId,
        ai_flow: (meta.ai_flow as string | null) ?? null,
        feature_area: (meta.feature_area as string[] | null) ?? null,
        route_patterns: (meta.route_patterns as string[] | null) ?? null,
        user_intents: (meta.user_intents as string[] | null) ?? null,
        audience: (meta.audience as string[] | null) ?? null,
        synonyms: (meta.synonyms as string[] | null) ?? null,
        freshness_label: (meta.freshness_label as string | null) ?? null,
        question_examples: (meta.question_examples as string[] | null) ?? null,
        answer_rules: (meta.answer_rules as string[] | null) ?? null,
        forbidden_claims: (meta.forbidden_claims as string[] | null) ?? null,
      } : null;

      const built = await buildChunksForArticle(articleInput, metaInput, { embeddingModel: EMBED_MODEL_LABEL });
      stats.chunks_built += built.length;
      allBuilt.push(...built);
    }

    // Skip unchanged chunks unless force=true
    let toEmbed: BuiltChunk[] = allBuilt;
    if (!force && allBuilt.length > 0) {
      const keys = allBuilt.map((c) => c.content_hash);
      const sourceIds = allBuilt.map((c) => c.source_id);
      const { data: existing } = await adminClient
        .from("ai_guide_v2_knowledge_chunks")
        .select("source_id, content_hash, vector_ready")
        .eq("organization_id", orgId)
        .eq("embedding_model", EMBED_MODEL_LABEL)
        .in("source_id", sourceIds.slice(0, 1000))
        .in("content_hash", keys.slice(0, 1000));
      const existingSet = new Set(
        ((existing ?? []) as Array<{ source_id: string; content_hash: string; vector_ready: boolean }>)
          .filter((r) => r.vector_ready)
          .map((r) => `${r.source_id}::${r.content_hash}`),
      );
      const before = allBuilt.length;
      toEmbed = allBuilt.filter((c) => !existingSet.has(`${c.source_id}::${c.content_hash}`));
      stats.chunks_skipped_unchanged += before - toEmbed.length;
    }

    // Embed + upsert in batches
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      stats.embed_batches++;
      const res = await embedGuideV2Texts({
        texts: batch.map((c) => c.text_for_embedding),
        modelLabel: EMBED_MODEL_LABEL,
        dimensions: EMBED_DIMS,
        requestId,
        runtime: embeddingRuntime,
      });
      if (!res.ok || !res.embeddings) {
        stats.embed_failures++;
        throw new Error(`embed_failed:${res.error?.code ?? "unknown"}`);
      }
      const rows = batch.map((c, idx) => ({
        organization_id: c.organization_id,
        source_type: c.source_type,
        source_id: c.source_id,
        article_id: c.article_id,
        article_slug: c.article_slug,
        article_title: c.article_title,
        chunk_index: c.chunk_index,
        chunk_key: c.chunk_key,
        content_hash: c.content_hash,
        chunk_text_protected: null,
        chunk_text_preview: c.is_preview_safe ? c.chunk_text_preview : null,
        metadata: c.metadata,
        visibility_scope: c.visibility_scope,
        route_patterns: c.route_patterns,
        feature_area: c.feature_area,
        user_intents: c.user_intents,
        audience: null,
        freshness_label: c.freshness_label,
        workflow_id: null,
        workflow_status: null,
        embedding_model: EMBED_MODEL_LABEL,
        embedding_dimensions: 1536,
        embedding: res.embeddings![idx] as unknown as string, // pgvector accepts number[] via JSON
        vector_ready: true,
        source_status: c.source_status,
        indexed_at: new Date().toISOString(),
        source_updated_at: c.source_updated_at,
      }));
      const { error: upErr } = await adminClient
        .from("ai_guide_v2_knowledge_chunks")
        .upsert(rows, { onConflict: "organization_id,source_type,source_id,chunk_key,embedding_model" });
      if (upErr) throw new Error(`upsert_failed:${upErr.message}`);
      stats.chunks_upserted += rows.length;
    }

    // Mark stale: chunks for articles that are now archived/placeholder in this org
    const archivedIds = articles
      .filter((a) => {
        const status = String(a.status);
        const at = String(a.article_type);
        return at === "integration_placeholder" || status === "archived" || a.archived_at;
      })
      .map((a) => String(a.id));
    if (archivedIds.length) {
      const { data: arch, error: archErr } = await adminClient
        .from("ai_guide_v2_knowledge_chunks")
        .update({ source_status: "archived", vector_ready: false })
        .eq("organization_id", orgId)
        .in("article_id", archivedIds)
        .neq("source_status", "archived")
        .select("id");
      if (!archErr && arch) stats.chunks_archived_stale = arch.length;
    }

    await adminClient.from("ai_guide_v2_embedding_jobs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      stats,
    }).eq("id", jobId);

    return json(200, {
      ok: true, version: VERSION, job_id: jobId, status: "completed", stats,
      embedding: { model: EMBED_MODEL_LABEL, dimensions: EMBED_DIMS },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await adminClient.from("ai_guide_v2_embedding_jobs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_code: msg.split(":")[0] ?? "error",
      error_summary: msg.slice(0, 240),
      stats,
    }).eq("id", jobId);
    return json(500, { ok: false, version: VERSION, job_id: jobId, status: "failed", error: msg, stats });
  }
});
