import { useState } from "react";
import {
  useUserWorkspaceProjects,
  useProjectAccessMutations,
  type ProjectRole,
} from "@/hooks/useProjectAccessAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, FolderKanban, Trash2, Wand2, ListChecks } from "lucide-react";

const PROJECT_ROLES: { value: ProjectRole; label: string }[] = [
  { value: "project_manager", label: "Project Manager" },
  { value: "contributor", label: "Contributor" },
  { value: "viewer", label: "Viewer" },
];

interface WorkspaceEntry {
  workspace_id: string;
  workspace_name: string;
  role: string | null;
}

function WorkspaceProjectsBlock({
  userId,
  ws,
  open,
  onOpenChange,
}: {
  userId: string;
  ws: WorkspaceEntry;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data, isLoading } = useUserWorkspaceProjects(userId, ws.workspace_id, open);
  const m = useProjectAccessMutations(userId, ws.workspace_id);

  const accessibleCount = (data || []).filter((r) => r.role).length;
  const totalActive = (data || []).filter((r) => !r.is_archived).length;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="border rounded-md">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between gap-2 p-3 hover:bg-muted/40 text-left">
            <div className="flex items-center gap-2 min-w-0">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium truncate">{ws.workspace_name}</span>
              <Badge variant="outline" className="text-[10px]">
                Workspace role: {ws.role || "—"}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {open ? `${accessibleCount} of ${totalActive} projects` : "Click to view projects"}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t p-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={m.grantAll.isPending}
                onClick={() => m.grantAll.mutate(undefined)}
              >
                <Wand2 className="h-3.5 w-3.5 mr-1" /> Grant all (inherit role)
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={m.resetInherit.isPending}
                onClick={() => m.resetInherit.mutate()}
              >
                <ListChecks className="h-3.5 w-3.5 mr-1" /> Reset to inherited role
              </Button>
            </div>

            {isLoading && <Skeleton className="h-24 w-full" />}
            {!isLoading && (data || []).length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No projects in this workspace.</p>
            )}
            {!isLoading && (data || []).length > 0 && (
              <div className="divide-y border rounded">
                {(data || []).map((row) => (
                  <div key={row.project_id} className="flex items-center gap-2 p-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{row.project_name}</div>
                      {row.is_archived && (
                        <span className="text-[10px] text-muted-foreground">Archived</span>
                      )}
                    </div>
                    <Select
                      value={row.role || "none"}
                      onValueChange={(v) => {
                        if (v === "none") {
                          if (row.role) m.remove.mutate({ projectId: row.project_id });
                        } else {
                          m.grant.mutate({ projectId: row.project_id, role: v as ProjectRole });
                        }
                      }}
                    >
                      <SelectTrigger className="w-[170px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No access</SelectItem>
                        {PROJECT_ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {row.role && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => m.remove.mutate({ projectId: row.project_id })}
                        disabled={m.remove.isPending}
                        aria-label="Remove project access"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface Props {
  userId: string;
  workspaces: WorkspaceEntry[];
}

export function ProjectAccessSection({ userId, workspaces }: Props) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Project Access</CardTitle>
        <p className="text-xs text-muted-foreground">
          Per-project access within each workspace. Workspace Admins and Org Admins retain full
          authority regardless of project memberships shown here.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {workspaces.length === 0 && (
          <p className="text-sm text-muted-foreground">
            User has no workspace memberships yet. Add workspace access first.
          </p>
        )}
        {workspaces.map((ws) => (
          <WorkspaceProjectsBlock
            key={ws.workspace_id}
            userId={userId}
            ws={ws}
            open={!!openMap[ws.workspace_id]}
            onOpenChange={(v) =>
              setOpenMap((prev) => ({ ...prev, [ws.workspace_id]: v }))
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}
