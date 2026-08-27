/**
 * DC.2 — Lightweight Create Decision Case dialog.
 *
 * Initiates a Governance Decision Case (record_kind='decision_case',
 * decision_stage='initiated') via the existing protected create_governance_record
 * RPC. This is NOT the full Decision Case workspace — only initiation.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GOVERNANCE_EVENT_TYPES,
  useCreateGovernanceRecord,
  type GovernanceEventType,
} from "@/hooks/useProjectGovernance";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated?: (recordId: string) => void;
}

const NO_OWNER = "__none__";

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CreateDecisionCaseDialog({ open, onOpenChange, projectId, onCreated }: Props) {
  const { data: stakeholders = [] } = useProjectStakeholders(projectId);
  const create = useCreateGovernanceRecord(projectId);

  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [ownerId, setOwnerId] = useState<string>(NO_OWNER);
  const [targetDate, setTargetDate] = useState<string>("");
  const [eventType, setEventType] = useState<GovernanceEventType>("steerco");
  const [summary, setSummary] = useState("");
  const [initiationDate, setInitiationDate] = useState<string>(todayIso());

  useEffect(() => {
    if (open) {
      setTitle("");
      setQuestion("");
      setOwnerId(NO_OWNER);
      setTargetDate("");
      setEventType("steerco");
      setSummary("");
      setInitiationDate(todayIso());
    }
  }, [open]);

  const activeStakeholders = useMemo(
    () => stakeholders.filter((s) => !s.removed_at),
    [stakeholders],
  );

  const submitting = create.isPending;

  const handleSave = async () => {
    const t = title.trim();
    const q = question.trim();
    if (!t) {
      toast.error("Case title is required.");
      return;
    }
    if (!q) {
      toast.error("Decision question is required.");
      return;
    }
    if (!initiationDate) {
      toast.error("Initiation date is required.");
      return;
    }
    try {
      const id = await create.mutateAsync({
        event_type: eventType,
        event_name: t,
        actual_date_held: initiationDate,
        summary: summary.trim() ? summary.trim() : null,
        record_kind: "decision_case",
        decision_stage: "initiated",
        decision_question: q,
        decision_owner_stakeholder_id: ownerId === NO_OWNER ? null : ownerId,
        target_decision_date: targetDate || null,
      });
      toast.success("Decision case created.");
      onOpenChange(false);
      onCreated?.(id);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes("forbidden") || msg.includes("42501")) {
        toast.error("You do not have permission to create decision cases for this project.");
      } else if (msg.toLowerCase().includes("does not belong to this project")) {
        toast.error("Selected decision owner is not a stakeholder on this project.");
      } else {
        toast.error(msg || "Could not create decision case.");
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create decision case</DialogTitle>
          <DialogDescription>
            Initiate a governance decision case. You can flesh out evidence, brief, and
            stakeholder package later in the decision case workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="dc-title">Case title <span className="text-destructive">*</span></Label>
            <Input
              id="dc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Approve vendor selection for SAP integration"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="dc-question">Decision question <span className="text-destructive">*</span></Label>
            <Textarea
              id="dc-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What exactly must be decided?"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="dc-forum">Forum / event type</Label>
              <Select value={eventType} onValueChange={(v) => setEventType(v as GovernanceEventType)}>
                <SelectTrigger id="dc-forum"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_EVENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dc-owner">Decision owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="dc-owner"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>Unassigned</SelectItem>
                  {activeStakeholders.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="dc-init">Initiation date <span className="text-destructive">*</span></Label>
              <Input
                id="dc-init"
                type="date"
                value={initiationDate}
                onChange={(e) => setInitiationDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dc-target">Target decision date</Label>
              <Input
                id="dc-target"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="dc-summary">Background / short summary</Label>
            <Textarea
              id="dc-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Optional context for why this decision is needed."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? "Creating…" : "Create decision case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
