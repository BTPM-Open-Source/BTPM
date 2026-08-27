import { Badge } from "@/components/ui/badge";
import type { Tables } from "@/integrations/supabase/types";
import { ProjectStageBadge } from "@/components/project/ProjectStageBadge";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import {
  pmStatusLabel,
  pmStatusBadgeClass,
} from "@/lib/projectStatus";
import { getPmPriorityBadgeClass, getPmPriorityLabel } from "@/lib/btpmVisualSemantics";
import { LifecycleBadge } from "@/lib/lifecycleVocabulary";
import { projectDeliveryModelBadgeLabel, type ProjectDeliveryModel } from "@/lib/projectDeliveryModel";
import { CircleDot, Truck } from "lucide-react";

type Project = Tables<"projects"> & { programs: { name: string } | null };

/**
 * Wave 5 Step 5.9 — Project identity header.
 *
 * Renders Stage / Status / Lifecycle as visually distinct chips:
 *   - Stage   = delivery-phase concept (Layers icon, stage palette)
 *   - Status  = workflow state (CircleDot icon, status palette)
 *   - Active/Archived lifecycle (neutral outline)
 *
 * Health and Schedule are rendered separately in `ProjectReportingPanel`
 * (Wave B.3, fed by the canonical B.2 RPC) and intentionally not duplicated
 * here so the five axes — Stage, Status, Lifecycle, Health, Schedule — stay
 * visually distinct.
 */
export function ProjectIdentityHeader({
  project,
  workspaceName,
  compact = false,
}: {
  project: Project;
  workspaceName: string;
  /** When true, hides name/workspace/dates and renders only the chips row.
   *  Used on Overview where the project shell already shows identity. */
  compact?: boolean;
}) {
  const { canEdit } = useProjectPlanningAuthority(project.id);
  const isArchived = (project as any).is_archived ?? false;
  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{workspaceName}</span>
          {project.programs?.name && (
            <>
              <span>/</span>
              <span>{project.programs.name}</span>
            </>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        {!compact && <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>}
        <ProjectStageBadge
          projectId={project.id}
          currentStage={(project as any).project_stage}
          canEdit={canEdit}
        />
        <Badge className={`gap-1 ${pmStatusBadgeClass(project.status)}`}>
          <CircleDot className="h-3 w-3" />
          Status: {pmStatusLabel(project.status)}
        </Badge>
        <Badge className={`gap-1 ${getPmPriorityBadgeClass(project.priority)}`}>Priority: {getPmPriorityLabel(project.priority)}</Badge>
        <Badge variant="outline" className="gap-1">
          <Truck className="h-3 w-3" />
          {projectDeliveryModelBadgeLabel((project as any).delivery_model as ProjectDeliveryModel | null)}
        </Badge>
        {(project as any).portfolio_item_id && (
          <Badge variant="outline" className="gap-1">
            Portfolio:{" "}
            {(project as any).portfolio_code
              ? `${(project as any).portfolio_code} — ${(project as any).portfolio_name ?? ""}`
              : ((project as any).portfolio_name ?? "")}
            {(project as any).portfolio_is_archived ? " (archived)" : ""}
          </Badge>
        )}
        <LifecycleBadge kind="business" isArchived={isArchived} />
      </div>
      {!compact && (project.start_date || project.target_end_date) && (
        <p className="text-sm text-muted-foreground">
          {project.start_date && <span>Start: {project.start_date}</span>}
          {project.start_date && project.target_end_date && <span> · </span>}
          {project.target_end_date && <span>Target end: {project.target_end_date}</span>}
        </p>
      )}
    </div>
  );
}
