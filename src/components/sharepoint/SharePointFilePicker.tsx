/**
 * Phase 6B.4b — Canonical, domain-neutral SharePoint file picker.
 *
 * Extracted from the Decision Case evidence picker so that any caller
 * (Decision Case evidence, Roadmap Story Pack linked files, …) can reuse
 * the same browse/select UI shell.
 *
 * The component is presentation only:
 *   - It does NOT know about Story Pack, Decision Case, or governance.
 *   - It does NOT call Microsoft Graph or download file content.
 *   - It does NOT persist anything.
 *   - The caller injects:
 *       * `loadFolder` — returns a normalized listing or an error envelope.
 *       * `onConfirm` — receives the user's picked file references.
 *   - The caller may render a `headerSlot` above the browser (e.g. project
 *     selector for Story Pack) and `extraControls` below the file list
 *     (e.g. relevance/include controls for Decision Case).
 *
 * No file bytes / base64 are ever handled here.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, FileText, Folder, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Normalized contract — what callers must return from `loadFolder` and what
// they receive from `onConfirm`.
// ---------------------------------------------------------------------------

export interface SharePointFilePickerItem {
  id: string;
  driveId: string;
  siteId?: string | null;
  name: string;
  isFolder: boolean;
  size: number | null;
  mimeType?: string | null;
  webUrl?: string | null;
  childCount?: number | null;
}

export interface SharePointFilePickerListing {
  ok: true;
  driveId: string;
  siteId?: string | null;
  root: { id: string; name: string; webUrl: string | null };
  current: { id: string; name: string; webUrl: string | null };
  breadcrumbs: Array<{ id: string; name: string }>;
  items: SharePointFilePickerItem[];
}

export interface SharePointFilePickerErrorResult {
  ok: false;
  error: string;
  note?: string;
  /** When true, the browser body is replaced by the note instead of an error banner. */
  unavailable?: boolean;
}

export type SharePointFilePickerLoadResult =
  | SharePointFilePickerListing
  | SharePointFilePickerErrorResult;

export interface SharePointFilePickerPick {
  driveId: string;
  itemId: string;
  siteId?: string | null;
  name: string;
  size: number | null;
  mimeType?: string | null;
  webUrl?: string | null;
}

export interface SharePointFilePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  multiSelect?: boolean;
  loadFolder: (args: {
    folderDriveId?: string;
    folderItemId?: string;
  }) => Promise<SharePointFilePickerLoadResult>;
  onConfirm: (picks: SharePointFilePickerPick[]) => Promise<void> | void;
  /** Re-mount + reset internal state when this changes. */
  resetKey?: string;
  /** Rendered above the breadcrumb (e.g. a project/workspace selector). */
  headerSlot?: ReactNode;
  /** Rendered under the file list (e.g. Decision Case relevance/include). */
  extraControls?: ReactNode;
  confirmLabel?: (count: number) => string;
  isConfirming?: boolean;
  /** Disable the confirm button with a tooltip-less explanation message. */
  confirmDisabled?: boolean;
  /** Hide the browser entirely and show this message instead. */
  emptyState?: ReactNode;
}

