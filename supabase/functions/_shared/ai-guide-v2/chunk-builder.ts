// AI-GUIDE.V2.1C — Deterministic chunk builder for KC articles + AI metadata.
// Pure functions. No I/O, no logging of source content.

export type GuideV2SourceType =
  | "knowledge_article_title"
  | "knowledge_article_summary"
  | "knowledge_article_body_chunk"
  | "knowledge_article_tooltip"
  | "metadata_question_example"
  | "metadata_answer_rule"
  | "metadata_synonym"
  | "metadata_forbidden_claim";

export type GuideV2SourceStatus = "published" | "archived" | "draft" | "placeholder";

export interface KcArticleInput {
  id: string;
  organization_id: string;
  slug: string;
  title: string | null;
  summary: string | null;
  body: string | null;
  tooltip_excerpt: string | null;
  status: string;
  article_type: string;
  archived_at: string | null;
  visibility: string;
  workspace_id: string | null;
  related_route: string | null;
  updated_at: string;
}

export interface KcArticleAiMetadataInput {
  article_id: string;
  ai_flow: string | null;
  feature_area: string[] | null;
  route_patterns: string[] | null;
  user_intents: string[] | null;
  audience: string[] | null;
  synonyms: string[] | null;
  freshness_label: string | null;
  question_examples: string[] | null;
  answer_rules: string[] | null;
  forbidden_claims: string[] | null;
}

export interface BuiltChunk {
  organization_id: string;
  source_type: GuideV2SourceType;
  source_id: string;
  article_id: string;
  article_slug: string;
  article_title: string | null;
  chunk_index: number;
  chunk_key: string;
  content_hash: string;
  text_for_embedding: string;
  chunk_text_preview: string | null;
  is_preview_safe: boolean;
  metadata: Record<string, unknown>;
  visibility_scope: Record<string, unknown>;
  route_patterns: string[] | null;
  feature_area: string[] | null;
  user_intents: string[] | null;
  audience: string[] | null;
  freshness_label: string | null;
  source_status: GuideV2SourceStatus;
  source_updated_at: string;
}

