/**
 * DC.15a — Edit metadata for a selected SharePoint evidence file.
 *
 * Only editable metadata can be changed here. Immutable SharePoint
 * reference fields (site_id, drive_id, item_id, item_reference_hash,
 * file_name, mime_type, size_bytes, etag/ctag, SharePoint timestamps,
 * SharePoint URL) are read-only and updates go through the protected
 * `update_governance_record_evidence_file` RPC.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  mapEvidenceFileError,
  useUpdateGovernanceRecordEvidenceFile,
  type EvidenceFileRelevance,
  type GovernanceRecordEvidenceFile,
} from "@/hooks/useGovernanceEvidenceFiles";

const RELEVANCE: EvidenceFileRelevance[] = ["high", "medium", "low"];

function formatBytes(n: number | null | undefined): string {
  if (typeof n !== "number") return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function DecisionCaseEvidenceFileDialog({
  open,
  onOpenChange,
  recordId,
  evidenceFile,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  recordId: string;
  evidenceFile: GovernanceRecordEvidenceFile | null;
}) {
  const update = useUpdateGovernanceRecordEvidenceFile(recordId);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [evidenceDate, setEvidenceDate] = useState("");
  const [relevance, setRelevance] = useState<EvidenceFileRelevance>("medium");
  const [includedInPackage, setIncludedInPackage] = useState(true);

  useEffect(() => {
    if (!open || !evidenceFile) return;
    setTitle(evidenceFile.evidence_title ?? "");
    setSummary(evidenceFile.evidence_summary ?? "");
    setEvidenceDate(evidenceFile.evidence_date ?? "");
    const rel = (evidenceFile.relevance_level as EvidenceFileRelevance) ?? "medium";
    setRelevance(RELEVANCE.includes(rel) ? rel : "medium");
    setIncludedInPackage(!!evidenceFile.included_in_package);
  }, [open, evidenceFile]);

  if (!evidenceFile) return null;

  const titleTrim = title.trim();
  const canSave = titleTrim.length > 0 && !update.isPending;

  const onSave = async () => {
    if (!canSave) return;
    try {
      const summaryTrim = summary.trim();
      await update.mutateAsync({
        evidence_file_id: evidenceFile.id,
        evidence_title: titleTrim,
        evidence_summary: summaryTrim.length > 0 ? summaryTrim : null,
        clear_evidence_summary: summaryTrim.length === 0,
        evidence_date: evidenceDate ? evidenceDate : null,
        relevance_level: relevance,
        included_in_package: includedInPackage,
      });
      toast.success("Evidence file updated.");
      onOpenChange(false);
    } catch (e) {
      toast.error(mapEvidenceFileError(e, "Could not update evidence file."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit evidence file</DialogTitle>
          <DialogDescription>
            Update how this SharePoint file appears in the Decision Case.
            SharePoint reference fields are managed by the system.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{evidenceFile.file_name}</span>
              <Badge variant="outline">{evidenceFile.source_system}</Badge>
            </div>
            <div className="text-xs text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1">
              <span>Size: {formatBytes(evidenceFile.size_bytes)}</span>
              <span>SP modified: {formatDate(evidenceFile.sharepoint_last_modified_at)}</span>
            </div>
            {evidenceFile.sharepoint_web_url && (
              <a
                href={evidenceFile.sharepoint_web_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3 mr-1" /> Open in SharePoint
              </a>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ef-title">Evidence title *</Label>
            <Input
              id="ef-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ef-summary">Summary</Label>
            <Textarea
              id="ef-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Why this file is relevant evidence for the decision."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ef-date">Evidence date</Label>
              <Input
                id="ef-date"
                type="date"
                value={evidenceDate}
                onChange={(e) => setEvidenceDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Relevance</Label>
              <Select
                value={relevance}
                onValueChange={(v) => setRelevance(v as EvidenceFileRelevance)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELEVANCE.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="min-w-0 pr-3">
              <div className="text-sm font-medium">Include in Case Package</div>
              <p className="text-xs text-muted-foreground">
                When enabled, this file is sent to the AI Decision Brief
                generation and included in the optional Case Package export.
              </p>
            </div>
            <Switch
              checked={includedInPackage}
              onCheckedChange={(v) => setIncludedInPackage(!!v)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!canSave}>
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
