import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lock, RotateCcw, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useApproveProjectBaseline, useRebaselineProject } from "@/hooks/useProjectBaseline";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { BaselineComparison } from "@/components/baseline/BaselineComparison";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";

interface Props {
  projectId: string;
  workspaceId: string | undefined;
  currentStart: string | null;
  currentEnd: string | null;
  isBaselined: boolean;
  baselineStart: string | null;
  baselineEnd: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
}

interface PreflightSummary {
  phaseCount: number;
  taskCount: number;
  issues: string[];
}

function usePreflight(projectId: string, projectStart: string | null, projectEnd: string | null, enabled: boolean) {
  return useQuery<PreflightSummary>({
    queryKey: ["baseline-preflight", projectId, projectStart, projectEnd],
    enabled: enabled && !!projectId,
    queryFn: async () => {
      const issues: string[] = [];
      if (!projectStart || !projectEnd) issues.push("Project is missing planned start or end date.");

      const { data: phases, error: phErr } = await supabase
        .from("phases")
        .select("id, name, start_date, target_end_date")
        .eq("project_id", projectId)
        .eq("is_archived", false);
      if (phErr) throw phErr;

      const { data: tasks, error: tErr } = await supabase
        .from("tasks")
        .select("id, name, phase_id, start_date, due_date")
        .eq("project_id", projectId)
        .eq("is_archived", false);
      if (tErr) throw tErr;

      const phaseList = phases || [];
      const taskList = tasks || [];

      let missingPh = 0, outsideProjectPh = 0;
      for (const p of phaseList) {
        if (!p.start_date || !p.target_end_date) { missingPh++; continue; }
        if (projectStart && p.start_date < projectStart) outsideProjectPh++;
        else if (projectEnd && p.target_end_date > projectEnd) outsideProjectPh++;
      }
      if (missingPh) issues.push(`${missingPh} phase${missingPh === 1 ? "" : "s"} missing planned dates.`);
      if (outsideProjectPh) issues.push(`${outsideProjectPh} phase${outsideProjectPh === 1 ? "" : "s"} outside project window.`);

      const phaseById = new Map(phaseList.map((p) => [p.id, p]));
      let missingT = 0, outsidePhaseT = 0;
      for (const t of taskList) {
        if (!t.start_date || !t.due_date) { missingT++; continue; }
        const ph = phaseById.get(t.phase_id);
        if (ph?.start_date && t.start_date < ph.start_date) outsidePhaseT++;
        else if (ph?.target_end_date && t.due_date > ph.target_end_date) outsidePhaseT++;
      }
      if (missingT) issues.push(`${missingT} task${missingT === 1 ? "" : "s"} missing planned dates.`);
      if (outsidePhaseT) issues.push(`${outsidePhaseT} task${outsidePhaseT === 1 ? "" : "s"} outside their phase window.`);

      return { phaseCount: phaseList.length, taskCount: taskList.length, issues };
    },
  });
}

