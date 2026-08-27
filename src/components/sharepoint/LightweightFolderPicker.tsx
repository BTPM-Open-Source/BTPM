/**
 * SP UX reset — Lightweight in-app folder selector.
 *
 * Replaces the Microsoft native file picker for normal project folder
 * selection. Browses the validated workspace SharePoint library via the
 * existing server-side `sharepoint-files` edge function (no Graph in the
 * browser, no MSAL). Folders only, breadcrumb navigation, single-folder
 * selection. Saves the chosen folder as the project binding and lets the
 * caller trigger validation as usual.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ChevronRight,
  Folder as FolderIcon,
  Home,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  browseWorkspaceLibrary,
  linkProjectFolder,
  type PickerListing,
} from "@/lib/sharepointFolderPickerService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceBindingId: string;
}

export function LightweightFolderPicker({
  open,
  onOpenChange,
  projectId,
  workspaceBindingId,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Reset whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setCurrentItemId(null);
      setSelectedFolderId(null);
    }
  }, [open]);

  const listingQuery = useQuery<PickerListing>({
    queryKey: ["sp-folder-picker", workspaceBindingId, currentItemId ?? "root"],
    queryFn: () => browseWorkspaceLibrary(workspaceBindingId, currentItemId),
    enabled: open,
    retry: false,
    staleTime: 15_000,
  });

  const linkMut = useMutation({
    mutationFn: (selection: { itemId: string }) =>
      linkProjectFolder(workspaceBindingId, projectId, selection),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding", projectId] });
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding-effective", projectId] });
      toast({ title: "Folder connected", description: "Checking the connection…" });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast({
        title: "Could not connect folder",
        description: e?.note || e?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const data = listingQuery.data;
  const error = listingQuery.error as any;

  const breadcrumbs = useMemo(() => data?.breadcrumbs ?? [], [data]);

  const navigateToCrumb = (id: string | null, idx: number) => {
    setSelectedFolderId(null);
    if (idx === 0) {
      setCurrentItemId(null);
    } else {
      setCurrentItemId(id);
    }
  };

  const enterFolder = (id: string) => {
    setSelectedFolderId(null);
    setCurrentItemId(id);
  };

  const handleConfirm = () => {
    if (!selectedFolderId && !currentItemId) {
      toast({
        title: "Pick a folder",
        description: "Choose a folder from the list, or open one and use it.",
        variant: "destructive",
      });
      return;
    }
    const itemId = selectedFolderId ?? (currentItemId as string);
    linkMut.mutate({ itemId });
  };

  const handleUseCurrent = () => {
    if (!data) return;
    linkMut.mutate({ itemId: data.current.id });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose this project's folder</DialogTitle>
          <DialogDescription>
            Pick a folder inside your workspace's SharePoint library. Only
            folders are shown.
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumbs */}
        <div className="flex items-center flex-wrap gap-1 text-sm border-b pb-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => navigateToCrumb(null, 0)}
            disabled={!currentItemId}
          >
            <Home className="h-3.5 w-3.5 mr-1" />
            {data?.root.name ?? "Library"}
          </Button>
          {breadcrumbs.slice(1).map((b, i) => {
            const isLast = i === breadcrumbs.length - 2;
            return (
              <span key={b.id} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 truncate max-w-[220px]"
                  onClick={() => navigateToCrumb(b.id, i + 1)}
                  disabled={isLast}
                  title={b.name}
                >
                  {b.name}
                </Button>
              </span>
            );
          })}
        </div>

        {/* Folder list */}
        <div className="min-h-[280px] max-h-[50vh] overflow-auto">
          {listingQuery.isLoading ? (
            <div className="space-y-2 p-1">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not load folders</AlertTitle>
              <AlertDescription className="text-xs">
                {error?.note || error?.message || "Unknown error"}
              </AlertDescription>
            </Alert>
          ) : !data || data.folders.length === 0 ? (
            <div className="border rounded-md py-10 text-center text-sm text-muted-foreground">
              This folder has no subfolders. You can use it as the project
              folder, or go back and choose another.
            </div>
          ) : (
            <div className="border rounded-md divide-y">
              {data.folders
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((f) => {
                  const isSelected = selectedFolderId === f.id;
                  return (
                    <div
                      key={f.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                        isSelected ? "bg-primary/10" : "hover:bg-muted/40"
                      }`}
                      onClick={() => setSelectedFolderId(f.id)}
                      onDoubleClick={() => enterFolder(f.id)}
                    >
                      <FolderIcon className="h-4 w-4 text-amber-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {f.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {f.child_count != null
                            ? `${f.child_count} subfolder${f.child_count === 1 ? "" : "s"}`
                            : "Folder"}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          enterFolder(f.id);
                        }}
                      >
                        Open
                      </Button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Tip: click a folder to select it, or use <strong>Open</strong> to
          browse inside.
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {currentItemId && (
            <Button
              variant="secondary"
              onClick={handleUseCurrent}
              disabled={linkMut.isPending || !data}
            >
              Use current folder
            </Button>
          )}
          <Button
            onClick={handleConfirm}
            disabled={!selectedFolderId || linkMut.isPending}
          >
            {linkMut.isPending ? "Connecting…" : "Use selected folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
