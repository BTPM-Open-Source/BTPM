import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Plus, Pencil, X, RotateCcw, ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  useProjectStakeholders,
  useRemoveProjectStakeholder,
  useRestoreProjectStakeholder,
  type ProjectStakeholder,
} from "@/hooks/useProjectStakeholders";
import { StakeholderFormDialog } from "./StakeholderFormDialog";
import { useToast } from "@/hooks/use-toast";
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

type Props = {
  projectId: string;
  workspaceId: string;
  canEdit: boolean;
};

function formatDate(d: string | null) {
  if (!d) return null;
  try {
    return format(new Date(d), "MMM d, yyyy");
  } catch {
    return d;
  }
}

export function StakeholdersSection({ projectId, workspaceId, canEdit }: Props) {
  const { toast } = useToast();
  const { data: stakeholders = [], isLoading } = useProjectStakeholders(projectId);
  const removeMutation = useRemoveProjectStakeholder(projectId);
  const restoreMutation = useRestoreProjectStakeholder(projectId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectStakeholder | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const { active, former } = useMemo(() => {
    const a: ProjectStakeholder[] = [];
    const f: ProjectStakeholder[] = [];
    for (const s of stakeholders) (s.removed_at ? f : a).push(s);
    return { active: a, former: f };
  }, [stakeholders]);

  const stakeholderToRemove = removingId
    ? stakeholders.find((s) => s.id === removingId) ?? null
    : null;

  const handleRemove = async () => {
    if (!removingId) return;
    try {
      await removeMutation.mutateAsync(removingId);
      toast({ title: "Stakeholder removed" });
      setRemovingId(null);
    } catch (err: any) {
      toast({
        title: "Failed to remove stakeholder",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await restoreMutation.mutateAsync(id);
      toast({ title: "Stakeholder restored" });
    } catch (err: any) {
      toast({
        title: "Failed to restore stakeholder",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-foreground">Stakeholders</h2>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add stakeholder
          </Button>
        )}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-5 w-1/2" />
          </CardContent>
        </Card>
      ) : active.length === 0 && former.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No stakeholders added yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.length > 0 && (
            <Card>
              <CardContent className="p-0 divide-y divide-border">
                {active.map((s) => (
                  <StakeholderRow
                    key={s.id}
                    s={s}
                    canEdit={canEdit}
                    onEdit={() => {
                      setEditing(s);
                      setFormOpen(true);
                    }}
                    onRemove={() => setRemovingId(s.id)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {former.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground">
                  <ChevronDown className="h-3.5 w-3.5 mr-1" />
                  Former stakeholders ({former.length})
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Card className="mt-2 border-dashed">
                  <CardContent className="p-0 divide-y divide-border">
                    {former.map((s) => (
                      <StakeholderRow
                        key={s.id}
                        s={s}
                        canEdit={canEdit}
                        former
                        onRestore={canEdit ? () => handleRestore(s.id) : undefined}
                      />
                    ))}
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      <StakeholderFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId}
        workspaceId={workspaceId}
        editing={editing}
      />

      <AlertDialog open={!!removingId} onOpenChange={(o) => !o && setRemovingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove stakeholder?</AlertDialogTitle>
            <AlertDialogDescription>
              {stakeholderToRemove
                ? `"${stakeholderToRemove.display_name}" will be moved to Former Stakeholders. History is preserved.`
                : "This stakeholder will be moved to Former Stakeholders. History is preserved."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function StakeholderRow({
  s,
  canEdit,
  former,
  onEdit,
  onRemove,
  onRestore,
}: {
  s: ProjectStakeholder;
  canEdit: boolean;
  former?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onRestore?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">{s.display_name}</span>
          <Badge variant={s.stakeholder_type === "workspace_member" ? "secondary" : "outline"} className="text-[10px]">
            {s.stakeholder_type === "workspace_member" ? "Workspace member" : "External"}
          </Badge>
          {s.role_label && (
            <span className="text-xs text-muted-foreground truncate">· {s.role_label}</span>
          )}
        </div>
        {s.notes && (
          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{s.notes}</p>
        )}
        <p className="text-[11px] text-muted-foreground mt-1">
          {s.start_date ? `Starts ${formatDate(s.start_date)} · ` : ""}
          Added {formatDate(s.created_at)}
          {s.created_by_name ? ` by ${s.created_by_name}` : ""}
          {former && s.removed_at ? ` · Removed ${formatDate(s.removed_at)}` : ""}
          {former && s.removed_by_name ? ` by ${s.removed_by_name}` : ""}
        </p>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          {!former && onEdit && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {!former && onRemove && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove} aria-label="Remove">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          {former && onRestore && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onRestore}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
