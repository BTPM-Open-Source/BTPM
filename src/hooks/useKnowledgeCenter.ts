import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type KnowledgeArticleStatus = "draft" | "published" | "archived";
export type KnowledgeArticleVisibility = "all_users" | "admin_only" | "workspace_scoped";
export type KnowledgeArticleType =
  | "concept"
  | "how_to"
  | "rulebook"
  | "faq"
  | "release_note"
  | "admin"
  | "integration_placeholder";

export interface KnowledgeCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

export interface KnowledgeArticleListItem {
  id: string;
  category_id: string;
  title: string;
  slug: string;
  article_type: KnowledgeArticleType;
  summary: string | null;
  tooltip_excerpt: string | null;
  status: KnowledgeArticleStatus;
  visibility: KnowledgeArticleVisibility;
  related_route: string | null;
  related_object_type: string | null;
  related_object_id: string | null;
  workspace_id: string | null;
  owner_id: string | null;
  version: number;
  published_at: string | null;
  archived_at: string | null;
  updated_at: string;
}

export interface KnowledgeArticleDetail extends KnowledgeArticleListItem {
  body: string | null;
}

export const knowledgeKeys = {
  categories: ["kc", "categories"] as const,
  articles: (categoryId: string | null, includeUnpublished: boolean) =>
    ["kc", "articles", categoryId ?? "all", includeUnpublished] as const,
  article: (id: string) => ["kc", "article", id] as const,
};

export function useKnowledgeCategories() {
  return useQuery({
    queryKey: knowledgeKeys.categories,
    queryFn: async (): Promise<KnowledgeCategory[]> => {
      const { data, error } = await supabase.rpc("list_decrypted_knowledge_categories");
      if (error) throw error;
      return (data ?? []) as KnowledgeCategory[];
    },
  });
}

export function useKnowledgeArticles(categoryId: string | null, includeUnpublished: boolean) {
  return useQuery({
    queryKey: knowledgeKeys.articles(categoryId, includeUnpublished),
    queryFn: async (): Promise<KnowledgeArticleListItem[]> => {
      const { data, error } = await supabase.rpc("list_decrypted_knowledge_articles", {
        _category_id: categoryId,
        _include_unpublished: includeUnpublished,
      });
      if (error) throw error;
      return (data ?? []) as KnowledgeArticleListItem[];
    },
  });
}

export function useKnowledgeArticle(id: string | null) {
  return useQuery({
    queryKey: id ? knowledgeKeys.article(id) : ["kc", "article", "none"],
    queryFn: async (): Promise<KnowledgeArticleDetail | null> => {
      if (!id) return null;
      const { data, error } = await supabase.rpc("get_decrypted_knowledge_article", { _id: id });
      if (error) throw error;
      return (data?.[0] ?? null) as KnowledgeArticleDetail | null;
    },
    enabled: !!id,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["kc"] });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      slug: string;
      description?: string | null;
      sort_order?: number;
    }) => {
      const { data, error } = await supabase.rpc("kc_admin_create_category", {
        _name: input.name,
        _slug: input.slug,
        _description: input.description ?? null,
        _sort_order: input.sort_order ?? 0,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Category created");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create category"),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string | null;
      slug?: string | null;
      description?: string | null;
      sort_order?: number | null;
      is_active?: boolean | null;
    }) => {
      const { error } = await supabase.rpc("kc_admin_update_category", {
        _id: input.id,
        _name: input.name ?? null,
        _slug: input.slug ?? null,
        _description: input.description ?? null,
        _sort_order: input.sort_order ?? null,
        _is_active: input.is_active ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Category updated");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update category"),
  });
}

export interface ArticleCreateInput {
  category_id: string;
  title: string;
  slug: string;
  article_type: KnowledgeArticleType;
  summary?: string | null;
  body?: string | null;
  tooltip_excerpt?: string | null;
  visibility: KnowledgeArticleVisibility;
  related_route?: string | null;
  related_object_type?: string | null;
  related_object_id?: string | null;
  workspace_id?: string | null;
  owner_id?: string | null;
}

export function useCreateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ArticleCreateInput) => {
      const { data, error } = await supabase.rpc("kc_admin_create_article", {
        _category_id: input.category_id,
        _title: input.title,
        _slug: input.slug,
        _article_type: input.article_type,
        _summary: input.summary ?? null,
        _body: input.body ?? null,
        _tooltip_excerpt: input.tooltip_excerpt ?? null,
        _visibility: input.visibility,
        _related_route: input.related_route ?? null,
        _related_object_type: input.related_object_type ?? null,
        _related_object_id: input.related_object_id ?? null,
        _workspace_id: input.workspace_id ?? null,
        _owner_id: input.owner_id ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Article created (draft)");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create article"),
  });
}

export function useUpdateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string } & Partial<ArticleCreateInput>) => {
      const { error } = await supabase.rpc("kc_admin_update_article", {
        _id: input.id,
        _category_id: input.category_id ?? null,
        _title: input.title ?? null,
        _slug: input.slug ?? null,
        _article_type: input.article_type ?? null,
        _summary: input.summary ?? null,
        _body: input.body ?? null,
        _tooltip_excerpt: input.tooltip_excerpt ?? null,
        _visibility: input.visibility ?? null,
        _related_route: input.related_route ?? null,
        _related_object_type: input.related_object_type ?? null,
        _related_object_id: input.related_object_id ?? null,
        _workspace_id: input.workspace_id ?? null,
        _owner_id: input.owner_id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Article updated");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update article"),
  });
}

function articleLifecycleMutation(rpc: "kc_admin_publish_article" | "kc_admin_archive_article" | "kc_admin_unarchive_article", successMsg: string) {
  return function useLifecycle() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async (id: string) => {
        const { error } = await supabase.rpc(rpc, { _id: id });
        if (error) throw error;
      },
      onSuccess: () => {
        invalidateAll(qc);
        toast.success(successMsg);
      },
      onError: (e: any) => toast.error(e.message ?? "Action failed"),
    });
  };
}

export const usePublishArticle = articleLifecycleMutation("kc_admin_publish_article", "Article published");
export const useArchiveArticle = articleLifecycleMutation("kc_admin_archive_article", "Article archived");
export const useUnarchiveArticle = articleLifecycleMutation("kc_admin_unarchive_article", "Article moved to draft");

export const ARTICLE_TYPES: { value: KnowledgeArticleType; label: string }[] = [
  { value: "concept", label: "Concept" },
  { value: "how_to", label: "How-to" },
  { value: "rulebook", label: "Rulebook" },
  { value: "faq", label: "FAQ" },
  { value: "release_note", label: "Release note" },
  { value: "admin", label: "Admin" },
  { value: "integration_placeholder", label: "Integration placeholder" },
];

export const VISIBILITY_OPTIONS: { value: KnowledgeArticleVisibility; label: string }[] = [
  { value: "all_users", label: "All users" },
  { value: "admin_only", label: "Admin only" },
  { value: "workspace_scoped", label: "Workspace scoped" },
];

export function articleTypeLabel(t: KnowledgeArticleType) {
  return ARTICLE_TYPES.find((x) => x.value === t)?.label ?? t;
}

export function visibilityLabel(v: KnowledgeArticleVisibility) {
  return VISIBILITY_OPTIONS.find((x) => x.value === v)?.label ?? v;
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