function formatSize(b: number | null): string {
  if (b === null || b === undefined) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function SharePointFilePicker({
  open,
  onOpenChange,
  title = "Select SharePoint files",
  description = "Browse a connected SharePoint folder and pick files. BTPM stores secure references only — file contents stay in SharePoint and follow SharePoint permissions.",
  multiSelect = true,
  loadFolder,
  onConfirm,
  resetKey,
  headerSlot,
  extraControls,
  confirmLabel,
  isConfirming = false,
  confirmDisabled = false,
  emptyState,
}: SharePointFilePickerProps) {
  const [listing, setListing] = useState<SharePointFilePickerListing | null>(null);
  const [error, setError] = useState<SharePointFilePickerErrorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Record<string, SharePointFilePickerPick>>({});

  const reset = () => {
    setListing(null);
    setError(null);
    setLoading(false);
    setPicked({});
  };

  const load = async (folderItemId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res: SharePointFilePickerLoadResult = await loadFolder({
        folderItemId,
        folderDriveId: listing?.driveId,
      });
      if (res.ok === true) {
        setListing(res);
      } else {
        setListing(null);
        setError(res);
      }
    } catch (e) {
      setError({
        ok: false,
        error: "load_failed",
        note: (e as Error)?.message ?? "Could not load SharePoint folder.",
      });
    } finally {
      setLoading(false);
    }
  };

  // Open / reset
  useEffect(() => {
    if (!open) return;
    reset();
    void load(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetKey]);

  const togglePick = (it: SharePointFilePickerItem) => {
    if (it.isFolder) return;
    setPicked((cur) => {
      const next = { ...cur };
      if (next[it.id]) {
        delete next[it.id];
      } else {
        if (!multiSelect) {
          for (const k of Object.keys(next)) delete next[k];
        }
        next[it.id] = {
          driveId: it.driveId,
          itemId: it.id,
          siteId: it.siteId ?? null,
          name: it.name,
          size: it.size,
          mimeType: it.mimeType ?? null,
          webUrl: it.webUrl ?? null,
        };
      }
      return next;
    });
  };

  const pickedList = useMemo(() => Object.values(picked), [picked]);

  const handleConfirm = async () => {
    if (pickedList.length === 0) return;
    await onConfirm(pickedList);
  };

  const showBody = !emptyState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-3 shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-3">


        {headerSlot ? <div className="space-y-2">{headerSlot}</div> : null}

        {!showBody ? (
          <div className="rounded-md border p-4 text-sm">{emptyState}</div>
        ) : (
          <div className="space-y-3">
            {/* Breadcrumbs */}
            <div className="flex items-center gap-1 text-sm flex-wrap min-h-[28px]">
              {listing?.breadcrumbs.map((b, i) => (
                <span key={b.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <button
                    className="text-primary hover:underline disabled:opacity-50"
                    onClick={() => load(b.id)}
                    disabled={loading}
                  >
                    {b.name}
                  </button>
                </span>
              ))}
              {!listing && loading && (
                <span className="flex items-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Loading…
                </span>
              )}
            </div>

            {error && !error.unavailable && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error.note ?? error.error}
              </div>
            )}
            {error?.unavailable && (
              <div className="rounded-md border p-4 text-sm text-muted-foreground">
                {error.note ?? error.error}
              </div>
            )}

            {/* File list */}
            {!error?.unavailable && (
              <div className="border rounded-md max-h-[340px] overflow-y-auto divide-y">
                {listing?.items.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">This folder is empty.</p>
                )}
                {listing?.items.map((it) => {
                  const isPicked = !!picked[it.id];
                  return (
                    <div key={it.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 min-w-0">
                      {it.isFolder ? (
                        <button
                          className="flex items-center gap-2 text-left flex-1 min-w-0"
                          onClick={() => load(it.id)}
                          disabled={loading}
                        >
                          <Folder className="h-4 w-4 text-primary shrink-0" />
                          <span className="truncate flex-1 min-w-0">{it.name}</span>
                          {typeof it.childCount === "number" && (
                            <span className="text-xs text-muted-foreground shrink-0">({it.childCount})</span>
                          )}
                        </button>
                      ) : (
                        <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                          <Checkbox
                            checked={isPicked}
                            onCheckedChange={() => togglePick(it)}
                          />
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1 min-w-0">{it.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0 pl-2">
                            {formatSize(it.size)}
                          </span>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {extraControls ? (
              <div className="border rounded-md p-3 space-y-3">
                <div className="text-sm">
                  <strong>{pickedList.length}</strong> file
                  {pickedList.length === 1 ? "" : "s"} selected
                </div>
                {extraControls}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {pickedList.length > 0
                  ? `${pickedList.length} file${pickedList.length === 1 ? "" : "s"} selected`
                  : "Pick one or more files to continue."}
              </div>
            )}
          </div>
        )}
        </div>

        <DialogFooter className="p-6 pt-3 shrink-0 border-t">

          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isConfirming}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              confirmDisabled ||
              pickedList.length === 0 ||
              isConfirming ||
              !!error?.unavailable ||
              !!emptyState
            }
          >
            {isConfirming
              ? "Working…"
              : confirmLabel
              ? confirmLabel(pickedList.length)
              : `Add ${pickedList.length} file${pickedList.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
