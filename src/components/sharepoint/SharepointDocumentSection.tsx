/**
 * SharePoint-backed document section for project / phase / task surfaces.
 *
 * Replaces the legacy Supabase-storage AttachmentSection on PM surfaces.
 * Documents live in the linked project SharePoint folder. Phase/task
 * documents are placed in deterministic subfolders under that root:
 *
 *   project → <project root folder>
 *   phase   → <project root>/Phases/<phase-name>__<short-id>
 *   task    → <project root>/Tasks/<task-name>__<short-id>
 *
 * Subfolders are created lazily on first upload via the server-side
 * `ensure_subpath` action, which enforces scope and PM authority.
 *
 * UX rules:
 *  - If the project has no validated SharePoint folder, the section shows
 *    a clear blocking message and disables uploads (no Supabase fallback).
 *  - Open always launches SharePoint in a new tab.
 *  - Delete removes the file in SharePoint (PM authority required).
 */

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ExternalLink,
  File as FileIcon,
  FolderOpen,
  Info,
  Paperclip,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProjectBinding } from "@/hooks/useSharepointBindings";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import {
  deleteItem,
  ensureSubpath,
  listChildren,
  resolveSubpath,
  uploadFile,
  type SpItem,
} from "@/lib/sharepointFileService";

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB safety cap

export type DocTargetType = "project" | "phase" | "task";

interface Props {
  targetType: DocTargetType;
  targetId: string;
  targetName?: string | null;
  /** Project ID — used to resolve the SharePoint binding. */
  projectId: string;
  /** Workspace ID — kept for parity with old AttachmentSection callers. */
  workspaceId: string;
  canEdit: boolean;
}

