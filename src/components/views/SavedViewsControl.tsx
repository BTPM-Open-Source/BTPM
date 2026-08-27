/**
 * SavedViewsControl — Phase 4E.6 reusable saved-view UI.
 *
 * Compact popover that lets the user save, apply, rename, and delete private
 * local saved views for a surface. Strictly UI: state mutation is delegated to
 * `useSavedViews` (storage) and the parent's `onApply` (which writes the
 * snapshot back through the existing 4E persistence system).
 */
import { useState } from "react";
import { Bookmark, Plus, Check, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { SavedView } from "@/hooks/useSavedViews";

interface Props<T> {
  views: SavedView<T>[];
  /** Snapshot of the current durable view state (already filtered to capturable fields). */
  currentState: T;
  onSave: (name: string, state: T) => void;
  onApply: (state: T) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Optional label override for the trigger; defaults to "Views". */
  label?: string;
  /** Optional helper text under the save input. Defaults to local-storage wording. */
  description?: string;
  /** Optional flag to disable the save/list controls (e.g. while loading). */
  disabled?: boolean;
  /** Optional empty-state message override. */
  emptyText?: string;
  className?: string;
}

export function SavedViewsControl<T>({
  views,
  currentState,
  onSave,
  onApply,
  onRename,
  onDelete,
  label = "Views",
  description = "Private to you, stored on this device.",
  disabled = false,
  emptyText = "No saved views yet.",
  className,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [savingName, setSavingName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");

  const handleSave = () => {
    const name = savingName.trim();
    if (!name) return;
    onSave(name, currentState);
    setSavingName("");
  };

  const handleRenameStart = (v: SavedView<T>) => {
    setRenamingId(v.id);
    setRenamingName(v.name);
  };

  const handleRenameCommit = () => {
    if (renamingId) {
      const name = renamingName.trim();
      if (name) onRename(renamingId, name);
    }
    setRenamingId(null);
    setRenamingName("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 gap-1.5 text-xs", className)}
          aria-label="Saved views"
        >
          <Bookmark className="h-3.5 w-3.5" />
          {label}
          {views.length > 0 && (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground">
              {views.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground">Save current view</div>
          <div className="flex items-center gap-1.5">
            <Input
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              placeholder="View name…"
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
            <Button
              size="sm"
              variant="default"
              className="h-8 px-2"
              onClick={handleSave}
              disabled={disabled || !savingName.trim()}
              aria-label="Save view"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {description}
          </p>
        </div>

        <Separator className="my-3" />

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-foreground">Saved views</div>
          {views.length === 0 ? (
            <p className="py-2 text-[11px] text-muted-foreground">{emptyText}</p>
          ) : (
            <ScrollArea className="max-h-64">
              <ul className="space-y-1 pr-2">
                {views.map((v) => {
                  const isRenaming = renamingId === v.id;
                  return (
                    <li
                      key={v.id}
                      className="group flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1.5"
                    >
                      {isRenaming ? (
                        <>
                          <Input
                            value={renamingName}
                            onChange={(e) => setRenamingName(e.target.value)}
                            className="h-6 flex-1 text-xs"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleRenameCommit();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setRenamingId(null);
                              }
                            }}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={handleRenameCommit}
                            aria-label="Confirm rename"
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => setRenamingId(null)}
                            aria-label="Cancel rename"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="flex-1 truncate text-left text-xs text-foreground hover:text-primary"
                            title={`Apply "${v.name}"`}
                            onClick={() => {
                              onApply(v.state);
                              setOpen(false);
                            }}
                          >
                            {v.name}
                          </button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 opacity-60 group-hover:opacity-100"
                            onClick={() => handleRenameStart(v)}
                            aria-label={`Rename ${v.name}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 opacity-60 group-hover:opacity-100 hover:text-destructive"
                            onClick={() => onDelete(v.id)}
                            aria-label={`Delete ${v.name}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
