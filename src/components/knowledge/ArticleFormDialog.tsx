import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ARTICLE_TYPES,
  VISIBILITY_OPTIONS,
  slugify,
  useCreateArticle,
  useUpdateArticle,
  type KnowledgeArticleDetail,
  type KnowledgeArticleType,
  type KnowledgeArticleVisibility,
  type KnowledgeCategory,
} from "@/hooks/useKnowledgeCenter";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: KnowledgeCategory[];
  defaultCategoryId?: string | null;
  article?: KnowledgeArticleDetail | null;
}

export function ArticleFormDialog({ open, onOpenChange, categories, defaultCategoryId, article }: Props) {
  const isEdit = !!article;
  const [categoryId, setCategoryId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [articleType, setArticleType] = useState<KnowledgeArticleType>("concept");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [tooltipExcerpt, setTooltipExcerpt] = useState("");
  const [visibility, setVisibility] = useState<KnowledgeArticleVisibility>("all_users");
  const [relatedRoute, setRelatedRoute] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");

  const create = useCreateArticle();
  const update = useUpdateArticle();

  useEffect(() => {
    if (!open) return;
    setCategoryId(article?.category_id ?? defaultCategoryId ?? categories[0]?.id ?? "");
    setTitle(article?.title ?? "");
    setSlug(article?.slug ?? "");
    setSlugTouched(!!article);
    setArticleType(article?.article_type ?? "concept");
    setSummary(article?.summary ?? "");
    setBody(article?.body ?? "");
    setTooltipExcerpt(article?.tooltip_excerpt ?? "");
    setVisibility(article?.visibility ?? "all_users");
    setRelatedRoute(article?.related_route ?? "");
    setWorkspaceId(article?.workspace_id ?? "");
  }, [open, article, defaultCategoryId, categories]);

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const needsWorkspace = visibility === "workspace_scoped";
  const canSubmit =
    !!categoryId &&
    title.trim().length > 0 &&
    slug.trim().length > 0 &&
    (!needsWorkspace || workspaceId.trim().length > 0);

  const onSubmit = async () => {
    if (!canSubmit) return;
    const payload = {
      category_id: categoryId,
      title,
      slug,
      article_type: articleType,
      summary: summary || null,
      body: body || null,
      tooltip_excerpt: tooltipExcerpt || null,
      visibility,
      related_route: relatedRoute || null,
      workspace_id: needsWorkspace ? workspaceId : null,
    };
    try {
      if (isEdit && article) {
        await update.mutateAsync({ id: article.id, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      /* toast */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit article" : "New article"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={articleType} onValueChange={(v) => setArticleType(v as KnowledgeArticleType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARTICLE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="kc-art-title">Title</Label>
            <Input id="kc-art-title" value={title} onChange={(e) => handleTitleChange(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="kc-art-slug">Slug</Label>
            <Input
              id="kc-art-slug"
              value={slug}
              onChange={(e) => {
                setSlug(slugify(e.target.value));
                setSlugTouched(true);
              }}
            />
          </div>
          <div>
            <Label htmlFor="kc-art-summary">Summary</Label>
            <Textarea
              id="kc-art-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
            />
          </div>
          <div>
            <Label htmlFor="kc-art-body">Body</Label>
            <Textarea
              id="kc-art-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Plain text. URLs are auto-linked. Required before publishing."
            />
          </div>
          <div>
            <Label htmlFor="kc-art-tooltip">Tooltip excerpt</Label>
            <Textarea
              id="kc-art-tooltip"
              value={tooltipExcerpt}
              onChange={(e) => setTooltipExcerpt(e.target.value)}
              rows={2}
              placeholder="Short blurb reused as concept tooltip (KC.4)."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Visibility</Label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as KnowledgeArticleVisibility)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="kc-art-route">Related route (optional)</Label>
              <Input
                id="kc-art-route"
                value={relatedRoute}
                onChange={(e) => setRelatedRoute(e.target.value)}
                placeholder="/workspace/.../project/..."
              />
            </div>
          </div>
          {needsWorkspace && (
            <div>
              <Label htmlFor="kc-art-ws">Workspace ID</Label>
              <Input
                id="kc-art-ws"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                placeholder="uuid"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Required when visibility is Workspace scoped.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit || create.isPending || update.isPending}>
            {isEdit ? "Save" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
