import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Loader2, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsOrgAdmin } from "@/hooks/useIsOrgAdmin";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import seedPack from "@/data/kc3a_knowledge_seed_pack.json";
import type {
  KnowledgeArticleType,
  KnowledgeArticleVisibility,
} from "@/hooks/useKnowledgeCenter";

interface SeedCategory {
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  is_active: boolean;
}
interface SeedArticle {
  category_slug: string;
  title: string;
  slug: string;
  article_type: KnowledgeArticleType;
  visibility: KnowledgeArticleVisibility;
  status: "draft" | "published" | "archived";
  tooltip_excerpt: string;
  summary: string;
  body: string;
  related_route: string;
  ai_metadata?: {
    ai_flow?: string;
    feature_area?: string[];
    route_patterns?: string[];
    user_intents?: string[];
    audience?: string[];
    synonyms?: string[];
    freshness_label?: string;
    related_feature_flags?: string[];
    question_examples?: string[];
    answer_rules?: string[];
    forbidden_claims?: string[];
    workflow_metadata?: unknown;
  };
}
interface SeedPack {
  phase: string;
  name: string;
  version: number | string;
  categories: SeedCategory[];
  articles: SeedArticle[];
}

type LogLine = { kind: "info" | "ok" | "warn" | "err"; msg: string };

const pack = seedPack as SeedPack;

