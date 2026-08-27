import { useState } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreatePhase, useUpdatePhase } from "@/hooks/useProjectPlanning";
import { useToast } from "@/hooks/use-toast";
import { Constants, type Enums } from "@/integrations/supabase/types";
import { mapDependencyError } from "@/lib/dependencyConflictEngine";
import { SEMANTIC_TYPE_VALUES, semanticTypeLabel, type SemanticType } from "@/lib/phaseTypes";
import {
  applyPhasePlanningChange,
  applyProjectPlanningChange,
  describeBlockedReason,
  previewPhasePlanningChange,
} from "@/lib/planningService";
import { ParentExtensionConfirmDialog } from "./ParentExtensionConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { DATE_RANGE_ERROR_MESSAGE, isInvalidDateRange } from "@/lib/dateRangeValidation";

const statuses = Constants.public.Enums.pm_status;

interface PhaseFormDialogProps {
  open: boolean;
  onClose: () => void;
  phase?: Tables<"phases">;
  allPhases?: Tables<"phases">[];
  projectId?: string;
  workspaceId?: string;
  organizationId?: string;
  existingPhaseCount?: number;
  /** When set, the new phase is inserted immediately after the phase with this sort_order. */
  insertAfterSortOrder?: number;
}

interface PendingExtension {
  kind: "project";
  parentName: string;
  currentStart: string | null;
  currentEnd: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  /** Closure that performs the actual save once the user confirms. */
  run: () => Promise<void>;
}

