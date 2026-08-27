import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldLabel } from "@/components/ui/field-label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateSprint, useUpdateSprint } from "@/hooks/useAgileMutations";
import { useToast } from "@/hooks/use-toast";

const sprintStatuses = ["planning", "active", "completed", "cancelled"];

interface SprintFormDialogProps {
  open: boolean;
  onClose: () => void;
  sprint?: any;
  projectId: string;
  workspaceId: string;
  organizationId: string;
  existingCount?: number;
}

export function SprintFormDialog({
  open,
  onClose,
  sprint,
  projectId,
  workspaceId,
  organizationId,
  existingCount = 0,
}: SprintFormDialogProps) {
  const isEdit = !!sprint;
  const { toast } = useToast();
  const create = useCreateSprint();
  const update = useUpdateSprint();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState("planning");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (open) {
      setName(sprint?.name || "");
      setGoal(sprint?.goal || "");
      setStatus(sprint?.status || "planning");
      setStartDate(sprint?.start_date || "");
      setEndDate(sprint?.end_date || "");
    }
  }, [open, sprint]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: sprint.id,
          project_id: projectId,
          expected_updated_at: sprint.updated_at,
          name: name.trim(),
          goal: goal.trim() || null,
          status,
          start_date: startDate || null,
          end_date: endDate || null,
        });
        toast({ title: "Sprint updated" });
      } else {
        await create.mutateAsync({
          name: name.trim(),
          goal: goal.trim() || null,
          status,
          start_date: startDate || null,
          end_date: endDate || null,
          project_id: projectId,
        });
        toast({ title: "Sprint created" });
      }

      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Sprint" : "New Sprint"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <FieldLabel hint="Sprint name (e.g. 'Sprint 1', 'Q2 W3'). Used across the board and reports." required>
              Name
            </FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sprint 1" />
          </div>
          <div>
            <FieldLabel hint="What outcome should this sprint deliver? Helps the team focus during planning and review.">
              Goal
            </FieldLabel>
            <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="What should this sprint achieve?" />
          </div>
          <div>
            <FieldLabel hint="Lifecycle state of the sprint: planning → active → completed / cancelled.">
              Status
            </FieldLabel>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sprintStatuses.map((s) => (
                  <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel hint="First day of this sprint.">
                Start date
              </FieldLabel>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel hint="Last day of this sprint. Used to compute sprint length and burndown.">
                End date
              </FieldLabel>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
