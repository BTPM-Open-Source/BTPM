import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, ExternalLink, MoveRight } from "lucide-react";

type AdminCtx = { organizationId: string };

type Candidate = {
  project_id: string;
  project_name: string;
  source_workspace_id: string;
  source_workspace_name: string;
  program_id: string | null;
  program_name: string | null;
  status: string | null;
  project_stage: string | null;
  delivery_model: string | null;
  is_archived: boolean;
};

type Preview = {
  project_id: string;
  project_name: string;
  source_workspace_id: string;
  source_workspace_name: string;
  target_workspace_id: string;
  target_workspace_name: string;
  current_program_id: string | null;
  current_program_name: string | null;
  target_program_id: string | null;
  target_program_name: string | null;
  program_will_be_cleared: boolean;
  duplicate_name_in_target: boolean;
  cross_workspace_dependency_count: number;
  access_removed_count: number;
  counts: Record<string, number | null>;
  blocking_issues: string[];
};

const NO_PROGRAM = "__none__";

export default function AdminProjectMoves() {
  const { organizationId } = useOutletContext<AdminCtx>();
  const queryClient = useQueryClient();

  const [sourceWs, setSourceWs] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [targetWs, setTargetWs] = useState<string>("");
  const [targetProgram, setTargetProgram] = useState<string>(NO_PROGRAM);
  const [confirmProgramClear, setConfirmProgramClear] = useState(false);
  const [moved, setMoved] = useState<{ projectId: string; targetWs: string } | null>(null);

  const candidatesQ = useQuery({
    queryKey: ["admin-project-move-candidates", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_project_move_candidates", {
        _organization_id: organizationId,
      });
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
    enabled: !!organizationId,
  });

  const candidates = candidatesQ.data ?? [];

  const workspacesQ = useQuery({
    queryKey: ["admin-org-workspaces", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_org_workspaces", {
        _organization_id: organizationId,
      });
      if (error) throw error;
      return ((data ?? []) as { id: string; name: string }[]);
    },
    enabled: !!organizationId,
  });

  const workspaces = useMemo(() => {
    const list = (workspacesQ.data ?? []).map((w) => ({ id: w.id, name: w.name }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [workspacesQ.data]);

  const projectsInSource = useMemo(
    () => candidates.filter((c) => c.source_workspace_id === sourceWs && !c.is_archived),
    [candidates, sourceWs],
  );

  const selectedProject = candidates.find((c) => c.project_id === projectId) || null;

  const programsInTarget = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) {
      if (c.source_workspace_id === targetWs && c.program_id && c.program_name) {
        map.set(c.program_id, c.program_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [candidates, targetWs]);

  const previewEnabled = !!(organizationId && projectId && targetWs && targetWs !== sourceWs);
  const previewQ = useQuery({
    queryKey: ["admin-project-move-preview", organizationId, projectId, targetWs, targetProgram],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_preview_project_workspace_move", {
        _organization_id: organizationId,
        _project_id: projectId,
        _target_workspace_id: targetWs,
        _target_program_id: targetProgram === NO_PROGRAM ? null : targetProgram,
      });
      if (error) throw error;
      return data as Preview;
    },
    enabled: previewEnabled,
  });

  const preview = previewQ.data;
  const blocked = (preview?.blocking_issues ?? []).length > 0;
  const requiresProgramClearConfirm = preview?.program_will_be_cleared && !confirmProgramClear;

  const moveMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_move_project_workspace", {
        _organization_id: organizationId,
        _project_id: projectId,
        _target_workspace_id: targetWs,
        _target_program_id: targetProgram === NO_PROGRAM ? null : targetProgram,
        _confirm_program_clear: !!preview?.program_will_be_cleared,
      });
      if (error) throw error;
      return data as { moved_project_id: string; target_workspace_id: string; target_route: string };
    },
    onSuccess: (res) => {
      toast.success("Project moved to the destination workspace");
      setMoved({ projectId: res.moved_project_id, targetWs: res.target_workspace_id });
      queryClient.invalidateQueries({ predicate: (q) => {
        const k = q.queryKey?.[0];
        return typeof k === "string" && (
          k.startsWith("projects") || k.startsWith("workspace") || k.startsWith("programs") ||
          k.startsWith("project") || k.startsWith("roadmap") || k.startsWith("admin-project-move")
        );
      }});
      setProjectId("");
      setTargetWs("");
      setTargetProgram(NO_PROGRAM);
      setConfirmProgramClear(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Move failed", { description: msg });
    },
  });

  if (candidatesQ.isLoading) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (candidatesQ.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load projects</AlertTitle>
        <AlertDescription>{(candidatesQ.error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const countEntries = preview ? Object.entries(preview.counts ?? {}) : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MoveRight className="h-5 w-5" /> Move project to another workspace</CardTitle>
          <CardDescription>
            This keeps the project and its history, but changes which workspace owns it.
            No project records will be duplicated.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">1. Source workspace</label>
            <Select value={sourceWs} onValueChange={(v) => { setSourceWs(v); setProjectId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select source workspace" /></SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">2. Project to move</label>
            <Select value={projectId} onValueChange={setProjectId} disabled={!sourceWs}>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projectsInSource.map((p) => (
                  <SelectItem key={p.project_id} value={p.project_id}>
                    {p.project_name} {p.program_name ? `· ${p.program_name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProject && (
              <p className="text-xs text-muted-foreground">
                Status: {selectedProject.status ?? "—"} · Stage: {selectedProject.project_stage ?? "—"} · Model: {selectedProject.delivery_model ?? "—"}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">3. Target workspace</label>
            <Select value={targetWs} onValueChange={(v) => { setTargetWs(v); setTargetProgram(NO_PROGRAM); }} disabled={!projectId}>
              <SelectTrigger><SelectValue placeholder="Select target workspace" /></SelectTrigger>
              <SelectContent>
                {workspaces.filter((w) => w.id !== sourceWs).map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">4. Target program (optional)</label>
            <Select value={targetProgram} onValueChange={setTargetProgram} disabled={!targetWs}>
              <SelectTrigger><SelectValue placeholder="No program after move" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROGRAM}>No program after move</SelectItem>
                {programsInTarget.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The current Program belongs to the source workspace and will be cleared unless you select a Program in the target workspace.
            </p>
          </div>
        </CardContent>
      </Card>

      {previewEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>5. Preview</CardTitle>
            <CardDescription>Review the impact before confirming.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {previewQ.isLoading && <Skeleton className="h-32 w-full" />}
            {previewQ.error && (
              <Alert variant="destructive">
                <AlertTitle>Preview failed</AlertTitle>
                <AlertDescription>{(previewQ.error as Error).message}</AlertDescription>
              </Alert>
            )}
            {preview && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline">{preview.source_workspace_name}</Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Badge>{preview.target_workspace_name}</Badge>
                  {preview.target_program_name && (
                    <span className="text-muted-foreground">→ program {preview.target_program_name}</span>
                  )}
                </div>

                {preview.program_will_be_cleared && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Current program will be cleared</AlertTitle>
                    <AlertDescription>
                      "{preview.current_program_name ?? "—"}" belongs to the source workspace and cannot follow the project.
                      Tick the confirmation below to proceed.
                    </AlertDescription>
                  </Alert>
                )}

                {preview.duplicate_name_in_target && (
                  <Alert variant="destructive">
                    <AlertTitle>Duplicate project name in target workspace</AlertTitle>
                    <AlertDescription>
                      A non-archived project named "{preview.project_name}" already exists in {preview.target_workspace_name}.
                      Rename one of them before moving.
                    </AlertDescription>
                  </Alert>
                )}

                {preview.access_removed_count > 0 && (
                  <Alert>
                    <AlertTitle>Access impact</AlertTitle>
                    <AlertDescription>
                      {preview.access_removed_count} direct project membership(s) will be soft-removed for users who are not members of {preview.target_workspace_name}.
                    </AlertDescription>
                  </Alert>
                )}

                {preview.cross_workspace_dependency_count > 0 && (
                  <Alert>
                    <AlertTitle>Project-level dependencies</AlertTitle>
                    <AlertDescription>
                      {preview.cross_workspace_dependency_count} project-level dependency record(s) may now reference items in another workspace. Review after the move.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  {countEntries.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between rounded border border-border px-2 py-1">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium text-foreground">{v ?? 0}</span>
                    </div>
                  ))}
                </div>

                {preview.program_will_be_cleared && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmProgramClear}
                      onChange={(e) => setConfirmProgramClear(e.target.checked)}
                    />
                    I confirm the current Program link will be cleared.
                  </label>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button disabled={blocked || !!requiresProgramClearConfirm || moveMut.isPending}>
                        {moveMut.isPending ? "Moving…" : "Move project"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirm project move</AlertDialogTitle>
                        <AlertDialogDescription>
                          Move "{preview.project_name}" from {preview.source_workspace_name} to {preview.target_workspace_name}.
                          {preview.program_will_be_cleared && " The current Program link will be cleared."}
                          {" "}This will update workspace ownership on all related records in one transaction. Some direct project access may be removed for users who are not members of the destination workspace.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => moveMut.mutate()}>Move project</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {moved && (
        <Alert>
          <AlertTitle>Project moved</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>The project now lives in the destination workspace.</span>
            <Button asChild size="sm" variant="outline">
              <a href={`/workspace/${moved.targetWs}/project/${moved.projectId}`}>
                Open project <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