export function PhaseFormDialog({
  open,
  onClose,
  phase,
  allPhases = [],
  projectId,
  workspaceId,
  organizationId,
  existingPhaseCount = 0,
  insertAfterSortOrder,
}: PhaseFormDialogProps) {
  const isEdit = !!phase;
  const { toast } = useToast();
  const createPhase = useCreatePhase();
  const updatePhase = useUpdatePhase();
  

  const [name, setName] = useState(phase?.name || "");
  const [description, setDescription] = useState(phase?.description || "");
  const [status, setStatus] = useState<Enums<"pm_status">>(phase?.status || "planned");
  const [phaseType, setPhaseType] = useState<SemanticType>(((phase as any)?.phase_type as SemanticType) || "work_item");
  const [startDate, setStartDate] = useState(phase?.start_date || "");
  const [endDate, setEndDate] = useState(phase?.target_end_date || "");

  const [pendingExt, setPendingExt] = useState<PendingExtension | null>(null);
  const [saving, setSaving] = useState(false);

  const resolvedProjectId = projectId ?? phase?.project_id;

  /** Save the non-date fields through the existing path. Used after planned-date apply. */
  async function saveNonDateFieldsForExisting() {
    if (!phase) return;
    await updatePhase.mutateAsync({
      id: phase.id,
      project_id: phase.project_id,
      name: name.trim(),
      description: description.trim() || null,
      status,
      phase_type: phaseType,
      // dates intentionally omitted — already saved via apply RPC
    } as any);
  }

  async function performEditSave() {
    if (!phase) return;
    const planStart = startDate || null;
    const planEnd   = endDate || null;
    const datesChanged = planStart !== (phase.start_date || null) || planEnd !== (phase.target_end_date || null);

    if (!datesChanged) {
      // No planned-date change — go through normal UPDATE for the rest.
      await updatePhase.mutateAsync({
        id: phase.id,
        project_id: phase.project_id,
        name: name.trim(),
        description: description.trim() || null,
        status,
        phase_type: phaseType,
        start_date: planStart,
        target_end_date: planEnd,
      } as any);
      toast({ title: "Phase updated" });
      onClose();
      return;
    }

    // Planned dates changed — preview first.
    const preview = await previewPhasePlanningChange(phase.id, planStart, planEnd);
    if (preview.blocked) {
      toast({ title: "Cannot save", description: describeBlockedReason(preview.blocked_reason), variant: "destructive" });
      return;
    }

    if (preview.requires_extension) {
      setPendingExt({
        kind: "project",
        parentName: preview.parent_project_name ?? "Project",
        currentStart: preview.parent_current_start,
        currentEnd:   preview.parent_current_end,
        proposedStart: preview.parent_proposed_start,
        proposedEnd:   preview.parent_proposed_end,
        run: async () => {
          await applyPhasePlanningChange(phase.id, planStart, planEnd, true);
          await saveNonDateFieldsForExisting();
          toast({ title: "Phase updated", description: "Project window extended to fit." });
          onClose();
        },
      });
      return;
    }

    await applyPhasePlanningChange(phase.id, planStart, planEnd, false);
    await saveNonDateFieldsForExisting();
    toast({ title: "Phase updated" });
    onClose();
  }

  async function performCreateSave() {
    if (!resolvedProjectId || !workspaceId || !organizationId) return;
    const useInsert = typeof insertAfterSortOrder === "number";
    const newSortOrder = useInsert ? insertAfterSortOrder! + 1 : existingPhaseCount;

    const planStart = startDate || null;
    const planEnd   = endDate || null;

    // Client-side preflight against the parent project window.
    const { data: prj } = await supabase
      .from("projects")
      .select("id,name,start_date,target_end_date")
      .eq("id", resolvedProjectId)
      .single();

    let needsExt = false;
    let propStart = prj?.start_date ?? null;
    let propEnd   = prj?.target_end_date ?? null;
    if (planStart && prj?.start_date && planStart < prj.start_date) {
      needsExt = true; propStart = planStart;
    }
    if (planEnd && prj?.target_end_date && planEnd > prj.target_end_date) {
      needsExt = true; propEnd = planEnd;
    }

    const doInsert = async () => {
      await createPhase.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        status,
        phase_type: phaseType,
        start_date: planStart,
        target_end_date: planEnd,
        project_id: resolvedProjectId,
        workspace_id: workspaceId,
        organization_id: organizationId,
        sort_order: newSortOrder,
      } as any);
    };

    if (needsExt && prj) {
      setPendingExt({
        kind: "project",
        parentName: prj.name,
        currentStart: prj.start_date,
        currentEnd:   prj.target_end_date,
        proposedStart: propStart,
        proposedEnd:   propEnd,
        run: async () => {
          // Widen the project window through the canonical apply RPC.
          await applyProjectPlanningChange(prj.id, propStart, propEnd);
          await doInsert();
          toast({ title: "Phase created", description: "Project window extended to fit." });
          onClose();
        },
      });
      return;
    }

    await doInsert();
    toast({ title: "Phase created" });
    onClose();
  }

  const handleSubmit = async () => {
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
      if (isEdit && phase) await performEditSave();
      else await performCreateSave();
    } catch (e: any) {
      toast({ title: "Error", description: mapDependencyError(e), variant: "destructive" });
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
      toast({ title: "Error", description: mapDependencyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Phase" : "New Phase"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <FieldLabel hint="Name of this phase (e.g. 'Discovery', 'Build', 'Cutover')." required>
                Name
              </FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Phase name" />
            </div>
            <div>
              <FieldLabel hint="Optional explanation of what this phase covers and what 'done' looks like.">
                Description
              </FieldLabel>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel hint="Lifecycle state of this phase: planned → active → on hold / completed / cancelled.">
                  Status
                </FieldLabel>
                <Select value={status} onValueChange={(v) => setStatus(v as Enums<"pm_status">)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel hint="Semantic type of this phase. Standard is the default; Milestone / Deliverable / Decision / Review surface as key dates on the Calendar.">
                  Type
                </FieldLabel>
                <Select value={phaseType} onValueChange={(v) => setPhaseType(v as SemanticType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEMANTIC_TYPE_VALUES.map((t) => (
                      <SelectItem key={t} value={t}>{semanticTypeLabel(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel hint="Current planned start date for this phase. Must fit inside the project window — you'll be asked to confirm if extending the project is required.">
                  Start date
                </FieldLabel>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <FieldLabel hint="Current planned end date for this phase. Variance is computed against the approved baseline.">
                  Target end date
                </FieldLabel>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || createPhase.isPending || updatePhase.isPending}>
              {isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingExt && (
        <ParentExtensionConfirmDialog
          open={!!pendingExt}
          parentKind={pendingExt.kind}
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