function normalizeText(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function sha256(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function resolveSourceStatus(a: KcArticleInput): GuideV2SourceStatus {
  if (a.article_type === "integration_placeholder") return "placeholder";
  if (a.archived_at || a.status === "archived") return "archived";
  if (a.status === "draft") return "draft";
  if (a.status === "published") return "published";
  return "draft";
}

function splitBody(body: string): string[] {
  const norm = normalizeText(body);
  if (!norm) return [];
  // Split on headings or paragraph breaks
  const parts = norm.split(/\n(?=#{1,6}\s)|\n\n+/g).map((p) => p.trim()).filter(Boolean);
  const TARGET_MIN = 500;
  const TARGET_MAX = 1200;
  const out: string[] = [];
  let buf = "";
  for (const p of parts) {
    if (p.length > TARGET_MAX) {
      if (buf) { out.push(buf); buf = ""; }
      // split long paragraphs by sentence
      const sentences = p.split(/(?<=[.!?])\s+/g);
      let cur = "";
      for (const s of sentences) {
        if ((cur + " " + s).trim().length > TARGET_MAX && cur) {
          out.push(cur.trim());
          cur = s;
        } else {
          cur = (cur + " " + s).trim();
        }
      }
      if (cur) out.push(cur);
      continue;
    }
    if ((buf + "\n\n" + p).trim().length > TARGET_MAX && buf) {
      out.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) out.push(buf.trim());
  // Merge tiny tail chunks below TARGET_MIN
  const merged: string[] = [];
  for (const c of out) {
    if (merged.length && (merged[merged.length - 1].length + c.length + 2) <= TARGET_MAX && merged[merged.length - 1].length < TARGET_MIN) {
      merged[merged.length - 1] = merged[merged.length - 1] + "\n\n" + c;
    } else {
      merged.push(c);
    }
  }
  return merged;
}

interface BuildOptions {
  embeddingModel: string; // for metadata only; unique key includes model label
}

export async function buildChunksForArticle(
  article: KcArticleInput,
  metadata: KcArticleAiMetadataInput | null,
  opts: BuildOptions,
): Promise<BuiltChunk[]> {
  const status = resolveSourceStatus(article);
  const baseMeta = {
    ai_flow: metadata?.ai_flow ?? null,
    article_type: article.article_type,
    article_status: article.status,
    embedding_model: opts.embeddingModel,
  };
  const visibility_scope = {
    visibility: article.visibility,
    workspace_id: article.workspace_id,
    related_route: article.related_route,
  };
  const common = {
    organization_id: article.organization_id,
    article_id: article.id,
    article_slug: article.slug,
    article_title: article.title,
    metadata: baseMeta,
    visibility_scope,
    route_patterns: metadata?.route_patterns ?? (article.related_route ? [article.related_route] : null),
    feature_area: metadata?.feature_area ?? null,
    user_intents: metadata?.user_intents ?? null,
    audience: metadata?.audience ?? null,
    freshness_label: metadata?.freshness_label ?? null,
    source_status: status,
    source_updated_at: article.updated_at,
  };
  const out: BuiltChunk[] = [];
  if (status !== "published") {
    return out; // Only build active chunks for published content.
  }

  // Title
  if (article.title && article.title.trim()) {
    const t = normalizeText(article.title);
    out.push({
      ...common,
      source_type: "knowledge_article_title",
      source_id: `article:${article.id}:title`,
      chunk_index: 0,
      chunk_key: "title",
      content_hash: await sha256(t),
      text_for_embedding: t,
      chunk_text_preview: t.slice(0, 240),
      is_preview_safe: true,
    });
  }
  // Summary
  if (article.summary && article.summary.trim()) {
    const t = normalizeText(article.summary);
    out.push({
      ...common,
      source_type: "knowledge_article_summary",
      source_id: `article:${article.id}:summary`,
      chunk_index: 0,
      chunk_key: "summary",
      content_hash: await sha256(t),
      text_for_embedding: t,
      chunk_text_preview: t.slice(0, 240),
      is_preview_safe: true,
    });
  }
  // Tooltip
  if (article.tooltip_excerpt && article.tooltip_excerpt.trim()) {
    const t = normalizeText(article.tooltip_excerpt);
    out.push({
      ...common,
      source_type: "knowledge_article_tooltip",
      source_id: `article:${article.id}:tooltip`,
      chunk_index: 0,
      chunk_key: "tooltip",
      content_hash: await sha256(t),
      text_for_embedding: t,
      chunk_text_preview: null,
      is_preview_safe: false,
    });
  }
  // Body
  if (article.body && article.body.trim()) {
    const parts = splitBody(article.body);
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i];
      out.push({
        ...common,
        source_type: "knowledge_article_body_chunk",
        source_id: `article:${article.id}:body:${i}`,
        chunk_index: i,
        chunk_key: `body:${i}`,
        content_hash: await sha256(t),
        text_for_embedding: t,
        chunk_text_preview: null,
        is_preview_safe: false,
      });
    }
  }
  // Metadata-derived chunks
  if (metadata) {
    const qe = metadata.question_examples ?? [];
    for (let i = 0; i < qe.length; i++) {
      const t = normalizeText(qe[i] ?? "");
      if (!t) continue;
      out.push({
        ...common,
        source_type: "metadata_question_example",
        source_id: `article:${article.id}:qe:${i}`,
        chunk_index: i,
        chunk_key: `qe:${i}`,
        content_hash: await sha256(t),
        text_for_embedding: t,
        chunk_text_preview: null,
        is_preview_safe: false,
      });
    }
    const ar = metadata.answer_rules ?? [];
    for (let i = 0; i < ar.length; i++) {
      const t = normalizeText(ar[i] ?? "");
      if (!t) continue;
      out.push({
        ...common,
        source_type: "metadata_answer_rule",
        source_id: `article:${article.id}:ar:${i}`,
        chunk_index: i,
        chunk_key: `ar:${i}`,
        content_hash: await sha256(t),
        text_for_embedding: t,
        chunk_text_preview: null,
        is_preview_safe: false,
      });
    }
    const syn = (metadata.synonyms ?? []).filter((s) => s && s.trim());
    if (syn.length) {
      const t = normalizeText(syn.join(", "));
      out.push({
        ...common,
        source_type: "metadata_synonym",
        source_id: `article:${article.id}:syn`,
        chunk_index: 0,
        chunk_key: "syn",
        content_hash: await sha256(t),
        text_for_embedding: t,
        chunk_text_preview: null,
        is_preview_safe: false,
      });
    }
    const fc = metadata.forbidden_claims ?? [];
    for (let i = 0; i < fc.length; i++) {
      const t = normalizeText(fc[i] ?? "");
      if (!t) continue;
      out.push({
        ...common,
        source_type: "metadata_forbidden_claim",
        source_id: `article:${article.id}:fc:${i}`,
        chunk_index: i,
        chunk_key: `fc:${i}`,
        content_hash: await sha256(t),
        text_for_embedding: t,
        chunk_text_preview: null,
        is_preview_safe: false,
      });
    }
  }
  return out;
}
