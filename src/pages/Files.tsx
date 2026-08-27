/**
 * UX-1.5 — Files Access Simplification
 *
 * Lightweight launcher for workspace/project-linked SharePoint locations.
 * Reuses existing canonical SharePoint binding data only — no new storage,
 * no new permissions, no document management surface.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FolderOpen, Info, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveWorkspace } from "@/context/ActiveWorkspaceContext";
import { useWorkspaceBinding } from "@/hooks/useSharepointBindings";
import { useWorkspaceProjects } from "@/hooks/useProjectOverview";
import { useProjectAccessMap } from "@/hooks/useProjectAccessMap";
import { supabase } from "@/integrations/supabase/client";
import type { SharepointProjectBinding } from "@/lib/sharepointBindingTypes";

function bindingTone(status: string | undefined | null) {
  if (!status || status === "disabled") return "secondary" as const;
  if (status === "validated") return "default" as const;
  if (status === "invalid") return "destructive" as const;
  return "outline" as const;
}

function bindingLabel(status: string | undefined | null) {
  if (!status) return "Not configured";
  return status.replace(/_/g, " ");
}

function useWorkspaceProjectBindings(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["sharepoint-workspace-project-bindings", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [] as SharepointProjectBinding[];
      const { data, error } = await (supabase.rpc as any)(
        "list_sharepoint_project_bindings_for_workspace",
        { _workspace_id: workspaceId },
      );
      if (error) {
        // RPC may not exist in all environments — fail soft to empty list.
        return [] as SharepointProjectBinding[];
      }
      return ((data as any[]) ?? []) as SharepointProjectBinding[];
    },
    enabled: !!workspaceId,
  });
}

export default function Files() {
  const { activeWorkspace, activeWorkspaceId, isAllWorkspaces, isLoading: scopeLoading } =
    useActiveWorkspace();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Files</h1>
        <p className="text-sm text-muted-foreground">
          Quick access to workspace and project file locations. Files live in SharePoint —
          this page is a launcher, not a document manager.
        </p>
      </header>

      {scopeLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isAllWorkspaces ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Layers className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Select a workspace to view files</p>
            <p className="text-xs text-muted-foreground">
              Files are scoped to a workspace. Switch from “All workspaces” using the
              workspace selector above.
            </p>
          </CardContent>
        </Card>
      ) : activeWorkspaceId && activeWorkspace ? (
        <WorkspaceFilesView
          workspaceId={activeWorkspaceId}
          workspaceName={activeWorkspace.name}
        />
      ) : null}
    </div>
  );
}

function WorkspaceFilesView({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const wsBindingQ = useWorkspaceBinding(workspaceId);
  const projectsQ = useWorkspaceProjects(workspaceId);
  const projBindingsQ = useWorkspaceProjectBindings(workspaceId);
  const access = useProjectAccessMap();

  const visibleProjects = useMemo(
    () =>
      (projectsQ.data ?? []).filter(
        (p: any) =>
          !p.is_archived &&
          access.canSeeProject({ id: p.id, workspace_id: workspaceId }),
      ),
    [projectsQ.data, access, workspaceId],
  );

  const projectBindingMap = useMemo(() => {
    const m = new Map<string, SharepointProjectBinding>();
    for (const b of projBindingsQ.data ?? []) {
      if (b.binding_status !== "disabled") m.set(b.project_id, b);
    }
    return m;
  }, [projBindingsQ.data]);

  const ws = wsBindingQ.data;
  const wsActive = !!ws && ws.binding_status !== "disabled";

  return (
    <div className="space-y-6">
      {/* Section 1 — Workspace Files */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Workspace files
        </h2>
        {wsBindingQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">{workspaceName}</CardTitle>
                <Badge variant={bindingTone(ws?.binding_status)} className="capitalize">
                  {bindingLabel(ws?.binding_status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {wsActive && ws ? (
                <>
                  <div className="text-sm text-muted-foreground">
                    {ws.library_label_or_name || ws.site_label_or_name || "SharePoint library"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ws.library_web_url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={ws.library_web_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" />
                          Open library
                        </a>
                      </Button>
                    )}
                    {ws.site_web_url && (
                      <Button variant="ghost" size="sm" asChild>
                        <a href={ws.site_web_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" />
                          Open site
                        </a>
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4 mt-0.5" />
                  <span>
                    No SharePoint library connected for this workspace yet. Org Admin can
                    configure this in Admin → SharePoint.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Section 2 — Project Files */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Project files
        </h2>
        {projectsQ.isLoading || projBindingsQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : visibleProjects.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No projects in this workspace yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visibleProjects
              .map((p: any) => {
                const b = projectBindingMap.get(p.id);
                return (
                  <Card key={p.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">
                          <Link
                            to={`/workspace/${workspaceId}/project/${p.id}/files?from=files`}
                            className="hover:underline"
                          >
                            {p.name}
                          </Link>
                        </CardTitle>
                        {b && (
                          <Badge
                            variant={bindingTone(b.binding_status)}
                            className="capitalize shrink-0"
                          >
                            {bindingLabel(b.binding_status)}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {b?.folder_web_url ? (
                        <>
                          <div className="text-xs text-muted-foreground truncate">
                            {b.folder_relative_path || b.folder_web_url}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" asChild>
                              <a href={b.folder_web_url} target="_blank" rel="noreferrer">
                                <FolderOpen className="h-4 w-4 mr-1" />
                                Open folder
                              </a>
                            </Button>
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/workspace/${workspaceId}/project/${p.id}/files?from=files`}>
                                Project files
                              </Link>
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            No project folder linked.
                          </span>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/workspace/${workspaceId}/project/${p.id}/files?from=files`}>
                              Open project
                            </Link>
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}
      </section>
    </div>
  );
}
