import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  GOVERNANCE_EVENT_TYPES,
  GOVERNANCE_FREQUENCIES,
  type GovernanceCadenceRow,
  type GovernanceEventType,
  type GovernanceFrequency,
  useCreateGovernanceCadence,
  useUpdateGovernanceCadence,
} from "@/hooks/useProjectGovernance";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { KC_SLUGS } from "@/components/knowledge/kc-concepts";

type Mode = "create" | "edit";

export function CadenceFormDialog({
  open,
  onOpenChange,
  projectId,
  cadence,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  cadence?: GovernanceCadenceRow | null;
}) {
  const mode: Mode = cadence ? "edit" : "create";
  const create = useCreateGovernanceCadence(projectId);
  const update = useUpdateGovernanceCadence(projectId);
  const { data: stakeholders } = useProjectStakeholders(projectId);

  const [eventType, setEventType] = useState<GovernanceEventType>("steerco");
  const [frequency, setFrequency] = useState<GovernanceFrequency>("biweekly");
  const [eventName, setEventName] = useState("");
  const [ownerStakeholderId, setOwnerStakeholderId] = useState<string>("");
  const [nextDate, setNextDate] = useState<string>("");
  const [evidenceType, setEvidenceType] = useState<string>("");

  // Reset on open / cadence change
  useEffect(() => {
    if (!open) return;
    if (cadence) {
      setEventType((cadence.event_type as GovernanceEventType) ?? "steerco");
      setFrequency((cadence.frequency_type as GovernanceFrequency) ?? "biweekly");
      setEventName(cadence.event_name ?? "");
      setOwnerStakeholderId(cadence.owner_stakeholder_id ?? "");
      setNextDate(cadence.next_expected_date ?? "");
      setEvidenceType(cadence.expected_evidence_type ?? "");
    } else {
      setEventType("steerco");
      setFrequency("biweekly");
      setEventName("");
      setOwnerStakeholderId("");
      setNextDate("");
      setEvidenceType("");
    }
  }, [open, cadence]);

  const isCustom = eventType === "custom";
  const isAdHoc = frequency === "ad_hoc";

  const ownerOptions = useMemo(
    () =>
      (stakeholders ?? [])
        .filter((s) => !s.removed_at)
        .map((s) => ({
          id: s.id,
          label: s.display_name || s.external_name || "Unnamed",
          type: s.stakeholder_type,
          role: s.role_label,
        })),
    [stakeholders],
  );

  const validate = (): string | null => {
    if (isCustom && !eventName.trim()) return "Event name is required for Custom event type.";
    if (!isAdHoc && !nextDate) return "Next expected date is required for recurring frequencies.";
    return null;
  };

  const submitting = create.isPending || update.isPending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    try {
      if (mode === "create") {
        await create.mutateAsync({
          event_type: eventType,
          frequency_type: frequency,
          event_name: eventName.trim() || null,
          owner_stakeholder_id: ownerStakeholderId || null,
          next_expected_date: isAdHoc ? null : nextDate,
          expected_evidence_type: evidenceType.trim() || null,
        });
        toast.success("Governance cadence created.");
      } else if (cadence) {
        await update.mutateAsync({
          cadence_id: cadence.id,
          event_type: eventType,
          frequency_type: frequency,
          event_name: eventName.trim() || null,
          owner_stakeholder_id: ownerStakeholderId || null,
          next_expected_date: isAdHoc ? null : nextDate,
          expected_evidence_type: evidenceType.trim() || null,
          clear_event_name: !eventName.trim() && !!cadence.event_name,
          clear_owner_stakeholder: !ownerStakeholderId && !!cadence.owner_stakeholder_id,
          clear_owner: !ownerStakeholderId && !!cadence.owner_id,
          clear_next_expected_date: isAdHoc && !!cadence.next_expected_date,
          clear_expected_evidence_type: !evidenceType.trim() && !!cadence.expected_evidence_type,
        });
        toast.success("Governance cadence updated.");
      }
      onOpenChange(false);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes("forbidden") || msg.includes("42501")) {
        toast.error("You do not have permission to manage governance cadences for this project.");
      } else {
        toast.error(msg || "Could not save cadence.");
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create governance cadence" : "Edit governance cadence"}</DialogTitle>
          <DialogDescription>
            Plan an expected governance rhythm. Evidence that the meeting actually happened will be captured separately.
          </DialogDescription>
          <div className="pt-1">
            <KnowledgeLink slug={KC_SLUGS.howToSetUpGovernanceCadence} label="How cadence works" />
          </div>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <FieldLabel>Event type</FieldLabel>
            <Select value={eventType} onValueChange={(v) => setEventType(v as GovernanceEventType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GOVERNANCE_EVENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <FieldLabel>Display name {isCustom ? <span className="text-destructive">*</span> : <span className="text-muted-foreground text-xs">(optional)</span>}</FieldLabel>
            <Input
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder={isCustom ? "e.g. Quarterly Sponsor Review" : "Optional custom label"}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Frequency</FieldLabel>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as GovernanceFrequency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_FREQUENCIES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <FieldLabel>Next expected date {!isAdHoc && <span className="text-destructive">*</span>}</FieldLabel>
              <Input
                type="date"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
                disabled={isAdHoc}
              />
              {isAdHoc && (
                <p className="text-xs text-muted-foreground mt-1">Ad hoc cadences do not auto-advance.</p>
              )}
            </div>
          </div>

          <div>
            <FieldLabel>Owner <span className="text-muted-foreground text-xs">(optional, from project stakeholders)</span></FieldLabel>
            <Select value={ownerStakeholderId || "__none__"} onValueChange={(v) => setOwnerStakeholderId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {ownerOptions.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                    {m.type === "external" ? " (External)" : ""}
                    {m.role ? ` · ${m.role}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ownerOptions.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Add stakeholders on the project Overview tab to enable owner selection.
              </p>
            )}
          </div>

          <div>
            <FieldLabel>Expected evidence type <span className="text-muted-foreground text-xs">(optional)</span></FieldLabel>
            <Input
              value={evidenceType}
              onChange={(e) => setEvidenceType(e.target.value)}
              placeholder="MoM, SteerCo deck, approval note, decision log"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : mode === "create" ? "Create cadence" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
