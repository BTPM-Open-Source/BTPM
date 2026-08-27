import { useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { useProjectRisks, useProjectTeam, useProjectKpis, useProjectBlockers } from "@/hooks/useProjectOverview";
import { ProjectIdentityHeader } from "@/components/project/ProjectIdentityHeader";
import { ProjectNarrativeSection } from "@/components/project/ProjectNarrativeSection";
import { ProjectCharterDetailsSection } from "@/components/project/ProjectCharterDetailsSection";
import { RiskSummarySection } from "@/components/project/RiskSummarySection";
import { BlockerSummarySection } from "@/components/project/BlockerSummarySection";
import { TeamSummarySection } from "@/components/project/TeamSummarySection";
import { KpiSummarySection } from "@/components/project/KpiSummarySection";
import { ProjectReportingPanel } from "@/components/project/ProjectReportingPanel";
import { ProjectBaselineCard } from "@/components/project/ProjectBaselineCard";
import { DependencyPanel } from "@/components/dependencies/DependencyPanel";
import { useDependencyCandidates } from "@/hooks/useDependencyCandidates";
import { useProjectReportingSummaries } from "@/hooks/useProjectReportingSummaries";
import { useProjectAdoptionReportingSummaries } from "@/hooks/useProjectAdoptionReportingSummaries";
import { ProjectAdoptionSummaryCard } from "@/components/project/ProjectAdoptionSummaryCard";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { Button } from "@/components/ui/button";
import { Plus, Activity } from "lucide-react";
import { ProjectTraceabilitySheet } from "@/components/traceability/ProjectTraceabilitySheet";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import type { Tables } from "@/integrations/supabase/types";
import { RiskFormDialog } from "@/components/project/RiskFormDialog";
import { BlockerFormDialog } from "@/components/project/BlockerFormDialog";
import { AddTeamMemberDialog } from "@/components/project/AddTeamMemberDialog";
import { KpiDefinitionDialog } from "@/components/project/KpiDefinitionDialog";
import { ProjectCharterCard } from "@/components/project/ProjectCharterCard";
import { ProjectStatusDeckCard } from "@/components/project/ProjectStatusDeckCard";
import { ProjectLessonsLearnedCard } from "@/components/project/ProjectLessonsLearnedCard";
import { ProjectClosureReportCard } from "@/components/project/ProjectClosureReportCard";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KC_CONCEPTS } from "@/components/knowledge/kc-concepts";
import { ProjectOverviewGovernancePanel } from "@/components/project/governance/ProjectOverviewGovernancePanel";
import { ProjectOverviewSection } from "@/components/project/ProjectOverviewSection";
import { ProjectOverviewAttentionPanel } from "@/components/project/ProjectOverviewAttentionPanel";
import { ProjectOverviewQuickLinksCard } from "@/components/project/ProjectOverviewQuickLinksCard";
import { ProjectBenefitsSummaryCard } from "@/components/project/ProjectBenefitsSummaryCard";
import { ProjectClosureSummaryCard } from "@/components/project/ProjectClosureSummaryCard";

