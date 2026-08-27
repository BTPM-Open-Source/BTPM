import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useProgram, useProgramProjects, useProgramUpdate } from "@/hooks/usePrograms";
import { useWorkspaceProjects } from "@/hooks/useProjectOverview";
import { usePlanningAuthority } from "@/hooks/usePlanningAuthority";
import { useCanHardDeleteBusinessObject } from "@/hooks/useCanHardDeleteBusinessObject";
import { LifecycleActions } from "@/components/lifecycle/LifecycleActions";
import { HARD_DELETE_CASCADE_COPY } from "@/lib/lifecycleVocabulary";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ProgramFormDialog } from "@/components/program/ProgramFormDialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Pencil, Plus, LinkIcon, Unlink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

import { getPmWorkflowStatusBadgeClass, getPmWorkflowStatusLabel } from "@/lib/btpmVisualSemantics";

export default function ProgramDetail() {
  const { workspaceId, programId } = useParams<{ workspaceId: string; programId: string }>();
  const { data: program, isLoading } = useProgram(programId);
  const { data: projects = [], isLoading: projLoading } = useProgramProjects(programId);
  const { data: allProjects = [] } = useWorkspaceProjects(workspaceId);
  const { canEdit } = usePlanningAuthority(workspaceId);
  const { data: canHardDelete = false } = useCanHardDeleteBusinessObject(workspaceId);
  const updateMutation = useProgramUpdate(programId, workspaceId);
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Projects not yet linked to this program
  const linkedIds = new Set(projects.map((p: any) => p.id));
  const unlinkableProjects = allProjects.filter(
    (p: any) => !linkedIds.has(p.id) && !p.is_archived
  );

  const linkProject = async (projectId: string, targetProgramId: string | null) => {
    // PMG.3 — Route Project ↔ Program (un)linking through the protected
    // `apply_project_update` command; program_id is one of its allowed
    // narrative/metadata fields. Fetch a fresh canonical updated_at first
    // so optimistic-concurrency doesn't false-fire.
    const { data: fresh, error: freshErr } = await supabase.rpc(
      "get_decrypted_project",
      { _project_id: projectId } as any,
    );
    if (freshErr) throw freshErr;
    const row: any = Array.isArray(fresh) ? fresh[0] : fresh;
    const expected: string | null = row?.updated_at ?? null;
    if (!expected) throw new Error("Unable to read current project state");

    const { data, error } = await supabase.rpc("apply_project_update", {
      _project_id: projectId,
      _expected_updated_at: expected,
      _program_id: targetProgramId,
      _set_program_id: true,
    } as any);
    if (error) throw error;

    // Fail closed: a null or malformed PMG response must never be treated as success.
    const result = parsePmgCommandResult(data);
    if (result.status === "applied" || result.status === "no_change") {
      return;
    }
    if (
      result.status === "not_authorized" ||
      result.status === "conflict" ||
      result.status === "invalid"
    ) {
      const reason =
        typeof result.data?.reason === "string" && result.data.reason
          ? result.data.reason
          : `Project link update failed (${result.status})`;
      throw new Error(reason);
    }
    throw new Error(`Project link update failed (${result.status})`);
  };

  const handleLink = async (projectId: string) => {
    setLinking(projectId);
    try {
      await linkProject(projectId, programId ?? null);
      queryClient.invalidateQueries({ queryKey: ["program-projects", programId] });
      queryClient.invalidateQueries({ queryKey: ["workspace-projects", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast({ title: "Project linked to program" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLinking(null);
    }
  };

  const handleUnlink = async (projectId: string) => {
    setLinking(projectId);
    try {
      await linkProject(projectId, null);
      queryClient.invalidateQueries({ queryKey: ["program-projects", programId] });
      queryClient.invalidateQueries({ queryKey: ["workspace-projects", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast({ title: "Project unlinked from program" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLinking(null);
    }
  };


  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!program) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-destructive">Program not found or access denied.</p>
        <Button variant="link" asChild className="mt-2 p-0">
          <Link to={`/workspace/${workspaceId}`}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
        </Button>
      </div>
    );
  }

  // (handleArchiveToggle removed — Wave 5 Step 5.5 routes lifecycle through
  // LifecycleActions / canonical Step 5.3 RPCs instead of raw is_archived.)

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to={`/workspace/${workspaceId}/programs`}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to programs
        </Link>
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{program.name}</h1>
            <Badge className={getPmWorkflowStatusBadgeClass(program.status)}>{getPmWorkflowStatusLabel(program.status)}</Badge>
            {program.is_archived && <Badge variant="outline">Archived</Badge>}
          </div>
          {program.description && (
            <p className="text-sm text-muted-foreground mt-1">{program.description}</p>
          )}
        </div>
        {(canEdit || canHardDelete) && (
          <div className="flex gap-2 shrink-0 items-center">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
            )}
            <LifecycleActions
              target="program"
              id={program.id}
              name={program.name}
              isArchived={!!program.is_archived}
              canArchive={canEdit}
              canHardDelete={canHardDelete}
              cascadeDescription={HARD_DELETE_CASCADE_COPY.program}
              requireTypeName
              invalidate={[
                ["program", programId!],
                ["workspace-programs", workspaceId!],
                ["workspace-programs"],
              ]}
              onAfterHardDelete={() => navigate(`/workspace/${workspaceId}/programs`)}
            />
          </div>
        )}
      </div>

      {/* Linked Projects */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">Linked Projects</h2>
          {canEdit && unlinkableProjects.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Link project
            </Button>
          )}
        </div>
        {projLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !projects.length ? (
          <Card>
            <CardContent className="py-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">No projects linked to this program.</p>
              {canEdit && unlinkableProjects.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Link a project
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {projects.map((p: any) => (
              <Card key={p.id} className="hover:bg-accent/50 transition-colors">
                <CardContent className="py-4 flex items-center justify-between">
                  <Link to={`/workspace/${workspaceId}/project/${p.id}`} className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{p.name}</p>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={getPmWorkflowStatusBadgeClass(p.status)}>{getPmWorkflowStatusLabel(p.status)}</Badge>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnlink(p.id)}
                        disabled={linking === p.id}
                        title="Unlink from program"
                      >
                        <Unlink className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Edit dialog */}
      {canEdit && (
        <ProgramFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          program={program}
          onSave={async (data) => {
            await updateMutation.mutateAsync(data);
            setEditOpen(false);
          }}
          saving={updateMutation.isPending}
        />
      )}

      {/* Link project dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link a project to {program.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {unlinkableProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                All workspace projects are already linked.
              </p>
            ) : (
              unlinkableProjects.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleLink(p.id)}
                    disabled={linking === p.id}
                  >
                    <LinkIcon className="h-3.5 w-3.5 mr-1" />
                    {linking === p.id ? "…" : "Link"}
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
