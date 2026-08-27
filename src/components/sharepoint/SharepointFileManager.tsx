/**
 * SP.4 — In-app SharePoint file manager.
 *
 * Renders the linked project folder tree (browse, open, upload, create
 * subfolder) backed by the `sharepoint-files` edge function. All Graph
 * calls happen server-side. Stays scoped under the linked project root.
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  Folder as FolderIcon,
  FolderPlus,
  Home,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  useCreateSubfolder,
  useSharepointListing,
  useUploadFile,
} from "@/hooks/useSharepointFiles";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Props {
  bindingId: string;
  canMutate: boolean;
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function SharepointFileManager({ bindingId, canMutate }: Props) {
  const { toast } = useToast();
  // Stack of folder ids the user has navigated into. null = root.
  const [stack, setStack] = useState<Array<string | null>>([null]);
  const currentItemId = stack[stack.length - 1];
  const { data, isLoading, isFetching, error, refetch } = useSharepointListing(
    bindingId,
    currentItemId,
    true,
  );
  const createMut = useCreateSubfolder(bindingId);
  const uploadMut = useUploadFile(bindingId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const navigateTo = (id: string | null, depthFromRoot?: number) => {
    if (depthFromRoot !== undefined) {
      // breadcrumb click: truncate stack to that depth
      setStack((prev) => prev.slice(0, depthFromRoot + 1));
      return;
    }
    setStack((prev) => [...prev, id]);
  };

  const handleUpload = async (file: File) => {
    if (!data) return;
    try {
      await uploadMut.mutateAsync({ parentItemId: data.current.id, file });
      toast({ title: "Uploaded", description: file.name });
    } catch (e: any) {
      toast({
        title: "Upload failed",
        description: e?.note || e?.message || "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleCreateFolder = async () => {
    if (!data) return;
    try {
      await createMut.mutateAsync({
        parentItemId: data.current.id,
        name: newFolderName,
      });
      toast({ title: "Folder created", description: newFolderName });
      setNewFolderName("");
      setFolderDialogOpen(false);
    } catch (e: any) {
      toast({
        title: "Create folder failed",
        description: e?.note || e?.message || "Unknown error",
        variant: "destructive",
      });
    }
  };

  // Error UI ------------------------------------------------------------
  if (error) {
    const code = (error as any)?.code as string | undefined;
    const note = (error as any)?.note as string | undefined;
    const titleMap: Record<string, string> = {
      binding_not_validated: "Binding not validated",
      binding_disabled: "Binding disabled",
      site_unreachable: "SharePoint site unreachable",
      drives_access_denied: "Access denied to library",
      library_not_found: "Library not found",
      folder_outside_library: "Folder outside library",
      folder_url_missing: "Folder URL missing",
      folder_access_denied: "Access denied to folder",
      folder_not_found: "Project folder not found",
      list_access_denied: "Access denied",
      list_failed: "Could not list folder contents",
      outside_project_scope: "Outside project scope",
    };
    return (
      <Card>
        <CardContent className="py-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{titleMap[code ?? ""] ?? "Could not load files"}</AlertTitle>
            <AlertDescription className="text-xs">
              {note || (error as Error).message}
            </AlertDescription>
          </Alert>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-sm flex-wrap min-w-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => navigateTo(null, 0)}
              disabled={stack.length === 1}
            >
              <Home className="h-3.5 w-3.5 mr-1" />
              {data?.root.name ?? "Root"}
            </Button>
            {data?.breadcrumbs.slice(1).map((b, i) => (
              <span key={b.id} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 truncate max-w-[200px]"
                  onClick={() => navigateTo(b.id, i + 1)}
                  disabled={i + 1 === data.breadcrumbs.length - 1}
                  title={b.name}
                >
                  {b.name}
                </Button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {data?.current.web_url && (
              <Button asChild size="sm" variant="outline">
                <a href={data.current.web_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" /> Open in SharePoint
                </a>
              </Button>
            )}
            {canMutate && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFolderDialogOpen(true)}
                  disabled={!data}
                >
                  <FolderPlus className="h-4 w-4 mr-1" /> New folder
                </Button>
                <Button
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!data || uploadMut.isPending}
                >
                  <Upload className="h-4 w-4 mr-1" />
                  {uploadMut.isPending ? "Uploading…" : "Upload file"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    if (e.target) e.target.value = "";
                  }}
                />
              </>
            )}
          </div>
        </div>

        {/* Listing */}
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="border rounded-md py-10 text-center text-sm text-muted-foreground">
            This folder is empty.
          </div>
        ) : (
          <div className="border rounded-md divide-y">
            {data.items
              .slice()
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
                return a.name.localeCompare(b.name);
              })
              .map((it) => (
                <div
                  key={it.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40"
                >
                  {it.type === "folder" ? (
                    <FolderIcon className="h-4 w-4 text-amber-600 shrink-0" />
                  ) : (
                    <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    {it.type === "folder" ? (
                      <button
                        type="button"
                        onClick={() => navigateTo(it.id)}
                        className="text-sm font-medium text-foreground hover:underline truncate text-left"
                      >
                        {it.name}
                      </button>
                    ) : (
                      <a
                        href={it.web_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-foreground hover:underline truncate block"
                      >
                        {it.name}
                      </a>
                    )}
                    <div className="text-[11px] text-muted-foreground truncate">
                      {it.type === "folder"
                        ? it.child_count != null
                          ? `${it.child_count} item${it.child_count === 1 ? "" : "s"}`
                          : "Folder"
                        : `${formatBytes(it.size)} · ${
                            it.last_modified_at
                              ? new Date(it.last_modified_at).toLocaleString()
                              : "—"
                          }${it.last_modified_by ? ` · ${it.last_modified_by}` : ""}`}
                    </div>
                  </div>
                  <a
                    href={it.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                    title="Open in SharePoint"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              ))}
          </div>
        )}
      </CardContent>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Create a subfolder in <strong>{data?.current.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sp-new-folder">Folder name</Label>
            <Input
              id="sp-new-folder"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Specifications"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              Cannot contain: \ / : * ? " &lt; &gt; | # %
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || createMut.isPending}
            >
              {createMut.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
