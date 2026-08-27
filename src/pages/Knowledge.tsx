import { useEffect, useMemo, useState } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, ExternalLink, Pencil, Plus, Search } from "lucide-react";
import { useIsOrgAdmin } from "@/hooks/useIsOrgAdmin";
import {
  ARTICLE_TYPES,
  useArchiveArticle,
  useKnowledgeArticle,
  useKnowledgeArticles,
  useKnowledgeCategories,
  usePublishArticle,
  useUnarchiveArticle,
  type KnowledgeArticleStatus,
  type KnowledgeArticleType,
  type KnowledgeCategory,
} from "@/hooks/useKnowledgeCenter";
import { CategoryFormDialog } from "@/components/knowledge/CategoryFormDialog";
import { ArticleFormDialog } from "@/components/knowledge/ArticleFormDialog";
import { StatusBadge, TypeBadge, VisibilityBadge } from "@/components/knowledge/KnowledgeBadges";
import { SafeArticleBody } from "@/components/knowledge/SafeArticleBody";
import { cn } from "@/lib/utils";
import { Link, useNavigate, useParams } from "react-router-dom";

export default function Knowledge() {
  const { data: adminInfo } = useIsOrgAdmin();
  const isAdmin = !!adminInfo?.isAdmin;
  const navigate = useNavigate();
  const { slug: routeSlug } = useParams<{ slug?: string }>();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<KnowledgeArticleType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<KnowledgeArticleStatus | "all">("all");
  const [includeUnpublished, setIncludeUnpublished] = useState(false);

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<KnowledgeCategory | null>(null);
  const [articleDialogOpen, setArticleDialogOpen] = useState(false);
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null);

  const categoriesQ = useKnowledgeCategories();
  const articlesQ = useKnowledgeArticles(selectedCategoryId, isAdmin && includeUnpublished);
  const articleQ = useKnowledgeArticle(selectedArticleId);
  const editingArticleQ = useKnowledgeArticle(editingArticleId);

  // Slug-based deep-link resolution.
  // We deliberately reuse the existing list_decrypted_knowledge_articles RPC
  // (passing categoryId=null and admin-gated _include_unpublished) so we never
  // touch knowledge_articles directly from the client. Once the article id is
  // known, get_decrypted_knowledge_article(id) loads the full body.
  // If a future get_decrypted_knowledge_article_by_slug RPC is added, this
  // can be swapped for a direct lookup. (Tracked as KC.4 follow-up.)
  const slugLookupQ = useKnowledgeArticles(null, isAdmin);
  const slugResolution = useMemo(() => {
    if (!routeSlug) return { state: "idle" as const };
    if (slugLookupQ.isLoading) return { state: "loading" as const };
    const match = (slugLookupQ.data ?? []).find((a) => a.slug === routeSlug);
    if (!match) return { state: "not_found" as const };
    return { state: "found" as const, id: match.id };
  }, [routeSlug, slugLookupQ.isLoading, slugLookupQ.data]);

  // When a slug resolves, drive the existing detail view.
  useEffect(() => {
    if (slugResolution.state === "found" && selectedArticleId !== slugResolution.id) {
      setSelectedArticleId(slugResolution.id);
    }
  }, [slugResolution, selectedArticleId]);

  // When the user manually leaves detail view, also clear the URL slug
  // so the back button and listing behave consistently.
  const exitDetail = () => {
    setSelectedArticleId(null);
    if (routeSlug) navigate("/knowledge", { replace: true });
  };

  const publish = usePublishArticle();
  const archive = useArchiveArticle();
  const unarchive = useUnarchiveArticle();

  const filteredArticles = useMemo(() => {
    const list = articlesQ.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((a) => {
      if (typeFilter !== "all" && a.article_type !== typeFilter) return false;
      if (isAdmin && statusFilter !== "all" && a.status !== statusFilter) return false;
      if (q) {
        const hay = `${a.title} ${a.summary ?? ""} ${a.tooltip_excerpt ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [articlesQ.data, search, typeFilter, statusFilter, isAdmin]);

  const categories = categoriesQ.data ?? [];
  const noCategories = !categoriesQ.isLoading && categories.length === 0;
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null;

  // Slug deep-link: still resolving the slug to an article id.
  if (routeSlug && slugResolution.state === "loading") {
    return (
      <PageContainer width="standard" className="py-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={exitDetail}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Knowledge
        </Button>
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  // Slug deep-link: slug not visible to this user (or does not exist).
  if (routeSlug && slugResolution.state === "not_found") {
    return (
      <PageContainer width="standard" className="py-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={exitDetail}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Knowledge
        </Button>
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-sm font-medium text-foreground">Article not found or not available</p>
            <p className="text-xs text-muted-foreground">
              No article with slug <code className="px-1 py-0.5 rounded bg-muted">{routeSlug}</code> is available to you.
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  // Article detail view
  if (selectedArticleId) {
    const a = articleQ.data;
    return (
      <PageContainer width="standard" className="py-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={exitDetail}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to articles
        </Button>
        {articleQ.isLoading && <Skeleton className="h-64 w-full" />}
        {!articleQ.isLoading && !a && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Article not found or not accessible.
            </CardContent>
          </Card>
        )}
        {a && (
          <Card>
            <CardContent className="py-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight">{a.title}</h1>
                  <div className="flex flex-wrap items-center gap-2">
                    <TypeBadge type={a.article_type} />
                    {isAdmin && <StatusBadge status={a.status} />}
                    {isAdmin && <VisibilityBadge visibility={a.visibility} />}
                    <span className="text-xs text-muted-foreground">
                      v{a.version} · updated {new Date(a.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingArticleId(a.id);
                        setArticleDialogOpen(true);
                      }}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </Button>
                    {a.status === "draft" && (
                      <Button size="sm" onClick={() => publish.mutate(a.id)} disabled={publish.isPending}>
                        Publish
                      </Button>
                    )}
                    {a.status === "published" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => archive.mutate(a.id)}
                        disabled={archive.isPending}
                      >
                        Archive
                      </Button>
                    )}
                    {a.status === "archived" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => unarchive.mutate(a.id)}
                        disabled={unarchive.isPending}
                      >
                        Unarchive
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {a.summary && (
                <p className="text-sm text-muted-foreground border-l-2 border-border pl-3">
                  {a.summary}
                </p>
              )}
              <Separator />
              <SafeArticleBody body={a.body} />
              {a.related_route && (
                <div className="pt-2">
                  <Link
                    to={a.related_route}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Open related page <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {isAdmin && (
          <ArticleFormDialog
            open={articleDialogOpen}
            onOpenChange={(v) => {
              setArticleDialogOpen(v);
              if (!v) setEditingArticleId(null);
            }}
            categories={categories}
            article={editingArticleQ.data ?? null}
          />
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide" className="py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
          <p className="text-sm text-muted-foreground">
            Guides, rulebook, and help articles for using BTPM.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingCategory(null);
                setCategoryDialogOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Category
            </Button>
            <Button
              size="sm"
              disabled={categories.length === 0}
              onClick={() => {
                setEditingArticleId(null);
                setArticleDialogOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Article
            </Button>
          </div>
        )}
      </div>

      {noCategories ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No Knowledge categories exist yet.</p>
            {isAdmin && (
              <Button
                onClick={() => {
                  setEditingCategory(null);
                  setCategoryDialogOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> Create first category
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
          {/* Sidebar */}
          <aside className="space-y-1">
            <CategoryButton
              active={selectedCategoryId === null}
              onClick={() => setSelectedCategoryId(null)}
              label="All categories"
            />
            <ScrollArea className="max-h-[60vh]">
              {categories.map((c) => (
                <div key={c.id} className="group flex items-center gap-1">
                  <CategoryButton
                    active={selectedCategoryId === c.id}
                    onClick={() => setSelectedCategoryId(c.id)}
                    label={c.name}
                    inactive={!c.is_active}
                  />
                  {isAdmin && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100"
                      onClick={() => {
                        setEditingCategory(c);
                        setCategoryDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </ScrollArea>
          </aside>

          {/* Article list */}
          <section className="space-y-3">
            {selectedCategory?.description && (
              <p className="text-sm text-muted-foreground">{selectedCategory.description}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search articles..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {ARTICLE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isAdmin && (
                <>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant={includeUnpublished ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIncludeUnpublished((v) => !v)}
                  >
                    {includeUnpublished ? "Showing all" : "Published only"}
                  </Button>
                </>
              )}
            </div>

            {articlesQ.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : articlesQ.error ? (
              <Card>
                <CardContent className="py-6 text-sm text-destructive">
                  Failed to load articles.
                </CardContent>
              </Card>
            ) : filteredArticles.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  {(articlesQ.data ?? []).length === 0
                    ? "No articles in this view yet."
                    : "No articles match your filters."}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {filteredArticles.map((a) => (
                  <Card
                    key={a.id}
                    className="cursor-pointer transition-colors hover:bg-accent/40"
                    onClick={() => setSelectedArticleId(a.id)}
                  >
                    <CardContent className="py-4 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="font-medium leading-tight">{a.title}</h3>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <TypeBadge type={a.article_type} />
                          {isAdmin && <StatusBadge status={a.status} />}
                          {isAdmin && <VisibilityBadge visibility={a.visibility} />}
                        </div>
                      </div>
                      {a.summary && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{a.summary}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {isAdmin && (
        <>
          <CategoryFormDialog
            open={categoryDialogOpen}
            onOpenChange={(v) => {
              setCategoryDialogOpen(v);
              if (!v) setEditingCategory(null);
            }}
            category={editingCategory}
          />
          <ArticleFormDialog
            open={articleDialogOpen}
            onOpenChange={(v) => {
              setArticleDialogOpen(v);
              if (!v) setEditingArticleId(null);
            }}
            categories={categories}
            defaultCategoryId={selectedCategoryId}
            article={editingArticleQ.data ?? null}
          />
        </>
      )}
    </PageContainer>
  );
}

function CategoryButton({
  active,
  onClick,
  label,
  inactive,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  inactive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
        inactive && "opacity-60 italic",
      )}
    >
      {label}
    </button>
  );
}
