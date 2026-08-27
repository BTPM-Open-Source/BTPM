import { useState, useMemo } from "react";
import { useOutletContext, useParams, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Ban, Plus, ExternalLink } from "lucide-react";
import {
  useProjectAllRisks,
  useProjectAllBlockers,
  type ProjectBlockerRow,
  type ProjectRiskRow,
} from "@/hooks/useProjectRisksBlockers";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { RiskFormDialog } from "@/components/project/RiskFormDialog";
import { BlockerFormDialog } from "@/components/project/BlockerFormDialog";
import {
  riskStatusLabel,
  riskStatusBadgeClass,
  RISK_STATUS_VALUES,
  RISK_STATUS_LABELS,
} from "@/lib/riskLifecycle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEntityLinks } from "@/hooks/useEntityLinks";
import { ObjectLinkChip, PersonChip } from "@/components/links/LinkChips";
import type { OwnerLinksGroup } from "@/lib/entityLinks";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { KC_CONCEPTS } from "@/components/knowledge/kc-concepts";
import { useProjectAdoptionLinkBadges, type AdoptionLinkBadge as AdoptionLinkBadgeData } from "@/hooks/useProjectAdoptionLinkBadges";
import { AdoptionLinkBadge } from "@/components/adoption/AdoptionLinkBadge";

const impactColor: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  critical: "bg-destructive/10 text-destructive",
};

const severityColor = impactColor;

