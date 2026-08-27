/**
 * Project-level read-only file list for the connected SharePoint folder.
 *
 * Lightweight by design: lists items in the selected folder, opens each via
 * its SharePoint web link. No upload, create, rename, delete, move, search,
 * or in-app browsing.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ExternalLink,
  File as FileIcon,
  Folder as FolderIcon,
  RefreshCw,
} from "lucide-react";
import { useSharepointListing } from "@/hooks/useSharepointFiles";

interface Props {
  bindingId: string;
}

function formatBytes(n: number | null): string {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function SharepointFolderContents({ bindingId }: Props) {
  const { data, isLoading, isFetching, error, refetch } = useSharepointListing(
    bindingId,
    null,
    true,
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4 space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 space-y-3">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Can't show files right now</AlertTitle>
            <AlertDescription className="text-xs">
              We couldn't read this folder from SharePoint. You can still open
              the folder in SharePoint to view its files.
            </AlertDescription>
          </Alert>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const items = data.items.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">Files in this folder</CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <div className="border rounded-md py-8 text-center text-sm text-muted-foreground">
            This folder is empty. Add files to it in SharePoint.
          </div>
        ) : (
          <div className="border rounded-md divide-y">
            {items.map((it) => (
              <a
                key={it.id}
                href={it.web_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 group"
                title="Open in SharePoint"
              >
                {it.type === "folder" ? (
                  <FolderIcon className="h-4 w-4 text-amber-600 shrink-0" />
                ) : (
                  <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate group-hover:underline">
                    {it.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {it.type === "folder"
                      ? it.child_count != null
                        ? `Folder · ${it.child_count} item${it.child_count === 1 ? "" : "s"}`
                        : "Folder"
                      : [
                          formatBytes(it.size),
                          it.last_modified_at
                            ? new Date(it.last_modified_at).toLocaleString()
                            : null,
                          it.last_modified_by,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </div>
                </div>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-foreground" />
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
