import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useWorkspacePrograms, useProgramCreate } from "@/hooks/usePrograms";
import { usePlanningAuthority } from "@/hooks/usePlanningAuthority";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ProgramFormDialog } from "@/components/program/ProgramFormDialog";
import { Plus, Archive } from "lucide-react";
import { usePersistedViewState, codecs } from "@/hooks/usePersistedViewState";

import { getPmWorkflowStatusBadgeClass, getPmWorkflowStatusLabel } from "@/lib/btpmVisualSemantics";

export default function WorkspacePrograms({ workspaceId: workspaceIdProp }: { workspaceId?: string } = {}) {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = workspaceIdProp ?? params.workspaceId;
  const { data: programs, isLoading } = useWorkspacePrograms(workspaceId);
  const { canEdit } = usePlanningAuthority(workspaceId);
  const createMutation = useProgramCreate(workspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const { state: vs, setField } = usePersistedViewState({
    viewId: "workspace-programs",
    scopeKey: workspaceId ?? "none",
    schema: {
      showArchived: { mode: "local", default: false, codec: codecs.boolean },
    },
  });
  const showArchived = vs.showArchived;
  const setShowArchived = (v: boolean) => setField("showArchived", v);

  const activePrograms = programs?.filter((p) => !p.is_archived) || [];
  const archivedPrograms = programs?.filter((p) => p.is_archived) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Programs</p>
        <div className="flex gap-2">
          {archivedPrograms.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>
              <Archive className="h-4 w-4 mr-1" />
              {showArchived ? "Hide archived" : `Archived (${archivedPrograms.length})`}
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New program
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !activePrograms.length && !showArchived ? (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground">No programs in this workspace yet.</p>
            {canEdit && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create first program
              </Button>
            )}
            {!canEdit && (
              <p className="text-xs text-muted-foreground">You do not have permission to create programs.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {activePrograms.map((p) => (
            <Link key={p.id} to={`/workspace/${workspaceId}/program/${p.id}`}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{p.name}</p>
                    {p.description && (
                      <p className="text-xs text-muted-foreground truncate max-w-md">{p.description}</p>
                    )}
                  </div>
                  <Badge className={getPmWorkflowStatusBadgeClass(p.status)}>{getPmWorkflowStatusLabel(p.status)}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}

          {showArchived && archivedPrograms.map((p) => (
            <Link key={p.id} to={`/workspace/${workspaceId}/program/${p.id}`}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer opacity-60">
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">Archived</p>
                  </div>
                  <Badge className={getPmWorkflowStatusBadgeClass(p.status)}>{getPmWorkflowStatusLabel(p.status)}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {canEdit && (
        <ProgramFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSave={async (data) => {
            await createMutation.mutateAsync(data);
            setCreateOpen(false);
          }}
          saving={createMutation.isPending}
        />
      )}
    </div>
  );
}
