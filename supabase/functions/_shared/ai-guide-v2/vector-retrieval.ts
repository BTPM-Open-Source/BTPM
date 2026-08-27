// AI-GUIDE.V2.2 — pgvector retrieval wrapper for the Knowledge Pack Builder.
// Calls ai_guide_v2_match_knowledge_chunks via an authenticated Supabase client
// (user-scoped JWT, RLS-enforced). Returns chunk-level candidates only —
// aggregation, visibility re-resolution, and source confidence live in
// knowledge-pack.ts.
//
// Hard rules:
// - never returns raw chunk text (RPC already strips it).
// - never returns embeddings.
// - never logs question text or vectors.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface VectorChunkCandidate {
  chunk_id: string;
  source_type: string;
  article_id: string | null;
  article_slug: string | null;
  article_title: string | null;
  source_id: string;
  similarity: number;
  hybrid_score: number;
  metadata: Record<string, unknown>;
  route_match: boolean;
  feature_match: boolean;
  workflow_match: boolean;
  source_confidence: string | null;
}

export interface VectorRetrievalRequest {
  client: SupabaseClient;
  organizationId: string;
  userId: string;
  queryEmbedding: number[];
  route?: string | null;
  featureArea?: string[] | null;
  intentType?: string | null;
  workflowId?: string | null;
  matchCount?: number;
  minSimilarity?: number;
}

export interface VectorRetrievalResult {
  ok: boolean;
  candidates: VectorChunkCandidate[];
  elapsed_ms: number;
  error?: string;
}

export async function matchKnowledgeChunks(
  req: VectorRetrievalRequest,
): Promise<VectorRetrievalResult> {
  const t0 = Date.now();
  const { data, error } = await req.client.rpc(
    "ai_guide_v2_match_knowledge_chunks",
    {
      query_embedding: req.queryEmbedding as unknown as string,
      p_organization_id: req.organizationId,
      p_user_id: req.userId,
      p_route: req.route ?? null,
      p_feature_area: req.featureArea ?? null,
      p_intent_type: req.intentType ?? null,
      p_workflow_id: req.workflowId ?? null,
      p_match_count: req.matchCount ?? 20,
      p_min_similarity: req.minSimilarity ?? 0,
    },
  );
  const elapsed_ms = Date.now() - t0;
  if (error) {
    return { ok: false, candidates: [], elapsed_ms, error: error.message };
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const candidates: VectorChunkCandidate[] = rows.map((r) => ({
    chunk_id: String(r.chunk_id ?? ""),
    source_type: String(r.source_type ?? ""),
    article_id: (r.article_id as string | null) ?? null,
    article_slug: (r.article_slug as string | null) ?? null,
    article_title: (r.article_title as string | null) ?? null,
    source_id: String(r.source_id ?? ""),
    similarity: Number(r.similarity ?? 0),
    hybrid_score: Number(r.hybrid_score ?? 0),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    route_match: !!r.route_match,
    feature_match: !!r.feature_match,
    workflow_match: !!r.workflow_match,
    source_confidence: (r.source_confidence as string | null) ?? null,
  }));
  return { ok: true, candidates, elapsed_ms };
}