const blockerStatusColor: Record<string, string> = {
  open: "bg-destructive/10 text-destructive",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

interface SourceBadgeItem {
  target_type: string;
  target_id: string;
  source_name: string | null;
}

function SourceBadge({ item, workspaceId, projectId }: { item: SourceBadgeItem; workspaceId: string; projectId: string }) {
  const label = item.target_type === "project" ? "Project" : item.target_type === "phase" ? "Phase" : "Task";
  const variant: "default" | "outline" = item.target_type === "project" ? "default" : "outline";

  if (item.target_type === "project") {
    return <Badge variant={variant}>{label}</Badge>;
  }

  const detailPath = item.target_type === "phase"
    ? `/workspace/${workspaceId}/project/${projectId}/phase/${item.target_id}`
    : `/workspace/${workspaceId}/project/${projectId}/task/${item.target_id}`;

  return (
    <Link to={detailPath} className="inline-flex items-center gap-1 group">
      <Badge variant={variant} className="group-hover:bg-accent">
        {label}: {item.source_name || item.target_id?.slice(0, 8)}
        <ExternalLink className="h-3 w-3 ml-1" />
      </Badge>
    </Link>
  );
}

// Risk and Blocker dialogs are extracted to src/components/project/{Risk,Blocker}FormDialog.tsx

// Project context shape used by this page (subset of the project record).
interface ProjectContext {
  id: string;
  organization_id: string;
  workspace_id: string;
}

// --- Main Page ---
export default function ProjectRisksBlockers() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const { project } = useOutletContext<{ project: ProjectContext }>();

  const { canEdit } = useProjectPlanningAuthority(projectId);
  const { data: allRisks = [], isLoading: risksLoading, error: risksError } = useProjectAllRisks(projectId);
  const { data: allBlockers = [], isLoading: blockersLoading, error: blockersError } = useProjectAllBlockers(projectId);
  const accessDenied =
    (risksError && /forbidden|not authorized/i.test(String((risksError as Error).message ?? ""))) ||
    (blockersError && /forbidden|not authorized/i.test(String((blockersError as Error).message ?? "")));

  const [riskDialogOpen, setRiskDialogOpen] = useState(false);
  const [editingRisk, setEditingRisk] = useState<ProjectRiskRow | null>(null);
  const [blockerDialogOpen, setBlockerDialogOpen] = useState(false);
  const [editingBlocker, setEditingBlocker] = useState<ProjectBlockerRow | null>(null);

  const [riskFilter, setRiskFilter] = useState<string>("active");

  const projectRisks = allRisks.filter((r) => r.target_type === "project");
  const relatedRisks = allRisks.filter((r) => r.target_type !== "project");
  const projectBlockers = allBlockers.filter((b) => b.target_type === "project");
  const relatedBlockers = allBlockers.filter((b) => b.target_type !== "project");

  const riskIds = allRisks.map((r) => r.id);
  const blockerIds = allBlockers.map((b) => b.id);
  const { data: riskLinksMap = {} } = useEntityLinks("risk", riskIds);
  const { data: blockerLinksMap = {} } = useEntityLinks("blocker", blockerIds);
  const adoptionBadges = useProjectAdoptionLinkBadges(projectId);

  const openProjectRisks = useMemo(() => {
    const open = projectRisks.filter((r) => r.status !== "closed");
    if (riskFilter === "all" || riskFilter === "active") return open;
    return open.filter((r) => {
      // Map legacy values for filter compatibility
      if (riskFilter === "open") return r.status === "open" || r.status === "identified";
      if (riskFilter === "under_mitigation") return r.status === "under_mitigation" || r.status === "mitigating";
      if (riskFilter === "monitoring") return r.status === "monitoring" || r.status === "accepted";
      return r.status === riskFilter;
    });
  }, [projectRisks, riskFilter]);
  const closedProjectRisks = projectRisks.filter((r) => r.status === "closed");
  const openProjectBlockers = projectBlockers.filter((b) => b.status !== "resolved");
  const resolvedProjectBlockers = projectBlockers.filter((b) => b.status === "resolved");

  const handleEditRisk = (risk: ProjectRiskRow) => {
    setEditingRisk(risk);
    setRiskDialogOpen(true);
  };

  const handleEditBlocker = (blocker: ProjectBlockerRow) => {
    setEditingBlocker(blocker);
    setBlockerDialogOpen(true);
  };

  const handleNewRisk = () => {
    setEditingRisk(null);
    setRiskDialogOpen(true);
  };

  const handleNewBlocker = () => {
    setEditingBlocker(null);
    setBlockerDialogOpen(true);
  };

  if (accessDenied) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        You don't have access to read risks and blockers for this project. Ask a workspace admin to grant you access.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-end gap-3">
        <ConceptHelp
          term={KC_CONCEPTS.riskVsBlocker.term}
          shortText={KC_CONCEPTS.riskVsBlocker.shortText}
          articleSlug={KC_CONCEPTS.riskVsBlocker.slug}
        />
        <KnowledgeLink slug="how-to-manage-risks-and-blockers" label="How to manage" />
      </div>

      {/* ===== PROJECT RISKS ===== */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> Project Risks
            {openProjectRisks.length > 0 && (
              <Badge variant="secondary">{openProjectRisks.length} open</Badge>
            )}
          </h2>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={handleNewRisk}>
              <Plus className="h-3 w-3 mr-1" /> Add Risk
            </Button>
          )}
        </div>

        {/* Wave 5 Step 5.9 — Risk lifecycle filter */}
        <div className="mb-3">
          <ToggleGroup
            type="single"
            size="sm"
            value={riskFilter}
            onValueChange={(v) => v && setRiskFilter(v)}
            className="justify-start flex-wrap"
          >
            <ToggleGroupItem value="active" className="text-xs h-7">Active</ToggleGroupItem>
            {RISK_STATUS_VALUES.filter((s) => s !== "closed").map((s) => (
              <ToggleGroupItem key={s} value={s} className="text-xs h-7">
                {RISK_STATUS_LABELS[s]}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value="all" className="text-xs h-7">All open</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {risksLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : openProjectRisks.length === 0 && closedProjectRisks.length === 0 ? (
          <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">No project-level risks recorded.</p></CardContent></Card>
        ) : (
          <div className="space-y-2">
            {openProjectRisks.map((risk) => (
              <RiskCard key={risk.id} risk={risk} canEdit={canEdit} onEdit={() => handleEditRisk(risk)} links={riskLinksMap[risk.id]} adoptionBadge={adoptionBadges.byType.risk.get(risk.id) ?? null} />
            ))}
            {closedProjectRisks.length > 0 && (
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer py-1">{closedProjectRisks.length} closed</summary>
                <div className="mt-2 space-y-2">
                  {closedProjectRisks.map((risk) => (
                    <RiskCard key={risk.id} risk={risk} canEdit={canEdit} onEdit={() => handleEditRisk(risk)} links={riskLinksMap[risk.id]} adoptionBadge={adoptionBadges.byType.risk.get(risk.id) ?? null} closed />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* ===== PROJECT BLOCKERS ===== */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Ban className="h-5 w-5" /> Project Blockers
            {openProjectBlockers.length > 0 && (
              <Badge variant="destructive">{openProjectBlockers.length} open</Badge>
            )}
          </h2>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={handleNewBlocker}>
              <Plus className="h-3 w-3 mr-1" /> Add Blocker
            </Button>
          )}
        </div>

        {blockersLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : openProjectBlockers.length === 0 && resolvedProjectBlockers.length === 0 ? (
          <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">No project-level blockers recorded.</p></CardContent></Card>
        ) : (
          <div className="space-y-2">
            {openProjectBlockers.map((b) => (
              <BlockerCard key={b.id} blocker={b} canEdit={canEdit} onEdit={() => handleEditBlocker(b)} links={blockerLinksMap[b.id]} adoptionBadge={adoptionBadges.byType.blocker.get(b.id) ?? null} />
            ))}
            {resolvedProjectBlockers.length > 0 && (
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer py-1">{resolvedProjectBlockers.length} resolved</summary>
                <div className="mt-2 space-y-2">
                  {resolvedProjectBlockers.map((b) => (
                    <BlockerCard key={b.id} blocker={b} canEdit={false} onEdit={() => {}} links={blockerLinksMap[b.id]} adoptionBadge={adoptionBadges.byType.blocker.get(b.id) ?? null} resolved />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* ===== RELATED (phase/task) RISKS ===== */}
      {relatedRisks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Related Risks in this Project</h2>
          <p className="text-xs text-muted-foreground mb-2">Risks attached to phases and tasks within this project. Manage them from their source.</p>
          <div className="space-y-2">
            {relatedRisks.map((risk) => (
              <Card key={risk.id} className="opacity-80">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <SourceBadge item={risk} workspaceId={workspaceId!} projectId={projectId!} />
                      <span className="text-sm truncate">{risk.title}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge className={riskStatusBadgeClass(risk.status)}>{riskStatusLabel(risk.status)}</Badge>
                      <Badge className={impactColor[risk.impact] || ""}>{risk.impact}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ===== RELATED (phase/task) BLOCKERS ===== */}
      {relatedBlockers.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Related Blockers in this Project</h2>
          <p className="text-xs text-muted-foreground mb-2">Blockers attached to phases and tasks within this project. Manage them from their source.</p>
          <div className="space-y-2">
            {relatedBlockers.map((b) => (
              <Card key={b.id} className="opacity-80">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <SourceBadge item={b} workspaceId={workspaceId!} projectId={projectId!} />
                      <span className="text-sm truncate">{b.title}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge className={blockerStatusColor[b.status] || ""}>{b.status.replace("_", " ")}</Badge>
                      <Badge className={severityColor[b.severity] || ""}>{b.severity}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Dialogs */}
      {riskDialogOpen && (
        <RiskFormDialog
          open={riskDialogOpen}
          onOpenChange={setRiskDialogOpen}
          risk={editingRisk}
          projectId={projectId!}
          organizationId={project?.organization_id}
          workspaceId={project?.workspace_id}
        />
      )}
      {blockerDialogOpen && (
        <BlockerFormDialog
          open={blockerDialogOpen}
          onOpenChange={setBlockerDialogOpen}
          blocker={editingBlocker}
          projectId={projectId!}
          organizationId={project?.organization_id}
          workspaceId={project?.workspace_id}
        />
      )}
    </div>
  );
}

// --- Risk Card ---
function RiskCard({
  risk,
  canEdit,
  onEdit,
  closed,
  links,
  adoptionBadge,
}: {
  risk: ProjectRiskRow;
  canEdit: boolean;
  onEdit: () => void;
  closed?: boolean;
  links?: OwnerLinksGroup;
  adoptionBadge?: AdoptionLinkBadgeData | null;
}) {
  return (
    <Card className={closed ? "opacity-60" : ""}>
      <CardContent className="py-3 px-4 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium ${closed ? "line-through" : ""}`}>{risk.title}</span>
          <div className="flex items-center gap-1 shrink-0">
            {adoptionBadge && <AdoptionLinkBadge badge={adoptionBadge} />}
            <Badge className={riskStatusBadgeClass(risk.status)}>{riskStatusLabel(risk.status)}</Badge>
            <Badge className={impactColor[risk.impact] || ""}>{risk.impact}</Badge>
            <Badge variant="outline">{risk.likelihood}</Badge>
            {canEdit && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onEdit}>Edit</Button>
            )}
          </div>
        </div>
        {risk.description && <p className="text-xs text-muted-foreground">{risk.description}</p>}
        {risk.mitigation_plan && (
          <p className="text-xs text-muted-foreground"><span className="font-medium">Mitigation:</span> {risk.mitigation_plan}</p>
        )}
        {(links?.people.length || links?.objects.length) ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {links.people.map((p) => (
              <PersonChip key={p.id} data={{ user_id: p.user_id, stakeholder_id: p.stakeholder_id, stakeholder_type: p.stakeholder_type, display_name: p.display_name }} />
            ))}
            {links.objects.map((o) => (
              <ObjectLinkChip key={o.id} data={o} />
            ))}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Created {new Date(risk.created_at).toLocaleDateString()}
          {risk.updated_at !== risk.created_at && ` · Updated ${new Date(risk.updated_at).toLocaleDateString()}`}
        </p>
      </CardContent>
    </Card>
  );
}

// --- Blocker Card ---
function BlockerCard({
  blocker,
  canEdit,
  onEdit,
  resolved,
  links,
  adoptionBadge,
}: {
  blocker: ProjectBlockerRow;
  canEdit: boolean;
  onEdit: () => void;
  resolved?: boolean;
  links?: OwnerLinksGroup;
  adoptionBadge?: AdoptionLinkBadgeData | null;
}) {
  return (
    <Card className={resolved ? "opacity-60" : ""}>
      <CardContent className="py-3 px-4 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium ${resolved ? "line-through" : ""}`}>{blocker.title}</span>
          <div className="flex items-center gap-1 shrink-0">
            {adoptionBadge && <AdoptionLinkBadge badge={adoptionBadge} />}
            <Badge className={blockerStatusColor[blocker.status] || ""}>{blocker.status.replace("_", " ")}</Badge>
            <Badge className={severityColor[blocker.severity] || ""}>{blocker.severity}</Badge>
            {canEdit && !resolved && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onEdit}>Edit</Button>
            )}
          </div>
        </div>
        {blocker.description && <p className="text-xs text-muted-foreground">{blocker.description}</p>}
        {(links?.people.length || links?.objects.length) ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {links.people.map((p) => (
              <PersonChip key={p.id} data={{ user_id: p.user_id, stakeholder_id: p.stakeholder_id, stakeholder_type: p.stakeholder_type, display_name: p.display_name }} />
            ))}
            {links.objects.map((o) => (
              <ObjectLinkChip key={o.id} data={o} />
            ))}
          </div>
        ) : null}
        {blocker.resolved_at && (
          <p className="text-xs text-muted-foreground">Resolved {new Date(blocker.resolved_at).toLocaleDateString()}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Created {new Date(blocker.created_at).toLocaleDateString()}
          {blocker.updated_at !== blocker.created_at && ` · Updated ${new Date(blocker.updated_at).toLocaleDateString()}`}
        </p>
      </CardContent>
    </Card>
  );
}
