import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Ban, Plus, CheckCircle, Pencil } from "lucide-react";
import { useBlockers } from "@/hooks/useExecutionData";
import { useUpdateBlocker } from "@/hooks/useProjectRisksBlockers";
import { useEntityLinks } from "@/hooks/useEntityLinks";
import { BlockerFormDialog } from "@/components/project/BlockerFormDialog";
import { ObjectLinkChip, PersonChip } from "@/components/links/LinkChips";
import type { Tables } from "@/integrations/supabase/types";

const severityColor: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-[#F59E0B]/10 text-[#F59E0B]",
  high: "bg-[#F97316]/10 text-[#F97316]",
  critical: "bg-destructive/10 text-destructive",
};

const statusColor: Record<string, string> = {
  open: "bg-destructive/10 text-destructive",
  in_progress: "bg-[#F59E0B]/10 text-[#F59E0B]",
  resolved: "bg-[#059669]/10 text-[#059669]",
};

interface Props {
  targetType: string;
  targetId: string;
  organizationId: string;
  workspaceId: string;
  /** Project id is required so blocker create can resolve to the right project context. */
  projectId: string;
  canEdit: boolean;
  membersMap: Record<string, string>;
}

export function BlockersSection({
  targetType,
  targetId,
  organizationId,
  workspaceId,
  projectId,
  canEdit,
  membersMap,
}: Props) {
  const { data: blockers = [], isLoading } = useBlockers(targetType, targetId);
  const updateBlocker = useUpdateBlocker();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tables<"blockers"> | null>(null);

  const blockerIds = blockers.map((b: Tables<"blockers">) => b.id);
  const { data: linksMap = {} } = useEntityLinks("blocker", blockerIds);

  const handleResolve = async (b: Tables<"blockers">) => {
    const entry = linksMap[b.id];
    const user_links = (entry?.people ?? []).map((p) =>
      p.stakeholder_id
        ? { stakeholder_id: p.stakeholder_id }
        : { user_id: p.user_id ?? undefined },
    );
    const object_links = (entry?.objects ?? []).map((o) => ({
      referenced_type: o.referenced_type,
      referenced_id: o.referenced_id,
    }));
    await updateBlocker.mutateAsync({
      id: b.id,
      expected_updated_at: b.updated_at,
      title: b.title,
      description: b.description ?? null,
      severity: b.severity,
      status: "resolved",
      user_links,
      object_links,
    });
  };

  const openBlockers = blockers.filter((b: Tables<"blockers">) => b.status !== "resolved");
  const resolvedBlockers = blockers.filter((b: Tables<"blockers">) => b.status === "resolved");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Ban className="h-4 w-4" /> Blockers
          {openBlockers.length > 0 && <Badge variant="destructive">{openBlockers.length} open</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && blockers.length === 0 && (
          <p className="text-sm text-muted-foreground">No blockers.</p>
        )}

        {openBlockers.map((b: Tables<"blockers">) => {
          const links = linksMap[b.id];
          return (
            <div key={b.id} className="border border-border rounded-md p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{b.title}</span>
                <div className="flex items-center gap-1">
                  <Badge className={severityColor[b.severity] || ""}>{b.severity}</Badge>
                  <Badge className={statusColor[b.status] || ""}>{b.status.replace("_", " ")}</Badge>
                </div>
              </div>
              {b.description && <p className="text-xs text-muted-foreground">{b.description}</p>}
              {(links?.people.length || links?.objects.length) ? (
                <div className="flex flex-wrap gap-1">
                  {links.people.map((p) => (
                    <PersonChip key={p.id} data={{ user_id: p.user_id, stakeholder_id: p.stakeholder_id, stakeholder_type: p.stakeholder_type, display_name: p.display_name }} />
                  ))}
                  {links.objects.map((o) => (
                    <ObjectLinkChip key={o.id} data={o} />
                  ))}
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Reported by {membersMap[b.reported_by || ""] || (b.reported_by?.slice(0, 8) ?? "—")}
                </span>
                {canEdit && b.status !== "resolved" && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEditing(b); setDialogOpen(true); }}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleResolve(b)} disabled={updateBlocker.isPending}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Resolve
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {resolvedBlockers.length > 0 && (
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">{resolvedBlockers.length} resolved</summary>
            <div className="mt-2 space-y-2">
              {resolvedBlockers.map((b: Tables<"blockers">) => (
                <div key={b.id} className="border border-border rounded-md p-2 opacity-60">
                  <div className="flex items-center justify-between">
                    <span className="text-sm line-through">{b.title}</span>
                    <Badge className={severityColor[b.severity] || ""}>{b.severity}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-3 w-3 mr-1" /> Add Blocker
          </Button>
        )}

        {dialogOpen && (
          <BlockerFormDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            blocker={editing}
            targetType={targetType}
            targetId={targetId}
            projectId={projectId}
            organizationId={organizationId}
            workspaceId={workspaceId}
          />
        )}
      </CardContent>
    </Card>
  );
}
