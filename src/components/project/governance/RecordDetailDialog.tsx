/**
 * GT.4 — Read-only Governance Record detail view.
 * Decisions and links are loaded from the protected detail RPC.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Link2 } from "lucide-react";
import {
  GOVERNANCE_LINK_TYPES,
  eventTypeLabel,
  useGovernanceRecordDetail,
} from "@/hooks/useProjectGovernance";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { KC_SLUGS } from "@/components/knowledge/kc-concepts";

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString();
  } catch { return d; }
}

export function RecordDetailDialog({
  open,
  onOpenChange,
  recordId,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordId: string | null;
  onEdit?: () => void;
}) {
  const { data, isLoading, error } = useGovernanceRecordDetail(recordId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Governance record</DialogTitle>
          <DialogDescription>Evidence that governance happened.</DialogDescription>
          <div className="pt-1">
            <KnowledgeLink slug={KC_SLUGS.governanceCadenceVsRecord} label="Cadence vs record" />
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-20" /></div>
        ) : error ? (
          <p className="text-sm text-destructive">Could not load record.</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">No record.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="font-medium text-base">
                {data.event_name?.trim() || eventTypeLabel(data.event_type)}
              </span>
              {data.event_name?.trim() && (
                <span className="text-xs text-muted-foreground">· {eventTypeLabel(data.event_type)}</span>
              )}
              {data.archived_at && <Badge variant="outline">Archived</Badge>}
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <span className="text-muted-foreground">Actual date held</span>
              <span className="tabular-nums">{fmt(data.actual_date_held)}</span>
              <span className="text-muted-foreground">Expected date snapshot</span>
              <span className="tabular-nums">{fmt(data.expected_date_snapshot)}</span>
              <span className="text-muted-foreground">Cadence</span>
              <span>
                {data.cadence_id
                  ? (data.cadence_event_name?.trim() ||
                      (data.cadence_event_type ? eventTypeLabel(data.cadence_event_type) : "Cadence"))
                  : "Ad hoc"}
              </span>
            </div>

            {data.summary && (
              <Section title="Summary"><p className="whitespace-pre-wrap">{data.summary}</p></Section>
            )}
            {data.decisions_summary && (
              <Section title="Decisions summary"><p className="whitespace-pre-wrap">{data.decisions_summary}</p></Section>
            )}

            <Section title={`Decisions (${data.decisions?.length ?? 0})`}>
              {(!data.decisions || data.decisions.length === 0) ? (
                <p className="text-muted-foreground text-xs">No structured decisions.</p>
              ) : (
                <ul className="space-y-2">
                  {data.decisions.map((d) => (
                    <li key={d.id} className="rounded border p-2">
                      <div className="whitespace-pre-wrap">{d.decision_text}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {d.target_date ? `Target: ${fmt(d.target_date)}` : "No target date"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`Linked objects (${data.links?.length ?? 0})`}>
              {(!data.links || data.links.length === 0) ? (
                <p className="text-muted-foreground text-xs">No linked objects.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {data.links.map((l) => (
                    <Badge key={l.id} variant="outline">
                      {GOVERNANCE_LINK_TYPES.find((t) => t.value === l.linked_object_type)?.label
                        ?? l.linked_object_type}
                    </Badge>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Evidence">
              {data.sharepoint_evidence_reference ? (
                <a href={data.sharepoint_evidence_reference} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">
                  <Link2 className="h-3 w-3" /> SharePoint evidence <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <p className="text-muted-foreground text-xs">No SharePoint evidence attached.</p>
              )}
              {data.external_reference_url && (
                <div className="mt-1">
                  <a href={data.external_reference_url} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1 text-xs">
                    Outlook / Teams reference <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </Section>
          </div>
        )}

        <DialogFooter>
          {onEdit && data && !data.archived_at && (
            <Button type="button" variant="outline" onClick={onEdit}>Edit</Button>
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      {children}
    </div>
  );
}
