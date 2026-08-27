import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/ui/field-label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useProjectUpdate,
  useProjectStatusTransition,
  type ProjectUpdatePayload,
  type ProjectStatusTransitionResult,
} from "@/hooks/useProjectUpdate";
import {
  PROJECT_DELIVERY_MODEL_VALUES,
  DELIVERY_MODEL_UNCLASSIFIED_SENTINEL,
  deliveryModelFromSelectValue,
  deliveryModelToSelectValue,
  projectDeliveryModelLabel,
} from "@/lib/projectDeliveryModel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Constants } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import {
  previewProjectPlanningChange,
  applyProjectPlanningChange,
  describeBlockedReason,
} from "@/lib/planningService";
import { DATE_RANGE_ERROR_MESSAGE, isInvalidDateRange } from "@/lib/dateRangeValidation";
import {
  validateProjectCompletion,
  describeCompletionCheck,
  type ProjectCompletionValidationResult,
} from "@/lib/projectCompletionGuard";
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
import { Lock, AlertTriangle, RefreshCw } from "lucide-react";
import {
  useProjectPortfolioPicker,
  useAssignProjectPortfolio,
} from "@/hooks/useProjectPortfolio";
import { ProjectPortfolioSelect } from "@/components/project/ProjectPortfolioSelect";

const statuses = Constants.public.Enums.pm_status;
const priorities = Constants.public.Enums.pm_priority;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: any;
}

