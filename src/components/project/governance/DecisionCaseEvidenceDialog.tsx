/**
 * DC.4 — Decision Case external evidence reference dialog.
 *
 * Creates or edits a `governance_record_evidence_references` row via
 * protected RPC. No direct table access.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  GOVERNANCE_EVIDENCE_RELEVANCE,
  GOVERNANCE_EVIDENCE_TYPES,
  useCreateGovernanceRecordEvidenceReference,
  useUpdateGovernanceRecordEvidenceReference,
  mapEvidenceMutationError,
  type GovernanceEvidenceRelevanceLevel,
  type GovernanceEvidenceType,
  type GovernanceRecordEvidenceReference,
} from "@/hooks/useGovernanceEvidenceReferences";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";

const NO_OWNER = "__none__";

const HINTS: Partial<Record<GovernanceEvidenceType, string>> = {
  onenote_page: "Use Copy link to page.",
  sharepoint_file: "Use Copy link to the specific file.",
  outlook_reference:
    "Use a stable message, meeting, recap, or saved evidence link where available.",
  teams_reference:
    "Use a stable message, meeting, recap, or saved evidence link where available.",
};

export function DecisionCaseEvidenceDialog({
  open,
  onOpenChange,
  recordId,
  projectId,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  recordId: string;
  projectId: string;
  existing?: GovernanceRecordEvidenceReference | null;
}) {
  const create = useCreateGovernanceRecordEvidenceReference(recordId);
  const update = useUpdateGovernanceRecordEvidenceReference(recordId);
  const { data: stakeholders = [] } = useProjectStakeholders(projectId);
  const activeStakeholders = stakeholders.filter((s) => !s.removed_at);

  const isEdit = !!existing;

  const [evidenceType, setEvidenceType] =
    useState<GovernanceEvidenceType>("sharepoint_file");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [evidenceDate, setEvidenceDate] = useState("");
  const [ownerId, setOwnerId] = useState<string>(NO_OWNER);
  const [relevance, setRelevance] =
    useState<GovernanceEvidenceRelevanceLevel>("medium");
  const [included, setIncluded] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setEvidenceType(
        (existing.evidence_type as GovernanceEvidenceType) ?? "sharepoint_file",
      );
      setTitle(existing.title ?? "");
      setUrl(existing.external_url ?? "");
      setSummary(existing.summary ?? "");
      setEvidenceDate(existing.evidence_date ?? "");
      setOwnerId(existing.owner_stakeholder_id ?? NO_OWNER);
      setRelevance(
        (existing.relevance_level as GovernanceEvidenceRelevanceLevel) ?? "medium",
      );
      setIncluded(!!existing.included_in_package);
    } else {
      setEvidenceType("sharepoint_file");
      setTitle("");
      setUrl("");
      setSummary("");
      setEvidenceDate("");
      setOwnerId(NO_OWNER);
      setRelevance("medium");
      setIncluded(true);
    }
  }, [open, existing]);

  const submitting = create.isPending || update.isPending;

  const handleSubmit = async () => {
    const t = title.trim();
    const u = url.trim();
    if (!t) return toast.error("Title is required.");
    if (!u) return toast.error("Source URL is required.");
    if (!/^https?:\/\//i.test(u)) {
      return toast.error("Source URL must start with http:// or https://.");
    }
    const ownerValue = ownerId === NO_OWNER ? null : ownerId;
    const sumTrim = summary.trim();
    try {
      if (isEdit && existing) {
        await update.mutateAsync({
          evidence_id: existing.id,
          evidence_type: evidenceType,
          title: t,
          external_url: u,
          summary: sumTrim ? sumTrim : undefined,
          clear_summary: !sumTrim,
          evidence_date: evidenceDate || undefined,
          clear_evidence_date: !evidenceDate,
          owner_stakeholder_id: ownerValue ?? undefined,
          clear_owner_stakeholder_id: ownerValue === null,
          relevance_level: relevance,
          included_in_package: included,
        });
        toast.success("Evidence reference updated.");
      } else {
        await create.mutateAsync({
          evidence_type: evidenceType,
          title: t,
          external_url: u,
          summary: sumTrim ? sumTrim : null,
          evidence_date: evidenceDate || null,
          owner_stakeholder_id: ownerValue,
          relevance_level: relevance,
          included_in_package: included,
        });
        toast.success("Evidence reference added.");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(mapEvidenceMutationError(e, "Could not save evidence reference."));
    }
  };

  const hint = HINTS[evidenceType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit evidence reference" : "Add evidence reference"}
          </DialogTitle>
          <DialogDescription>
            BTPM stores a controlled link only. The source content stays in its
            original system and follows that system's permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid gap-1.5">
            <Label>Evidence type</Label>
            <Select
              value={evidenceType}
              onValueChange={(v) => setEvidenceType(v as GovernanceEvidenceType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOVERNANCE_EVIDENCE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ev-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ev-url">
              Source URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ev-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ev-summary">Summary</Label>
            <Textarea
              id="ev-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ev-date">Evidence date</Label>
              <Input
                id="ev-date"
                type="date"
                value={evidenceDate}
                onChange={(e) => setEvidenceDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Relevance</Label>
              <Select
                value={relevance}
                onValueChange={(v) =>
                  setRelevance(v as GovernanceEvidenceRelevanceLevel)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_EVIDENCE_RELEVANCE.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Owner stakeholder</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OWNER}>Unassigned</SelectItem>
                {activeStakeholders.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={included}
              onCheckedChange={(v) => setIncluded(v === true)}
            />
            Include in stakeholder package
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Add evidence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