export default function ProjectOverviewTab() {
  const { project, workspace } = useOutletContext<{
    project: Tables<"projects">;
    workspace: { id: string; name: string } | undefined;
  }>();

  const { canEdit } = useProjectPlanningAuthority(project.id);

  const [riskOpen, setRiskOpen] = useState(false);
  const [blockerOpen, setBlockerOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [kpiOpen, setKpiOpen] = useState(false);
  const [traceabilityOpen, setTraceabilityOpen] = useState(false);

  const { data: risks = [], isLoading: risksLoading } = useProjectRisks(project.id, project.workspace_id);
  const { data: blockers = [], isLoading: blockersLoading } = useProjectBlockers(project.id);
  const { data: team = [], isLoading: teamLoading } = useProjectTeam(project.id);
  const { data: kpis = [], isLoading: kpisLoading } = useProjectKpis(project.id);
  const {
    data: reportingSummaries,
    isLoading: reportingLoading,
    isError: reportingError,
  } = useProjectReportingSummaries(project.workspace_id, [project.id]);
  const reportingSummary =
    reportingSummaries?.find((s) => s.project_id === project.id) ?? null;
  const {
    data: adoptionSummaries,
    isLoading: adoptionLoading,
    isError: adoptionError,
  } = useProjectAdoptionReportingSummaries(project.workspace_id, [project.id]);
  const adoptionSummary =
    adoptionSummaries?.find((s) => s.project_id === project.id) ?? null;
  const { data: projectCandidates = [] } = useDependencyCandidates("project", { workspaceId: project.workspace_id });
  const { data: wsMembers = [] } = useWorkspaceMembers(project.workspace_id);
  const actorNames = Object.fromEntries(wsMembers.map((m) => [m.id, m.display_name]));

  const projectAny = project as any;
  const hasCharterDetails = Boolean(
    projectAny.business_case ||
      projectAny.success_criteria ||
      projectAny.completion_criteria ||
      projectAny.budget_narrative ||
      projectAny.assumptions ||
      projectAny.constraints,
  );

  const risksRoute = `/workspace/${project.workspace_id}/project/${project.id}/risks`;
  const teamRoute = `/workspace/${project.workspace_id}/project/${project.id}/team`;
  const kpisRoute = `/workspace/${project.workspace_id}/project/${project.id}/kpis`;

  return (
    <div className="space-y-8">
      {/* 1. Compact metadata strip (chips only — name/workspace/dates live in the shell header). */}
      <ProjectIdentityHeader project={project as any} workspaceName={workspace?.name || ""} compact />

      {/* 2. Project snapshot — canonical reporting summary, no local re-derivation. */}
      <ProjectOverviewSection
        title="Project snapshot"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => setTraceabilityOpen(true)}
          >
            <Activity className="h-3.5 w-3.5 mr-1.5" /> View traceability
          </Button>
        }
      >
        <ProjectReportingPanel
          summary={reportingSummary}
          isLoading={reportingLoading}
          isError={reportingError}
        />
      </ProjectOverviewSection>

      {/* 3. Attention needed — derived from already-loaded data only. */}
      <ProjectOverviewAttentionPanel
        workspaceId={project.workspace_id}
        projectId={project.id}
        reportingSummary={reportingSummary}
        reportingLoading={reportingLoading}
        risks={risks as any}
        blockers={blockers as any}
        kpis={kpis as any}
        team={team as any}
        loading={risksLoading || blockersLoading || kpisLoading || teamLoading}
      />

      {/* 4. Project context */}
      <ProjectOverviewSection
        title="Project context"
        actions={
          <ConceptHelp
            term={KC_CONCEPTS.classification.term}
            shortText={KC_CONCEPTS.classification.shortText}
            articleSlug={KC_CONCEPTS.classification.slug}
          />
        }
      >
        <ProjectNarrativeSection
          description={project.description}
          charter={projectAny.charter}
          goals={projectAny.goals}
          scopeIn={projectAny.scope_in}
          scopeOut={projectAny.scope_out}
        />
        {hasCharterDetails && (
          <ProjectOverviewSection
            title="More charter details"
            collapsible
            defaultOpen={false}
          >
            <ProjectCharterDetailsSection
              businessCase={projectAny.business_case ?? null}
              successCriteria={projectAny.success_criteria ?? null}
              completionCriteria={projectAny.completion_criteria ?? null}
              budgetNarrative={projectAny.budget_narrative ?? null}
              assumptions={projectAny.assumptions ?? null}
              constraints={projectAny.constraints ?? null}
            />
          </ProjectOverviewSection>
        )}
      </ProjectOverviewSection>

      {/* 5. Planning & controls */}
      <ProjectOverviewSection title="Planning & controls">
        <ProjectBaselineCard
          projectId={project.id}
          workspaceId={project.workspace_id}
          currentStart={project.start_date ?? null}
          currentEnd={project.target_end_date ?? null}
          isBaselined={projectAny.is_baselined ?? false}
          baselineStart={projectAny.baseline_start_date ?? null}
          baselineEnd={projectAny.baseline_end_date ?? null}
          approvedAt={projectAny.baseline_approved_at ?? null}
          approvedBy={projectAny.baseline_approved_by ?? null}
        />
        <DependencyPanel
          entityId={project.id}
          entityType="project"
          entityName={project.name}
          workspaceId={project.workspace_id}
          organizationId={project.organization_id}
          candidates={(projectCandidates || []).filter((c) => c.id !== project.id)}
          canEdit={canEdit}
        />
      </ProjectOverviewSection>

      {/* 6. Operational summaries */}
      <ProjectOverviewSection title="Operational summaries">
        {/* Risks & blockers */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h3 className="text-sm font-medium text-foreground">Risks</h3>
              <div className="flex items-center gap-1">
                {canEdit && (
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setRiskOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add risk
                  </Button>
                )}
                <Button variant="link" size="sm" asChild className="text-xs">
                  <Link to={risksRoute}>Manage →</Link>
                </Button>
              </div>
            </div>
            <RiskSummarySection risks={risks} isLoading={risksLoading} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h3 className="text-sm font-medium text-foreground">Blockers</h3>
              <div className="flex items-center gap-1">
                {canEdit && (
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setBlockerOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add blocker
                  </Button>
                )}
                <Button variant="link" size="sm" asChild className="text-xs">
                  <Link to={risksRoute}>Manage →</Link>
                </Button>
              </div>
            </div>
            <BlockerSummarySection blockers={blockers} isLoading={blockersLoading} />
          </div>
        </div>

        {/* Team & KPIs */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h3 className="text-sm font-medium text-foreground">Team</h3>
              <div className="flex items-center gap-1">
                {canEdit && (
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setMemberOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add member
                  </Button>
                )}
                <Button variant="link" size="sm" asChild className="text-xs">
                  <Link to={teamRoute}>Manage →</Link>
                </Button>
              </div>
            </div>
            <TeamSummarySection members={team as any} isLoading={teamLoading} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h3 className="text-sm font-medium text-foreground">KPIs</h3>
              <div className="flex items-center gap-1">
                {canEdit && (
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setKpiOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Define KPI
                  </Button>
                )}
                <Button variant="link" size="sm" asChild className="text-xs">
                  <Link to={kpisRoute}>Manage →</Link>
                </Button>
              </div>
            </div>
            <KpiSummarySection kpis={kpis} isLoading={kpisLoading} />
          </div>
        </div>

        {/* Governance — compact read-only summary, links to Governance tab */}
        <ProjectOverviewGovernancePanel
          projectId={project.id}
          workspaceId={project.workspace_id}
          canEdit={canEdit}
          compact
        />

        {/* Adoption Plan derived summary — renders nothing when no plan exists */}
        <ProjectAdoptionSummaryCard
          summary={adoptionSummary}
          isLoading={adoptionLoading}
          isError={adoptionError}
          workspaceId={project.workspace_id}
          projectId={project.id}
        />

        {/* Benefits Realization derived summary — active benefits only */}
        <ProjectBenefitsSummaryCard
          workspaceId={project.workspace_id}
          projectId={project.id}
          canEdit={canEdit}
        />
      </ProjectOverviewSection>

      {/* 6b. Closure preparation — PM-authored narrative for future Closure Report */}
      <ProjectOverviewSection
        title="Closure preparation"
        description="PM-authored closure narrative reused by the future Project Closure Report"
      >
        <ProjectClosureSummaryCard
          projectId={project.id}
          canEdit={canEdit}
          projectStatus={(project as any).status ?? null}
        />
      </ProjectOverviewSection>

      {/* 7. Documents & reports — lower priority, collapsed by default */}
      <ProjectOverviewSection
        title="Documents & reports"
        description="Generated Charter, Weekly Status Deck, Closure Report, and Lessons Learned"
        collapsible
        defaultOpen={false}
      >
        <ProjectCharterCard projectId={project.id} canGenerate={canEdit} />
        <ProjectStatusDeckCard projectId={project.id} canGenerate={canEdit} />
        <ProjectClosureReportCard projectId={project.id} canGenerate={canEdit} />
        <ProjectLessonsLearnedCard projectId={project.id} canEdit={canEdit} />
      </ProjectOverviewSection>

      {/* 8. Files — compact entry point only; full list lives at /files */}
      <ProjectOverviewQuickLinksCard
        workspaceId={project.workspace_id}
        projectId={project.id}
      />

      {/* Lifecycle actions (Archive/Restore/Permanent delete) live in the
          shell-level "More" menu. */}

      {/* Create dialogs — only rendered if user has authority */}
      {canEdit && (
        <>
          <RiskFormDialog
            open={riskOpen}
            onOpenChange={setRiskOpen}
            projectId={project.id}
            organizationId={project.organization_id}
            workspaceId={project.workspace_id}
          />
          <BlockerFormDialog
            open={blockerOpen}
            onOpenChange={setBlockerOpen}
            projectId={project.id}
            organizationId={project.organization_id}
            workspaceId={project.workspace_id}
          />
          <AddTeamMemberDialog
            open={memberOpen}
            onOpenChange={setMemberOpen}
            projectId={project.id}
            workspaceId={project.workspace_id}
          />
          <KpiDefinitionDialog
            open={kpiOpen}
            onOpenChange={setKpiOpen}
            projectId={project.id}
            workspaceId={project.workspace_id}
            organizationId={project.organization_id}
          />
        </>
      )}

      {/* Read-only traceability surface — available to any project viewer */}
      <ProjectTraceabilitySheet
        open={traceabilityOpen}
        onOpenChange={setTraceabilityOpen}
        projectId={project.id}
        projectName={project.name}
        projectCreatedAt={project.created_at}
        actorNames={actorNames}
      />
    </div>
  );
}