export function ProjectEditDialog({ open, onOpenChange, project }: Props) {
  const [form, setForm] = useState<ProjectUpdatePayload>({});
  const [saving, setSaving] = useState(false);
  const mutation = useProjectUpdate(project?.id);
  const statusTransition = useProjectStatusTransition(project?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isCompleted = project?.status === "completed";
  const [warningDialog, setWarningDialog] =
    useState<{ result: ProjectCompletionValidationResult; pending: ProjectUpdatePayload } | null>(null);
  const [reopenConfirm, setReopenConfirm] = useState(false);

  const [portfolioItemId, setPortfolioItemId] = useState<string>("none");

  const assignPortfolio = useAssignProjectPortfolio({
    projectId: project?.id,
    workspaceId: project?.workspace_id,
    organizationId: project?.organization_id,
  });

  const { data: portfolioItems = [], isLoading: loadingPortfolios } =
    useProjectPortfolioPicker(project?.id, open && !isCompleted);

  // Load programs for optional picker — decrypted, same workspace
  const { data: programs = [] } = useQuery({
    queryKey: ["workspace-programs-for-picker", project?.workspace_id, project?.program_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_decrypted_workspace_programs", {
        _workspace_id: project.workspace_id,
      });
      if (error) throw error;
      const all = (data as any[]) || [];
      return all.filter(
        (pg: any) => !pg.is_archived || pg.id === project.program_id
      );
    },
    enabled: open && !!project?.workspace_id,
  });

  useEffect(() => {
    if (open && project) {
      setForm({
        name: project.name || "",
        status: project.status || "planned",
        priority: project.priority || "medium",
        start_date: project.start_date || "",
        target_end_date: project.target_end_date || "",
        description: project.description || "",
        charter: project.charter || "",
        goals: project.goals || "",
        scope_in: project.scope_in || "",
        scope_out: project.scope_out || "",
        business_case: project.business_case || "",
        success_criteria: project.success_criteria || "",
        completion_criteria: project.completion_criteria || "",
        budget_narrative: project.budget_narrative || "",
        assumptions: project.assumptions || "",
        constraints: project.constraints || "",
        program_id: project.program_id || null,
        delivery_model: (project as any).delivery_model ?? null,
      });
      setPortfolioItemId(
        (project as any).portfolio_item_id
          ? String((project as any).portfolio_item_id)
          : "none",
      );
    }
  }, [open, project]);

  const set = (key: keyof ProjectUpdatePayload, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const buildPayload = (): ProjectUpdatePayload => {
    const payload: ProjectUpdatePayload = { ...form };
    for (const k of [
      "start_date", "target_end_date", "description", "charter", "goals",
      "scope_in", "scope_out", "business_case", "success_criteria",
      "completion_criteria", "budget_narrative", "assumptions", "constraints",
    ] as const) {
      if (payload[k] === "") (payload as any)[k] = null;
    }
    if (payload.program_id === "none") payload.program_id = null;
    return payload;
  };

  const describeCompletionCounts = (result: ProjectStatusTransitionResult): string => {
    const items = (result.warnings ?? []) as Array<{ code?: string; message?: string; count?: number }>;
    if (!items.length) return "Project has unresolved closeout items.";
    return items
      .map((w) => {
        const label = w.message ?? w.code ?? "Issue";
        return w.count && w.count > 1 ? `${label} (${w.count})` : label;
      })
      .join("; ");
  };

  const runStatusTransition = async (
    targetStatus: string,
    opts: { confirmWarnings?: boolean; expectedUpdatedAt?: string | null } = {},
  ): Promise<{ ok: boolean; blockedMessage?: string }> => {
    try {
      const expected =
        opts.expectedUpdatedAt !== undefined ? opts.expectedUpdatedAt : project?.updated_at;
      const result = await statusTransition.mutateAsync({
        expectedUpdatedAt: expected,
        targetStatus,
        confirmWarnings: opts.confirmWarnings ?? false,
      });
      if (result.status === "applied" || result.status === "no_change") {
        return { ok: true };
      }
      if (result.status === "not_authorized") {
        toast({
          title: "Cannot change status",
          description: "You do not have permission to change this project's status.",
          variant: "destructive",
        });
        return { ok: false };
      }
      if (result.status === "conflict") {
        toast({
          title: "Project changed elsewhere",
          description:
            "This project was updated by someone else. Reload and try your status change again.",
          variant: "destructive",
        });
        return { ok: false };
      }
      if (result.status === "blocked") {
        const msg =
          targetStatus === "completed"
            ? "This project cannot be marked Completed because it has unresolved blockers. Resolve or close all blockers before completing the project."
            : describeCompletionCounts(result);
        toast({ title: "Cannot change status", description: msg, variant: "destructive" });
        return { ok: false, blockedMessage: msg };
      }
      if (result.status === "confirmation_required") {
        toast({
          title: "Confirmation required",
          description: describeCompletionCounts(result),
          variant: "destructive",
        });
        return { ok: false };
      }
      toast({
        title: "Cannot change status",
        description: (result.data && (result.data as any)?.reason) || "Invalid status transition.",
        variant: "destructive",
      });
      return { ok: false };
    } catch (e: any) {
      toast({
        title: "Could not change status",
        description: e?.message || String(e),
        variant: "destructive",
      });
      return { ok: false };
    }
  };

  // PMG.2G.0 correction — fetch the canonical fresh Project snapshot's updated_at
  // through the existing protected read path. Used before a → completed transition
  // when non-status edits were saved earlier in the same commit.
  const fetchFreshProjectUpdatedAt = async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.rpc("get_decrypted_project", {
        _project_id: project.id,
      });
      if (error) return null;
      const row: any = Array.isArray(data) ? data[0] : data;
      const ts = row?.updated_at ?? null;
      return typeof ts === "string" ? ts : null;
    } catch {
      return null;
    }
  };

  const commitSave = async (payload: ProjectUpdatePayload) => {
    const newStart = payload.start_date ?? null;
    const newEnd = payload.target_end_date ?? null;
    const oldStart = project.start_date || null;
    const oldEnd = project.target_end_date || null;
    const datesChanged = newStart !== oldStart || newEnd !== oldEnd;

    const currentStatus: string = project?.status ?? "planned";
    const nextStatus: string = payload.status ?? currentStatus;
    const statusChanged = nextStatus !== currentStatus;
    const transitioningToCompleted = statusChanged && nextStatus === "completed";

    if (isInvalidDateRange(newStart, newEnd)) {
      toast({ title: "Cannot save", description: DATE_RANGE_ERROR_MESSAGE, variant: "destructive" });
      return;
    }

    const metadataKeys: (keyof ProjectUpdatePayload)[] = [
      "name", "priority", "description", "charter", "goals",
      "scope_in", "scope_out", "business_case", "success_criteria",
      "completion_criteria", "budget_narrative", "assumptions", "constraints",
      "program_id", "delivery_model",
    ];

    setSaving(true);
    try {
      // Ordinary (non-completed) status transitions preserve prior order:
      // status first, then dates/metadata/portfolio. Read-only completion guard
      // does not apply because target is not `completed`.
      if (statusChanged && !transitioningToCompleted) {
        const outcome = await runStatusTransition(nextStatus);
        if (!outcome.ok) {
          setSaving(false);
          return;
        }
      }

      // Dates via canonical planning command (before completion, to avoid the
      // read-only lock triggered by completion).
      if (datesChanged) {
        const preview = await previewProjectPlanningChange(project.id, newStart, newEnd);
        if (preview.blocked) {
          toast({
            title: "Cannot save",
            description: describeBlockedReason(preview.blocked_reason),
            variant: "destructive",
          });
          setSaving(false);
          return;
        }
        await applyProjectPlanningChange(project.id, newStart, newEnd);
      }

      // Generic metadata (status stripped by useProjectUpdate; dates already applied).
      const nonDatePayload: ProjectUpdatePayload = { ...payload };
      if (datesChanged) {
        delete nonDatePayload.start_date;
        delete nonDatePayload.target_end_date;
      }
      const hasMetadata = metadataKeys.some((k) => k in nonDatePayload);
      if (hasMetadata) {
        await mutation.mutateAsync(nonDatePayload);
      }

      // Portfolio assignment via protected RPC.
      const currentPortfolio = ((project as any).portfolio_item_id as string | null) ?? null;
      const selectedPortfolio = portfolioItemId === "none" ? null : portfolioItemId;
      if (currentPortfolio !== selectedPortfolio) {
        await assignPortfolio.mutateAsync({
          projectId: project.id,
          portfolioItemId: selectedPortfolio,
        });
      }

      // Transition to Completed LAST — so server validation sees the final saved
      // state and the read-only completion lock is applied only after all other
      // edits succeed. Use a fresh updated_at from the canonical protected read.
      if (transitioningToCompleted) {
        const freshUpdatedAt = await fetchFreshProjectUpdatedAt();
        if (!freshUpdatedAt) {
          toast({
            title: "Could not mark Completed",
            description:
              "Could not read the latest project snapshot required to complete safely. Your other changes were saved. Please reload and try marking the project Completed again.",
            variant: "destructive",
          });
          queryClient.invalidateQueries({ queryKey: ["project", project.id] });
          setSaving(false);
          return;
        }
        const outcome = await runStatusTransition("completed", {
          confirmWarnings: true,
          expectedUpdatedAt: freshUpdatedAt,
        });
        if (!outcome.ok) {
          // Non-status edits may have persisted; ensure caches reflect that,
          // but the Project is guaranteed NOT completed.
          queryClient.invalidateQueries({ queryKey: ["project", project.id] });
          setSaving(false);
          return;
        }
      }

      if (datesChanged || statusChanged) {
        queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      }

      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("BTPM_CONTAINMENT_PROJECT_SHRINK_START") || msg.includes("BTPM_CONTAINMENT_PROJECT_SHRINK_END")) {
        const match = msg.match(/child phase "([^"]+)" (starts|ends) (\S+)/);
        if (match) {
          toast({
            title: "Cannot save",
            description: `Cannot shrink project: child phase "${match[1]}" ${match[2]} ${match[3]}.`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Cannot save", description: "Project dates would conflict with existing phases.", variant: "destructive" });
        }
      } else {
        toast({ title: "Error saving project", description: msg, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };


  const handleSave = async () => {
    const payload = buildPayload();
    const transitioningToCompleted =
      payload.status === "completed" && project?.status !== "completed";

    if (transitioningToCompleted) {
      setSaving(true);
      try {
        const result = await validateProjectCompletion(project.id);
        if (result.hard_blocks.length > 0) {
          toast({
            title: "Cannot mark Completed",
            description:
              "This project cannot be marked Completed because it has unresolved blockers. Resolve or close all blockers before completing the project.",
            variant: "destructive",
          });
          return;
        }
        if (result.warnings.length > 0) {
          setWarningDialog({ result, pending: payload });
          return;
        }
      } catch (e: any) {
        toast({
          title: "Could not validate completion",
          description: e?.message || String(e),
          variant: "destructive",
        });
        return;
      } finally {
        setSaving(false);
      }
    }

    await commitSave(payload);
  };

  const handleReopen = async () => {
    setReopenConfirm(false);
    const outcome = await runStatusTransition("active");
    if (!outcome.ok) return;
    setForm((prev) => ({ ...prev, status: "active" }));
    queryClient.invalidateQueries({ queryKey: ["project", project.id] });
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>

        {isCompleted && (
          <div className="flex items-start gap-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/60 dark:bg-amber-900/20">
            <Lock className="h-4 w-4 mt-0.5 text-amber-700 dark:text-amber-400" />
            <div className="flex-1">
              <div className="font-medium text-amber-900 dark:text-amber-200">
                This project is Completed and read-only
              </div>
              <div className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                Reopen the project before making changes. Reopening returns the status to Active.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReopenConfirm(true)}
              disabled={mutation.isPending || statusTransition.isPending}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Reopen project
            </Button>
          </div>
        )}

        <fieldset disabled={isCompleted} className="contents">
        <div className="grid gap-4 py-2">
          {/* Name */}
          <div className="space-y-1">
            <FieldLabel hint="The official name of the project as it should appear across reports and dashboards." required>
              Project Name
            </FieldLabel>
            <Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} />
          </div>

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <FieldLabel hint="Lifecycle state of the project: planned → active → on hold / completed / cancelled.">
                Status
              </FieldLabel>
              <Select value={form.status || "planned"} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
                    <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <FieldLabel hint="Business importance of this project relative to others. Drives prioritisation and reporting attention.">
                Priority
              </FieldLabel>
              <Select value={form.priority || "medium"} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {priorities.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dates row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <FieldLabel hint="Current planned start date for the project. Editable until baseline approval.">
                Start Date
              </FieldLabel>
              <Input type="date" value={form.start_date || ""} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="space-y-1">
              <FieldLabel hint="Current planned end date for the project. Used by Gantt and variance reporting.">
                Target End Date
              </FieldLabel>
              <Input type="date" value={form.target_end_date || ""} onChange={(e) => set("target_end_date", e.target.value)} />
            </div>
          </div>

          {/* Program (optional) */}
          <div className="space-y-1">
            <FieldLabel hint="Optionally group this project under a workspace program. Leave as 'No program' for standalone projects.">
              Program (optional)
            </FieldLabel>
            <Select value={form.program_id || "none"} onValueChange={(v) => set("program_id", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No program</SelectItem>
                {programs.map((pg: any) => (
                  <SelectItem key={pg.id} value={pg.id}>
                    {pg.name}{pg.is_archived ? " (archived)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Portfolio (optional) */}
          <ProjectPortfolioSelect
            value={portfolioItemId}
            onChange={setPortfolioItemId}
            items={portfolioItems}
            loading={loadingPortfolios}
            disabled={isCompleted}
            currentAssigned={
              (project as any).portfolio_item_id
                ? {
                    id: (project as any).portfolio_item_id as string,
                    name: ((project as any).portfolio_name as string) ?? "Portfolio",
                    code: ((project as any).portfolio_code as string | null) ?? null,
                    is_archived: !!(project as any).portfolio_is_archived,
                  }
                : null
            }
          />

          {/* Delivery model */}
          <div className="space-y-1">
            <FieldLabel hint="Classifies how the project is delivered. Independent of workflow status, priority, and stage.">
              Delivery model
            </FieldLabel>
            <Select
              value={deliveryModelToSelectValue(form.delivery_model ?? null)}
              onValueChange={(v) => set("delivery_model", deliveryModelFromSelectValue(v))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DELIVERY_MODEL_UNCLASSIFIED_SENTINEL}>
                  {projectDeliveryModelLabel(null)}
                </SelectItem>
                {PROJECT_DELIVERY_MODEL_VALUES.map((v) => (
                  <SelectItem key={v} value={v}>{projectDeliveryModelLabel(v)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>


          {/* Narrative fields */}
          <div className="space-y-1">
            <FieldLabel hint="Brief summary of what this project is about. Surfaces in overviews and exports.">
              Description
            </FieldLabel>
            <Textarea rows={3} value={form.description || ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="space-y-1">
            <FieldLabel hint="Formal charter: business case, sponsors, and high-level mandate for this project.">
              Charter
            </FieldLabel>
            <Textarea rows={3} value={form.charter || ""} onChange={(e) => set("charter", e.target.value)} />
          </div>
          <div className="space-y-1">
            <FieldLabel hint="Concrete, measurable outcomes the project must achieve to be considered successful.">
              Goals
            </FieldLabel>
            <Textarea rows={3} value={form.goals || ""} onChange={(e) => set("goals", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <FieldLabel hint="Work explicitly included in this project's scope.">
                In Scope
              </FieldLabel>
              <Textarea rows={3} value={form.scope_in || ""} onChange={(e) => set("scope_in", e.target.value)} />
            </div>
            <div className="space-y-1">
              <FieldLabel hint="Work explicitly excluded from this project's scope. Helps prevent scope creep.">
                Out of Scope
              </FieldLabel>
              <Textarea rows={3} value={form.scope_out || ""} onChange={(e) => set("scope_out", e.target.value)} />
            </div>
          </div>

          {/* Project Charter Details */}
          <div className="space-y-4 pt-2 border-t">
            <h3 className="text-base font-semibold">Project Charter Details</h3>

            <div className="space-y-1">
              <FieldLabel hint="Why this project is justified and what business value it should deliver.">
                Business Case
              </FieldLabel>
              <Textarea rows={3} value={form.business_case || ""} onChange={(e) => set("business_case", e.target.value)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <FieldLabel hint="How success will be judged.">
                  Success Criteria
                </FieldLabel>
                <Textarea rows={3} value={form.success_criteria || ""} onChange={(e) => set("success_criteria", e.target.value)} />
              </div>
              <div className="space-y-1">
                <FieldLabel hint="What must be true for the project to be formally accepted or closed.">
                  Completion Criteria
                </FieldLabel>
                <Textarea rows={3} value={form.completion_criteria || ""} onChange={(e) => set("completion_criteria", e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <FieldLabel hint="Optional budget/resources description. This is narrative only, not budget tracking.">
                Budget Narrative
              </FieldLabel>
              <Textarea rows={3} value={form.budget_narrative || ""} onChange={(e) => set("budget_narrative", e.target.value)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <FieldLabel hint="Key assumptions behind the plan.">
                  Assumptions
                </FieldLabel>
                <Textarea rows={3} value={form.assumptions || ""} onChange={(e) => set("assumptions", e.target.value)} />
              </div>
              <div className="space-y-1">
                <FieldLabel hint="Known limits, restrictions, or conditions affecting delivery.">
                  Constraints
                </FieldLabel>
                <Textarea rows={3} value={form.constraints || ""} onChange={(e) => set("constraints", e.target.value)} />
              </div>
            </div>
          </div>
        </div>
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isCompleted ? "Close" : "Cancel"}
          </Button>
          {!isCompleted && (
            <Button onClick={handleSave} disabled={saving || mutation.isPending || statusTransition.isPending || !form.name?.trim()}>
              {saving || mutation.isPending || statusTransition.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Warning confirmation for soft closeout issues */}
      <AlertDialog
        open={!!warningDialog}
        onOpenChange={(o) => { if (!o) setWarningDialog(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Complete project with warnings?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This project has unresolved closeout items. Review the warnings below. You can still
              mark the project Completed if this is intentional.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {warningDialog && (
            <ul className="list-disc pl-5 text-sm space-y-1">
              {warningDialog.result.warnings.map((w) => (
                <li key={w.code}>{describeCompletionCheck(w)}</li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const pending = warningDialog?.pending;
                setWarningDialog(null);
                if (pending) await commitSave(pending);
              }}
            >
              Complete anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reopen confirmation */}
      <AlertDialog open={reopenConfirm} onOpenChange={setReopenConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make the project editable again and return it to Active status. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReopen}>Reopen project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
