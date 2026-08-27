import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/ui/field-label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Constants, type Enums } from "@/integrations/supabase/types";

const NON_TERMINAL_STATUSES: Enums<"pm_status">[] = ["planned", "active", "on_hold"];
import { useUpdatePhase } from "@/hooks/useProjectPlanning";
import { useToast } from "@/hooks/use-toast";
import { mapDependencyError } from "@/lib/dependencyConflictEngine";
import { SEMANTIC_TYPE_VALUES, semanticTypeLabel, type SemanticType } from "@/lib/phaseTypes";
import {
  applyPhasePlanningChange,
  describeBlockedReason,
  previewPhasePlanningChange,
} from "@/lib/planningService";
import { ParentExtensionConfirmDialog } from "./ParentExtensionConfirmDialog";
import { DATE_RANGE_ERROR_MESSAGE, isInvalidDateRange } from "@/lib/dateRangeValidation";
import { getPmWorkflowStatusLabel, getPmWorkflowStatusBadgeClass } from "@/lib/btpmVisualSemantics";



interface Props {
  phase: any;
  canEdit: boolean;
}

interface PendingExtension {
  parentName: string;
  currentStart: string | null;
  currentEnd: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  run: () => Promise<void>;
}

export function PhasePlanEditor({ phase, canEdit }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updatePhase = useUpdatePhase();

  const [name, setName] = useState(phase.name || "");
  const [description, setDescription] = useState(phase.description || "");
  const [phaseType, setPhaseType] = useState<SemanticType>((phase.phase_type as SemanticType) || "work_item");
  const [status, setStatus] = useState<Enums<"pm_status">>(phase.status || "planned");
  const [startDate, setStartDate] = useState(phase.start_date || "");
  const [endDate, setEndDate] = useState(phase.target_end_date || "");

  const [pendingExt, setPendingExt] = useState<PendingExtension | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(phase.name || "");
    setDescription(phase.description || "");
    setPhaseType((phase.phase_type as SemanticType) || "work_item");
    setStatus(phase.status || "planned");
    setStartDate(phase.start_date || "");
    setEndDate(phase.target_end_date || "");
  }, [phase.id, phase.updated_at]);

  const dirty =
    name !== (phase.name || "") ||
    description !== (phase.description || "") ||
    phaseType !== ((phase.phase_type as SemanticType) || "work_item") ||
    status !== phase.status ||
    startDate !== (phase.start_date || "") ||
    endDate !== (phase.target_end_date || "");

  // The planning apply RPC writes dates outside React Query mutations,
  // so cached phase/project reads must be refreshed explicitly.
  async function refreshPlanningCaches() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["phase-detail", phase.id] }),
      queryClient.invalidateQueries({ queryKey: ["project-phases", phase.project_id] }),
      queryClient.invalidateQueries({ queryKey: ["project", phase.project_id] }),
    ]);
  }

  async function saveNonDateFields() {
    await updatePhase.mutateAsync({
      id: phase.id,
      project_id: phase.project_id,
      name: name.trim(),
      description: description.trim() || null,
      phase_type: phaseType,
      status,
    } as any);
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (isInvalidDateRange(startDate || null, endDate || null)) {
      toast({ title: "Cannot save", description: DATE_RANGE_ERROR_MESSAGE, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const planStart = startDate || null;
      const planEnd   = endDate || null;
      const datesChanged = planStart !== (phase.start_date || null) || planEnd !== (phase.target_end_date || null);
      const nonDateFieldsChanged =
        name.trim() !== (phase.name || "") ||
        (description.trim() || null) !== (phase.description || null) ||
        phaseType !== ((phase.phase_type as SemanticType) || "work_item") ||
        status !== phase.status;

      if (!datesChanged) {
        await saveNonDateFields();
        toast({ title: "Phase saved" });
        return;
      }

      const preview = await previewPhasePlanningChange(phase.id, planStart, planEnd);
      if (preview.blocked) {
        toast({ title: "Cannot save", description: describeBlockedReason(preview.blocked_reason), variant: "destructive" });
        return;
      }
      if (preview.requires_extension) {
        setPendingExt({
          parentName: preview.parent_project_name ?? "Project",
          currentStart: preview.parent_current_start,
          currentEnd:   preview.parent_current_end,
          proposedStart: preview.parent_proposed_start,
          proposedEnd:   preview.parent_proposed_end,
          run: async () => {
            // Non-date fields must be written BEFORE the planning apply:
            // the apply advances phases.updated_at, which would make the
            // generic update fail optimistic concurrency against stale cache.
            if (nonDateFieldsChanged) await saveNonDateFields();
            await applyPhasePlanningChange(phase.id, planStart, planEnd, true);
            await refreshPlanningCaches();
            toast({ title: "Phase saved", description: "Project window extended to fit." });
          },
        });
        return;
      }

      if (nonDateFieldsChanged) await saveNonDateFields();
      await applyPhasePlanningChange(phase.id, planStart, planEnd, false);
      await refreshPlanningCaches();
      toast({ title: "Phase saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: mapDependencyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmExtension = async () => {
    if (!pendingExt) return;
    setSaving(true);
    try {
      await pendingExt.run();
      setPendingExt(null);
    } catch (e: any) {
      toast({ title: "Save failed", description: mapDependencyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isCompleted = phase.status === "completed";
  const isCancelled = phase.status === "cancelled" || phase.is_archived;
  const planLocked = isCompleted || isCancelled;
  const disabled = !canEdit || planLocked;

  return (
    <>
      <div className="space-y-4 border border-border rounded-md p-4 bg-card">
        <h3 className="text-sm font-semibold text-foreground">Plan</h3>
        {isCompleted && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            This phase is completed. Planned dates are locked — open the <span className="font-medium text-foreground">Execution</span> tab to reopen the phase before changing the plan.
          </div>
        )}
        {isCancelled && !isCompleted && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            This phase is cancelled or archived. Planning fields are read-only.
          </div>
        )}
        <div>
          <FieldLabel hint="Name of this phase." required>Name</FieldLabel>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} />
        </div>
        <div>
          <FieldLabel hint="Optional explanation of what this phase covers and what 'done' looks like.">Description</FieldLabel>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={disabled} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel hint="Set planning state here. Mark completed and reopen are handled in the Execution tab.">Status</FieldLabel>
            {isCompleted ? (
              <div className="h-10 flex items-center">
                <Badge className={getPmWorkflowStatusBadgeClass(phase.status)}>
                  {getPmWorkflowStatusLabel(phase.status)}
                </Badge>
              </div>
            ) : (
              <Select
                value={NON_TERMINAL_STATUSES.includes(status) ? status : "planned"}
                onValueChange={(v) => setStatus(v as Enums<"pm_status">)}
                disabled={disabled}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NON_TERMINAL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{getPmWorkflowStatusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <FieldLabel hint="Semantic type. Standard is the default; non-standard types surface as key dates on Calendar.">Type</FieldLabel>
            <Select value={phaseType} onValueChange={(v) => setPhaseType(v as SemanticType)} disabled={disabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEMANTIC_TYPE_VALUES.map((t) => <SelectItem key={t} value={t}>{semanticTypeLabel(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel hint="Planned start date. Must fit inside the project window — you'll be asked to confirm if extending the project is required.">Start date</FieldLabel>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={disabled} />
          </div>
          <div>
            <FieldLabel hint="Planned end date. Variance is computed against the approved baseline.">Target end date</FieldLabel>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={disabled} />
          </div>
        </div>
        {canEdit && !planLocked && (
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={!dirty || saving || updatePhase.isPending}>
              {saving || updatePhase.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </div>

      {pendingExt && (
        <ParentExtensionConfirmDialog
          open={!!pendingExt}
          parentKind="project"
          parentName={pendingExt.parentName}
          currentStart={pendingExt.currentStart}
          currentEnd={pendingExt.currentEnd}
          proposedStart={pendingExt.proposedStart}
          proposedEnd={pendingExt.proposedEnd}
          pending={saving}
          onConfirm={handleConfirmExtension}
          onCancel={() => setPendingExt(null)}
        />
      )}
    </>
  );
}
