import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  slugify,
  useCreateCategory,
  useUpdateCategory,
  type KnowledgeCategory,
} from "@/hooks/useKnowledgeCenter";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  category?: KnowledgeCategory | null;
}

export function CategoryFormDialog({ open, onOpenChange, category }: Props) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [slugTouched, setSlugTouched] = useState(false);

  const create = useCreateCategory();
  const update = useUpdateCategory();
  const isEdit = !!category;

  useEffect(() => {
    if (open) {
      setName(category?.name ?? "");
      setSlug(category?.slug ?? "");
      setDescription(category?.description ?? "");
      setSortOrder(category?.sort_order ?? 0);
      setIsActive(category?.is_active ?? true);
      setSlugTouched(!!category);
    }
  }, [open, category]);

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const canSubmit = name.trim().length > 0 && slug.trim().length > 0;

  const onSubmit = async () => {
    if (!canSubmit) return;
    try {
      if (isEdit && category) {
        await update.mutateAsync({
          id: category.id,
          name,
          slug,
          description: description || null,
          sort_order: sortOrder,
          is_active: isActive,
        });
      } else {
        await create.mutateAsync({
          name,
          slug,
          description: description || null,
          sort_order: sortOrder,
        });
      }
      onOpenChange(false);
    } catch {
      /* toast already shown */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="kc-cat-name">Name</Label>
            <Input id="kc-cat-name" value={name} onChange={(e) => handleNameChange(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="kc-cat-slug">Slug</Label>
            <Input
              id="kc-cat-slug"
              value={slug}
              onChange={(e) => {
                setSlug(slugify(e.target.value));
                setSlugTouched(true);
              }}
            />
          </div>
          <div>
            <Label htmlFor="kc-cat-desc">Description</Label>
            <Textarea id="kc-cat-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="kc-cat-sort">Sort order</Label>
              <Input
                id="kc-cat-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              />
            </div>
            {isEdit && (
              <div className="flex items-end gap-2">
                <Switch id="kc-cat-active" checked={isActive} onCheckedChange={setIsActive} />
                <Label htmlFor="kc-cat-active">Active</Label>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit || create.isPending || update.isPending}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