export default function KnowledgeSeed() {
  const { data: adminInfo, isLoading: adminLoading } = useIsOrgAdmin();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [summary, setSummary] = useState<{
    categoriesCreated: number;
    categoriesUpdated: number;
    articlesCreated: number;
    articlesUpdated: number;
    articlesPublished: number;
    articlesArchived: number;
    metadataWritten: number;
    errors: number;
  } | null>(null);

  const counts = useMemo(
    () => ({ categories: pack.categories.length, articles: pack.articles.length }),
    [],
  );

  if (adminLoading) return null;
  if (!adminInfo?.isAdmin) return <Navigate to="/knowledge" replace />;

  const append = (line: LogLine) => setLog((prev) => [...prev, line]);

  async function run() {
    setRunning(true);
    setLog([]);
    setSummary(null);
    let categoriesCreated = 0;
    let categoriesUpdated = 0;
    let articlesCreated = 0;
    let articlesUpdated = 0;
    let articlesPublished = 0;
    let articlesArchived = 0;
    let metadataWritten = 0;
    let errors = 0;

    try {
      append({ kind: "info", msg: `Loading existing categories & articles…` });

      const { data: existingCats, error: catErr } = await supabase.rpc(
        "list_decrypted_knowledge_categories",
      );
      if (catErr) throw catErr;
      const catBySlug = new Map<string, { id: string; slug: string }>();
      (existingCats ?? []).forEach((c: any) => catBySlug.set(c.slug, { id: c.id, slug: c.slug }));

      const { data: existingArts, error: artErr } = await supabase.rpc(
        "list_decrypted_knowledge_articles",
        { _category_id: null, _include_unpublished: true },
      );
      if (artErr) throw artErr;
      const artBySlug = new Map<string, { id: string; slug: string; status: string }>();
      (existingArts ?? []).forEach((a: any) =>
        artBySlug.set(a.slug, { id: a.id, slug: a.slug, status: a.status }),
      );

      append({
        kind: "info",
        msg: `Found ${catBySlug.size} existing categories, ${artBySlug.size} existing articles.`,
      });

      // ---- Categories ----
      append({ kind: "info", msg: `Seeding ${pack.categories.length} categories…` });
      const slugToCatId = new Map<string, string>();
      for (const c of pack.categories) {
        try {
          const existing = catBySlug.get(c.slug);
          if (existing) {
            const { error } = await supabase.rpc("kc_admin_update_category", {
              _id: existing.id,
              _name: c.name,
              _slug: c.slug,
              _description: c.description,
              _sort_order: c.sort_order,
              _is_active: c.is_active,
            });
            if (error) throw error;
            slugToCatId.set(c.slug, existing.id);
            categoriesUpdated++;
            append({ kind: "ok", msg: `↺ Category updated: ${c.slug}` });
          } else {
            const { data, error } = await supabase.rpc("kc_admin_create_category", {
              _name: c.name,
              _slug: c.slug,
              _description: c.description,
              _sort_order: c.sort_order,
            });
            if (error) throw error;
            slugToCatId.set(c.slug, data as string);
            categoriesCreated++;
            append({ kind: "ok", msg: `＋ Category created: ${c.slug}` });
          }
        } catch (e: any) {
          errors++;
          append({ kind: "err", msg: `Category ${c.slug}: ${e.message ?? String(e)}` });
        }
      }

      // ---- Articles ----
      append({ kind: "info", msg: `Seeding ${pack.articles.length} articles…` });
      for (const a of pack.articles) {
        try {
          const categoryId = slugToCatId.get(a.category_slug);
          if (!categoryId) {
            errors++;
            append({
              kind: "err",
              msg: `Article ${a.slug}: missing category ${a.category_slug}`,
            });
            continue;
          }

          const existing = artBySlug.get(a.slug);
          let articleId: string;
          if (existing) {
            const { error } = await supabase.rpc("kc_admin_update_article", {
              _id: existing.id,
              _category_id: categoryId,
              _title: a.title,
              _slug: a.slug,
              _article_type: a.article_type,
              _summary: a.summary,
              _body: a.body,
              _tooltip_excerpt: a.tooltip_excerpt,
              _visibility: a.visibility,
              _related_route: a.related_route,
              _related_object_type: null,
              _related_object_id: null,
              _workspace_id: null,
              _owner_id: null,
            });
            if (error) throw error;
            articleId = existing.id;
            articlesUpdated++;
            append({ kind: "ok", msg: `↺ Article updated: ${a.slug}` });
          } else {
            const { data, error } = await supabase.rpc("kc_admin_create_article", {
              _category_id: categoryId,
              _title: a.title,
              _slug: a.slug,
              _article_type: a.article_type,
              _summary: a.summary,
              _body: a.body,
              _tooltip_excerpt: a.tooltip_excerpt,
              _visibility: a.visibility,
              _related_route: a.related_route,
              _related_object_type: null,
              _related_object_id: null,
              _workspace_id: null,
              _owner_id: null,
            });
            if (error) throw error;
            articleId = data as string;
            articlesCreated++;
            append({ kind: "ok", msg: `＋ Article created: ${a.slug}` });
          }

          if (a.status === "published" && existing?.status !== "published") {
            const { error } = await supabase.rpc("kc_admin_publish_article", { _id: articleId });
            if (error) throw error;
            articlesPublished++;
            append({ kind: "ok", msg: `▲ Article published: ${a.slug}` });
          } else if (a.status === "archived" && existing?.status !== "archived") {
            const { error } = await supabase.rpc("kc_admin_archive_article", { _id: articleId });
            if (error) throw error;
            articlesArchived++;
            append({ kind: "warn", msg: `▽ Article archived: ${a.slug}` });
          }

          if (a.ai_metadata) {
            const m = a.ai_metadata;
            const { error: metaErr } = await supabase.rpc(
              "admin_upsert_knowledge_article_ai_metadata",
              {
                _article_id: articleId,
                _ai_flow: m.ai_flow,
                _feature_area: m.feature_area,
                _route_patterns: m.route_patterns,
                _user_intents: m.user_intents,
                _audience: m.audience,
                _synonyms: m.synonyms,
                _freshness_label: m.freshness_label,
                _related_feature_flags: m.related_feature_flags,
                _question_examples: m.question_examples,
                _answer_rules: m.answer_rules,
                _forbidden_claims: m.forbidden_claims,
                _workflow_metadata: m.workflow_metadata ?? null,
              },
            );
            if (metaErr) throw metaErr;
            metadataWritten++;
            append({ kind: "ok", msg: `✦ AI metadata written: ${a.slug}` });
          }
        } catch (e: any) {
          errors++;
          append({ kind: "err", msg: `Article ${a.slug}: ${e.message ?? String(e)}` });
        }
      }

      setSummary({
        categoriesCreated,
        categoriesUpdated,
        articlesCreated,
        articlesUpdated,
        articlesPublished,
        articlesArchived,
        metadataWritten,
        errors,
      });
      qc.invalidateQueries({ queryKey: ["kc"] });
      if (errors === 0) {
        toast.success("Knowledge seed completed");
        append({ kind: "ok", msg: "Done." });
      } else {
        toast.error(`Knowledge seed finished with ${errors} error(s)`);
        append({ kind: "warn", msg: `Done with ${errors} error(s).` });
      }
    } catch (e: any) {
      errors++;
      append({ kind: "err", msg: `Fatal: ${e.message ?? String(e)}` });
      toast.error(e.message ?? "Seed failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/knowledge">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Knowledge
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight">
              Knowledge Center — Bootstrap Seed
            </h1>
            <p className="text-sm text-muted-foreground">
              Phase {pack.phase} · {pack.name} · v{pack.version} —{" "}
              {counts.categories} categories, {counts.articles} articles. Idempotent by slug:
              existing entries are updated, missing entries created, then published when applicable.
              All writes go through the KC.2 admin RPCs.
            </p>
          </div>
          <Button onClick={run} disabled={running} size="lg">
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Seeding…
              </>
            ) : (
              <>
                <PlayCircle className="mr-2 h-4 w-4" />
                Run seed
              </>
            )}
          </Button>
        </div>

        {summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Result</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="Categories created" value={summary.categoriesCreated} />
                <Metric label="Categories updated" value={summary.categoriesUpdated} />
                <Metric label="Articles created" value={summary.articlesCreated} />
                <Metric label="Articles updated" value={summary.articlesUpdated} />
                <Metric label="Articles published" value={summary.articlesPublished} />
                <Metric label="Articles archived" value={summary.articlesArchived} />
                <Metric label="AI metadata rows" value={summary.metadataWritten} />
                <Metric label="Errors" value={summary.errors} tone={summary.errors ? "err" : "ok"} />

              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run log</CardTitle>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No run yet. Click <span className="font-medium">Run seed</span> to start.
              </p>
            ) : (
              <ScrollArea className="h-96 rounded-md border bg-muted/30 p-3 font-mono text-xs">
                <div className="space-y-1">
                  {log.map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.kind === "err"
                          ? "text-destructive"
                          : l.kind === "warn"
                            ? "text-amber-600 dark:text-amber-400"
                            : l.kind === "ok"
                              ? "text-foreground"
                              : "text-muted-foreground"
                      }
                    >
                      {l.msg}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Separator />
        <p className="text-xs text-muted-foreground">
          Admin-only utility. Safe to re-run: matches existing categories and articles by slug and
          updates them in place via <code>kc_admin_update_category</code> /{" "}
          <code>kc_admin_update_article</code>. No direct table writes.
        </p>
      </div>
    </PageContainer>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "err";
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 text-2xl font-semibold " +
          (tone === "err" && value > 0 ? "text-destructive" : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}
