// AI-KC.2 — Knowledge Center AI metadata types
// These types describe the metadata side-table contract. They are intentionally
// not wired into visible UI yet (no behavior change in this step).

export type KnowledgeArticleAiFlow =
  | "direct_answer"
  | "page_aware"
  | "redirect"
  | "refuse_out_of_scope"
  | "troubleshooting"
  | "admin_guidance"
  | "output_guidance";

export type KnowledgeArticleFreshnessLabel =
  | "current"
  | "needs_review"
  | "deprecated"
  | "draft";

export interface KnowledgeArticleAiMetadata {
  article_id: string;
  ai_flow: KnowledgeArticleAiFlow;
  feature_area: string[];
  route_patterns: string[];
  user_intents: string[];
  audience: string[];
  synonyms: string[];
  freshness_label: KnowledgeArticleFreshnessLabel;
  related_feature_flags: string[];
  // Decrypted on read via admin/visible RPCs; never read from the table directly.
  question_examples: string[];
  answer_rules: string[];
  forbidden_claims: string[];
  updated_at: string;
}

export interface KnowledgeArticleAiMetadataInput {
  article_id: string;
  ai_flow?: KnowledgeArticleAiFlow;
  feature_area?: string[];
  route_patterns?: string[];
  user_intents?: string[];
  audience?: string[];
  synonyms?: string[];
  freshness_label?: KnowledgeArticleFreshnessLabel;
  related_feature_flags?: string[];
  question_examples?: string[];
  answer_rules?: string[];
  forbidden_claims?: string[];
}