function formatBytes(n: number | null) {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function safeSegment(name: string | null | undefined, fallback: string): string {
  const raw = (name ?? "").trim();
  // SharePoint forbids: \ / : * ? " < > | # %  and trailing dots/spaces
  const cleaned = raw
    .replace(/[\\/:*?"<>|#%]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  const base = cleaned || fallback;
  return base.slice(0, 80);
}

/**
 * Deterministic subfolder segments for a target. Always under the project root.
 * - project → []
 * - phase   → ["Phases", "<sanitized-name>__<id8>"]
 * - task    → ["Tasks",  "<sanitized-name>__<id8>"]
 */
function segmentsFor(
  targetType: DocTargetType,
  targetId: string,
  targetName?: string | null,
): string[] {
  if (targetType === "project") return [];
  const id8 = targetId.replace(/-/g, "").slice(0, 8);
  const folder = `${safeSegment(targetName, targetType === "phase" ? "Phase" : "Task")}__${id8}`;
  return [targetType === "phase" ? "Phases" : "Tasks", folder];
}

export function SharepointDocumentSection({
  targetType,
  targetId,
  targetName,
  projectId,
  canEdit,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<SpItem | null>(null);

  const { data: projectBinding, isLoading: pbLoading } = useProjectBinding(projectId);
  const bindingId = projectBinding?.id;
  const status = projectBinding?.binding_status;
  const validated = !!projectBinding && status === "validated";

  const segments = useMemo(
    () => segmentsFor(targetType, targetId, targetName),
    [targetType, targetId, targetName],
  );

  // Resolve the target folder lazily — only when binding is validated. PMs
  // get ensure_subpath (creates if missing); non-PMs get a read-only resolve
  // that returns missing=true rather than 403 when the folder doesn't exist.
  const folderQuery = useQuery({
    queryKey: ["sp-doc-folder", bindingId, targetType, targetId, canEdit ? "ensure" : "resolve"],
    queryFn: async () => {
      if (canEdit) {
        const r = await ensureSubpath(bindingId as string, segments);
        return { item: r.item as SpItem | null, missing: false };
      }
      return resolveSubpath(bindingId as string, segments);
    },
    enabled: !!bindingId && validated,
    retry: false,
    staleTime: 60_000,
  });
  const folder = folderQuery.data?.item ?? null;
  const folderMissing = folderQuery.data?.missing === true;

  const listQuery = useQuery({
    queryKey: ["sp-doc-listing", bindingId, folder?.id],
    queryFn: () => listChildren(bindingId as string, folder!.id),
    enabled: !!bindingId && !!folder?.id,
    retry: false,
    staleTime: 15_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!bindingId) throw new Error("No binding");
      if (file.size > MAX_BYTES) {
        throw new Error(`File exceeds ${MAX_BYTES / 1024 / 1024} MB limit.`);
      }
      // Upload requires a real folder id. If the deterministic subfolder
      // hasn't been created yet, create it now (PM authority enforced
      // server-side).
      let folderId = folder?.id;
      if (!folderId) {
        const ensured = await ensureSubpath(bindingId, segments);
        folderId = ensured.item?.id;
        if (!folderId) throw new Error("Could not prepare SharePoint folder");
        qc.invalidateQueries({ queryKey: ["sp-doc-folder", bindingId, targetType, targetId] });
      }
      await uploadFile(bindingId, folderId, file);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp-doc-listing", bindingId, folder?.id] });
      qc.invalidateQueries({ queryKey: ["sp-doc-folder", bindingId, targetType, targetId] });
      toast({ title: "File uploaded to SharePoint" });
    },
    onError: (e: any) => {
      toast({ title: "Upload failed", description: e?.message ?? String(e), variant: "destructive" });
    },
    onSettled: () => {
      if (fileRef.current) fileRef.current.value = "";
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: SpItem) => {
      if (!bindingId) throw new Error("No binding");
      await deleteItem(bindingId, item.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp-doc-listing", bindingId, folder?.id] });
      toast({ title: "File removed from SharePoint" });
      setPending(null);
    },
    onError: (e: any) => {
      toast({ title: "Delete failed", description: e?.message ?? String(e), variant: "destructive" });
      setPending(null);
    },
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadMutation.mutate(f);
  };

  const items = useMemo(() => {
    const list = (listQuery.data?.items ?? []).slice();
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [listQuery.data]);

  const headerCount = items.length;
  const headerLabel =
    targetType === "project" ? "Files (SharePoint)" :
    targetType === "phase"   ? "Phase files (SharePoint)" :
                               "Task files (SharePoint)";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 gap-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 min-w-0">
          <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="truncate">{headerLabel}</span>
          {headerCount > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({headerCount})</span>
          )}
          <KnowledgeLink slug="where-project-documents-are-stored" label="How documents are stored" variant="icon" />
        </CardTitle>
        <div className="flex items-center gap-1.5">
          {folder?.web_url && (
            <Button asChild size="sm" variant="outline">
              <a href={folder.web_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open in SharePoint
              </a>
            </Button>
          )}
          {validated && folder?.id && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => listQuery.refetch()}
              disabled={listQuery.isFetching}
              title="Refresh"
              className="h-8 w-8 p-0"
            >
              <RefreshCw className={`h-4 w-4 ${listQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          )}
          {canEdit && validated && folder?.id && (
            <>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={onPick}
                disabled={uploadMutation.isPending}
              />
              <Button
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                {uploadMutation.isPending ? "Uploading…" : "Upload"}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {pbLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : !projectBinding || status === "disabled" ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>No SharePoint folder linked</AlertTitle>
            <AlertDescription className="text-xs">
              This project doesn't have a SharePoint folder connected yet. Open
              <strong> Shared Files</strong> in this project to connect one.
              Files for projects, phases, and tasks live in SharePoint.
            </AlertDescription>
          </Alert>
        ) : status === "linked_unvalidated" ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Connecting to SharePoint…</AlertTitle>
            <AlertDescription className="text-xs">
              The link to SharePoint is being verified. Try again in a moment.
            </AlertDescription>
          </Alert>
        ) : status === "invalid" ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>SharePoint link needs attention</AlertTitle>
            <AlertDescription className="text-xs">
              The connection to this project's SharePoint folder isn't working
              right now. Open <strong>Shared Files</strong> to reconnect.
            </AlertDescription>
          </Alert>
        ) : folderQuery.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : folderQuery.error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Couldn't open the SharePoint subfolder</AlertTitle>
            <AlertDescription className="text-xs">
              {(folderQuery.error as Error).message}
            </AlertDescription>
          </Alert>
        ) : listQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : listQuery.error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Can't list files right now</AlertTitle>
            <AlertDescription className="text-xs">
              {(listQuery.error as Error).message}
            </AlertDescription>
          </Alert>
        ) : items.length === 0 ? (
          <div className="border rounded-md py-6 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
            <FolderOpen className="h-5 w-5 text-muted-foreground/70" />
            {canEdit
              ? "No files yet. Upload to attach a document — it will be saved in SharePoint."
              : "No files yet."}
          </div>
        ) : (
          <ul className="border rounded-md divide-y">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <a
                  href={it.web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 group"
                  title="Open in SharePoint"
                >
                  <div className="text-sm font-medium text-foreground truncate group-hover:underline">
                    {it.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {[
                      it.type === "folder" ? "Folder" : formatBytes(it.size),
                      it.last_modified_at ? new Date(it.last_modified_at).toLocaleString() : null,
                      it.last_modified_by,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </a>
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  title="Open in SharePoint"
                >
                  <a href={it.web_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
                {canEdit && it.type !== "folder" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => setPending(it)}
                    title="Remove from SharePoint"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from SharePoint?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{pending?.name}</strong> from
              the connected SharePoint folder. This cannot be undone from BTPM.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pending) deleteMutation.mutate(pending);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
