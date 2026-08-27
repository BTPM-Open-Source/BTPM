import { useState } from "react";
import { MoreHorizontal, Pencil, Mail, FileStack, Zap, Loader2, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectEditDialog } from "@/components/project/ProjectEditDialog";
import { SaveAsTemplateDialog } from "@/components/templates/SaveAsTemplateDialog";
import { SendObjectEmailDialog } from "@/components/email/SendObjectEmailDialog";
import { HardDeleteConfirmDialog } from "@/components/lifecycle/HardDeleteConfirmDialog";
import { useToggleAgileMode } from "@/hooks/useAgileSubstrate";
import {
  useArchiveTarget,
  useUnarchiveTarget,
  useHardDeleteTarget,
} from "@/hooks/useLifecycleActions";
import { useToast } from "@/hooks/use-toast";
import { pmStatusLabel, priorityLabel } from "@/lib/projectStatus";
import { HARD_DELETE_CASCADE_COPY } from "@/lib/lifecycleVocabulary";
import { useNavigate } from "react-router-dom";

interface Props {
  project: any;
  workspaceName: string | undefined;
  canEdit: boolean;
  agileEnabled: boolean;
  isArchived: boolean;
  canHardDelete: boolean;
}

/**
 * Project shell "More" menu — single discoverable entry point for
 * project-level actions (Project settings, Send email, Save as template,
 * Enable Agile) and lifecycle (Archive/Restore/Permanent delete).
 *
 * Lifecycle items appear in a clearly separated destructive section.
 */
export function ProjectMoreActionsMenu({
  project,
  workspaceName,
  canEdit,
  agileEnabled,
  isArchived,
  canHardDelete,
}: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const toggleAgile = useToggleAgileMode();
  const archive = useArchiveTarget("project");
  const unarchive = useUnarchiveTarget("project");
  const hardDelete = useHardDeleteTarget("project");
  const { toast } = useToast();
  const navigate = useNavigate();

  const lifecycleInvalidate: (string | string[])[] = [
    ["project", project.id],
    ["workspace-projects", project.workspace_id],
  ];

  const handleEnableAgile = async () => {
    try {
      await toggleAgile.mutateAsync({ projectId: project.id, enable: true });
      toast({ title: "Agile mode enabled", description: "Backlog and Sprint planning are now available." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const showLifecycle = canEdit || (canHardDelete && isArchived);
  const showAnyContent = canEdit || showLifecycle;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="More project actions">
            <MoreHorizontal className="h-4 w-4" />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canEdit && (
            <>
              <DropdownMenuLabel>Project</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4 mr-2" /> Project settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEmailOpen(true)}>
                <Mail className="h-4 w-4 mr-2" /> Send email
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Tools</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setTplOpen(true)}>
                <FileStack className="h-4 w-4 mr-2" /> Save as template
              </DropdownMenuItem>
              {!agileEnabled && (
                <DropdownMenuItem
                  disabled={toggleAgile.isPending}
                  onSelect={(e) => {
                    e.preventDefault();
                    handleEnableAgile();
                  }}
                >
                  {toggleAgile.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  Enable Agile
                </DropdownMenuItem>
              )}
            </>
          )}

          {showLifecycle && (
            <>
              {canEdit && <DropdownMenuSeparator />}
              <DropdownMenuLabel>Lifecycle</DropdownMenuLabel>
              {canEdit && !isArchived && (
                <DropdownMenuItem
                  disabled={archive.isPending}
                  onSelect={(e) => {
                    e.preventDefault();
                    archive.mutate({ id: project.id, invalidate: lifecycleInvalidate });
                  }}
                >
                  <Archive className="h-4 w-4 mr-2" /> Archive project
                </DropdownMenuItem>
              )}
              {canEdit && isArchived && (
                <DropdownMenuItem
                  disabled={unarchive.isPending}
                  onSelect={(e) => {
                    e.preventDefault();
                    unarchive.mutate({ id: project.id, invalidate: lifecycleInvalidate });
                  }}
                >
                  <ArchiveRestore className="h-4 w-4 mr-2" /> Restore project
                </DropdownMenuItem>
              )}
              {canHardDelete && isArchived && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Permanent delete
                </DropdownMenuItem>
              )}
            </>
          )}

          {!showAnyContent && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No actions available
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && (
        <>
          <ProjectEditDialog open={editOpen} onOpenChange={setEditOpen} project={project} />
          <SaveAsTemplateDialog
            open={tplOpen}
            onOpenChange={setTplOpen}
            projectId={project.id}
            workspaceId={project.workspace_id}
            defaultName={`${project.name} template`}
          />
          <SendObjectEmailDialog
            open={emailOpen}
            onOpenChange={setEmailOpen}
            targetType="project"
            targetId={project.id}
            objectName={project.name}
            summaryLines={[
              { label: "Workspace", value: workspaceName },
              { label: "Program", value: project.programs?.name ?? null },
              { label: "Status", value: pmStatusLabel(project.status) },
              { label: "Priority", value: priorityLabel(project.priority) },
              { label: "Start", value: project.start_date },
              { label: "Target end", value: project.target_end_date },
            ]}
          />
        </>
      )}

      {canHardDelete && (
        <HardDeleteConfirmDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          targetLabel="project"
          targetName={project.name}
          cascadeDescription={HARD_DELETE_CASCADE_COPY.project}
          requireTypeName
          isPending={hardDelete.isPending}
          onConfirm={() =>
            hardDelete.mutate(
              { id: project.id, invalidate: lifecycleInvalidate },
              {
                onSuccess: () => {
                  setConfirmDeleteOpen(false);
                  navigate(`/workspace/${project.workspace_id}`);
                },
              },
            )
          }
        />
      )}
    </>
  );
}