export function ProjectBaselineCard({
  projectId, workspaceId, currentStart, currentEnd,
  isBaselined, baselineStart, baselineEnd, approvedAt, approvedBy,
}: Props) {
  const { canEdit } = useProjectPlanningAuthority(projectId);
  const approve = useApproveProjectBaseline();
  const rebase = useRebaselineProject();
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmRebase, setConfirmRebase] = useState(false);
  const { data: members = [] } = useWorkspaceMembers(workspaceId);

  const memberName = approvedBy
    ? members.find((m) => m.id === approvedBy)?.display_name
    : null;

  const { data: resolvedName } = useQuery({
    queryKey: ["org-user-display-name", approvedBy],
    enabled: !!approvedBy && !memberName,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_org_user_display_name", {
        _user_id: approvedBy!,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  const approverName = approvedBy ? memberName || resolvedName || null : null;

  // Preflight only fetched on demand (when dialog opens) to keep overview light.
  const preflightEnabled = confirmApprove || confirmRebase;
  const { data: preflight, isLoading: preflightLoading } =
    usePreflight(projectId, currentStart, currentEnd, preflightEnabled);

  const hasIssues = preflight?.issues?.length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Schedule Baseline
            </CardTitle>
            <CardDescription className="text-xs">
              {isBaselined
                ? "Baseline approved. Current project, phase, and task dates are compared against the approved baseline. Rebaseline only when the approved plan should be reset."
                : "Approve baseline to snapshot the current project, phase, and task planned dates. Future date changes will show variance against this baseline."}
            </CardDescription>

          </div>
          {isBaselined ? (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" /> Baselined
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Not baselined</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <BaselineComparison
          currentStart={currentStart}
          currentEnd={currentEnd}
          baselineStart={baselineStart}
          baselineEnd={baselineEnd}
          isBaselined={isBaselined}
        />

        {isBaselined && (approvedAt || approverName) && (
          <div className="text-xs text-muted-foreground border-t border-border pt-2">
            Approved
            {approverName && <> by <span className="font-medium text-foreground">{approverName}</span></>}
            {approvedAt && (
              <> on <span className="font-medium text-foreground">
                {new Date(approvedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </span></>
            )}.
          </div>
        )}

        {!isBaselined && (
          <p className="text-xs text-muted-foreground">
            No baseline approved yet. Approval snapshots project, phase, and task planned dates together — phase and task baselines are not approved individually.
          </p>
        )}


        {canEdit && (
          <div className="flex gap-2 flex-wrap pt-1">
            {!isBaselined ? (
              <Button size="sm" onClick={() => setConfirmApprove(true)} disabled={approve.isPending}>
                <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Approve Baseline
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirmRebase(true)} disabled={rebase.isPending}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Rebaseline
              </Button>
            )}
          </div>
        )}
      </CardContent>

      {/* Approve preflight */}
      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Approve baseline?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This snapshots the <strong>current planned dates</strong> of the project, all phases and all tasks
              as the approved baseline. Current dates remain editable; baseline only changes through an explicit Rebaseline.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <PreflightBlock loading={preflightLoading} preflight={preflight} />

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => approve.mutate(projectId)}
              disabled={preflightLoading || hasIssues > 0}
            >
              Approve baseline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rebaseline preflight */}
      <AlertDialog open={confirmRebase} onOpenChange={setConfirmRebase}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4" /> Rebaseline this project?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Rebaseline replaces the current approved baseline with the latest planned dates across project, phases, and tasks.
              The previous baseline is not recoverable. The action is logged in baseline history.
            </AlertDialogDescription>

          </AlertDialogHeader>

          <PreflightBlock loading={preflightLoading} preflight={preflight} />

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rebase.mutate(projectId)}
              disabled={preflightLoading || hasIssues > 0}
            >
              Rebaseline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function PreflightBlock({ loading, preflight }: { loading: boolean; preflight: PreflightSummary | undefined }) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Checking schedule integrity…</p>;
  }
  if (!preflight) return null;
  const { phaseCount, taskCount, issues } = preflight;

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        Will snapshot <span className="font-medium text-foreground">{phaseCount} phase{phaseCount === 1 ? "" : "s"}</span> and <span className="font-medium text-foreground">{taskCount} task{taskCount === 1 ? "" : "s"}</span>.
      </div>
      {issues.length === 0 ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle className="text-sm">Ready to baseline</AlertTitle>
          <AlertDescription className="text-xs">All phases and tasks have valid planned dates within their parent windows.</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-sm">Cannot baseline yet</AlertTitle>
          <AlertDescription className="text-xs">
            <ul className="list-disc pl-4 space-y-0.5 mt-1">
              {issues.map((i, idx) => <li key={idx}>{i}</li>)}
            </ul>
            <div className="mt-2">Fix these in Planning, then try again.</div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
