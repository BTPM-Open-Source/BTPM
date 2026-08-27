/**
 * Roadmap Status Pack — Preview Shell (Phase 6A.2 + 6A.3 wiring).
 *
 * Renders presentation-style cards from a configuration-only manifest. In
 * 6A.3, Cover & Scope and Executive Summary are wired to live data via
 * `useRoadmapStatusPackPreviewData`. All other sections remain placeholders.
 *
 * NO data fetching beyond the shared resolver hook (which reuses existing
 * canonical Roadmap/reporting hooks). NO persistence. NO PPT export. NO
 * saved views. The legacy Roadmap "Generate PPT" action remains the only
 * working PPT export path until later, separately approved steps.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, Save, Download, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  createDefaultRoadmapStatusPackManifest,
  getRoadmapStatusPackSectionsForManifest,
  toggleRoadmapStatusPackSection,
} from "@/lib/status-pack/roadmapStatusPackManifest";
import { ROADMAP_STATUS_PACK_SECTION_REGISTRY } from "@/lib/status-pack/roadmapStatusPackRegistry";
import type {
  RoadmapFilterSnapshot,
  RoadmapStatusPackManifest,
  StatusPackSectionRegistryEntry,
} from "@/lib/status-pack/statusPackTypes";
import { useRoadmapStatusPackPreviewData } from "@/hooks/useRoadmapStatusPackPreviewData";
import {
  TaskAccountabilityInline,
  type AccountabilityStakeholder,
} from "@/components/planning/TaskAccountabilityInline";
import type {
  RoadmapStatusPackBlockerItem,
  RoadmapStatusPackBreakdownItem,
  RoadmapStatusPackCalendarBucket,
  RoadmapStatusPackCalendarItem,
  RoadmapStatusPackCalendarMilestones,
  RoadmapStatusPackCalendarMissingProject,
  RoadmapStatusPackControlBoard,
  RoadmapStatusPackControlBoardAttentionSignal,
  RoadmapStatusPackControlBoardProject,
  RoadmapStatusPackDependencies,
  RoadmapStatusPackDependencyItem,
  RoadmapStatusPackExecutiveSummary,
  RoadmapStatusPackGovernance,
  RoadmapStatusPackGovernanceItem,
  RoadmapStatusPackKpiItem,
  RoadmapStatusPackKpis,
  RoadmapStatusPackProgressItem,
  RoadmapStatusPackProgressSinceLast,
  RoadmapStatusPackProjectDetailAnnex,
  RoadmapStatusPackProjectDetailItem,
  RoadmapStatusPackRiskItem,
  RoadmapStatusPackRiskSeverityBucket,
  RoadmapStatusPackRisksBlockers,
  RoadmapStatusPackScopeDataNote,
  RoadmapStatusPackScopeDataNotes,
  RoadmapStatusPackScopeDataSourceNote,
  RoadmapStatusPackScopeSummary,
  RoadmapStatusPackTeamWorkDetailAnnex,
  RoadmapStatusPackTeamWorkDetailItem,
  RoadmapStatusPackTeamWorkItem,
  RoadmapStatusPackTeamWorkOwnerSummary,
  RoadmapStatusPackTeamWorkSummary,
  RoadmapStatusPackTimeline,
  RoadmapStatusPackTimelineItem,
} from "@/lib/status-pack/roadmapStatusPackData";
import {
  getPmWorkflowStatusHex,
  getPmWorkflowStatusLabel,
  getPmWorkflowStatusBadgeClass,
  getPmPriorityHex,
  getPmPriorityLabel,
  getPmPriorityBadgeClass,
  getPmHealthBadgeClass,
  getPmHealthDotClass,
} from "@/lib/btpmVisualSemantics";

interface LocationState {
  filters?: RoadmapFilterSnapshot;
  returnTo?: string;
}

/**
 * Embeddable Configure-mode experience. Used by:
 *  - the Roadmap "Status Pack" tab (embedded=true), which passes the
 *    current Roadmap filter snapshot directly so scope follows Roadmap
 *    filters live;
 *  - the legacy /roadmap/status-pack route (embedded=false), which keeps a
 *    Back-to-Roadmap shell for any existing deep links.
 *
 * No persistence, no PPT export, no saved views. Section selection is
 * in-memory only. Scope is fully inherited from Roadmap filters.
 */
export function RoadmapStatusPackConfigure({
  filters,
  embedded = false,
}: {
  filters?: RoadmapFilterSnapshot;
  embedded?: boolean;
}) {
  const [manifest, setManifest] = useState<RoadmapStatusPackManifest>(() =>
    createDefaultRoadmapStatusPackManifest({ filters }),
  );

  // Keep the in-memory manifest scope synced with the live Roadmap filter
  // snapshot when used inside the Roadmap tab. Section selection state is
  // preserved across filter changes.
  const filtersKey = useMemo(() => JSON.stringify(filters ?? null), [filters]);
  useEffect(() => {
    setManifest((m) => ({
      ...m,
      scope: { ...m.scope, roadmap_filters: filters },
    }));
    // filtersKey is the stable identity signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  const sections = useMemo(
    () => getRoadmapStatusPackSectionsForManifest(manifest),
    [manifest],
  );

  const executiveSections = sections.filter((s) => s.placement === "executive");
  const appendixSections = sections.filter((s) => s.placement === "appendix");
  const selectedCount = manifest.selectedSectionIds.length;

  const preview = useRoadmapStatusPackPreviewData(manifest);

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
            In-memory preview
          </Badge>
        </div>
        <h2 className="text-xl font-bold text-foreground">Status Pack</h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Scope follows the current Roadmap filters. The Roadmap{" "}
          <span className="font-medium text-foreground">Generate PPT</span>{" "}
          action remains the active export path.
        </p>
      </div>

      {/* Scope applies to both inner tabs, so it sits above them */}
      <ScopeInheritanceBar manifest={manifest} selectedCount={selectedCount} />

      <Tabs defaultValue="presentation" className="space-y-4">
        <TabsList>
          <TabsTrigger value="presentation">Presentation</TabsTrigger>
          <TabsTrigger value="configure">Configure</TabsTrigger>
        </TabsList>

        {/* ── Presentation (default) ───────────────────────────── */}
        <TabsContent value="presentation" className="mt-0">
          <section
            aria-label="Presentation"
            className="rounded-lg border bg-card text-card-foreground"
          >
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="text-[10px] uppercase tracking-wide" variant="secondary">
                  Presentation
                </Badge>
                <span className="text-sm font-medium text-foreground">
                  Live Status Pack for the current Roadmap scope.
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                In-memory only — not a saved view.
              </span>
            </div>
            <div className="p-4 space-y-4">
              <PreviewBlock
                title="Executive flow"
                sections={executiveSections}
                emptyText="No executive sections selected. Open Configure to add sections."
                preview={preview}
              />
              {appendixSections.length > 0 && (
                <>
                  <Separator />
                  <PreviewBlock
                    title="Appendix"
                    sections={appendixSections}
                    emptyText="No appendix sections selected."
                    preview={preview}
                  />
                </>
              )}
            </div>
          </section>
        </TabsContent>

        {/* ── Configure (secondary) ────────────────────────────── */}
        <TabsContent value="configure" className="mt-0">
          <section
            aria-label="Configure"
            className="rounded-lg border bg-muted/20 p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  Configure
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {selectedCount} section{selectedCount === 1 ? "" : "s"} selected
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Select sections for the in-memory Status Pack preview. Settings
              are not saved yet. Mandatory sections are locked. Toggle optional
              sections to update the Presentation tab.
            </p>
            <SectionSelector
              manifest={manifest}
              onToggle={(id) =>
                setManifest((m) => toggleRoadmapStatusPackSection(m, id))
              }
            />
            <div className="border-t pt-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Deferred actions
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DeferredAction
                  label="Save Presentation View"
                  icon={<Save className="h-3.5 w-3.5" />}
                  tooltip="Saving presentation views is not implemented yet (planned later step)."
                />
                <DeferredAction
                  label="Export to PPT"
                  icon={<Download className="h-3.5 w-3.5" />}
                  tooltip="PPT export from Status Pack is not implemented yet. Use the Roadmap 'Generate PPT' action for now."
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                These are coming later. For now, use the Roadmap{" "}
                <span className="font-medium text-foreground">Generate PPT</span>{" "}
                action to export.
              </p>
            </div>
          </section>
        </TabsContent>
      </Tabs>

      {!embedded && null}
    </div>
  );
}



export default function RoadmapStatusPack() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? null;

  const goBack = () => {
    if (state?.returnTo) navigate(state.returnTo);
    else navigate("/roadmap");
  };

  return (
    <PageContainer width="wide" className="pt-6 pb-10 space-y-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={goBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Roadmap
        </Button>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          Legacy route
        </Badge>
      </div>
      <h1 className="text-2xl font-bold text-foreground">Roadmap Status Pack</h1>
      <p className="text-xs text-muted-foreground max-w-2xl">
        The Status Pack is now available as a first-class tab on the Roadmap
        page. This route is preserved for existing links; scope still follows
        the Roadmap filters used to open it.
      </p>
      <RoadmapStatusPackConfigure filters={state?.filters} embedded={false} />
    </PageContainer>
  );
}

/* ───────────────────────── subcomponents ───────────────────────── */

function DeferredAction({
  label,
  icon,
  tooltip,
}: {
  label: string;
  icon: React.ReactNode;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" disabled>
            {icon}
            {label}
            <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Coming later
            </span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function ScopeInheritanceBar({
  manifest,
  selectedCount,
}: {
  manifest: RoadmapStatusPackManifest;
  selectedCount: number;
}) {
  const f = manifest.scope.roadmap_filters;
  const counts = {
    workspaces: f?.workspace_ids?.length ?? 0,
    programs: f?.program_ids?.length ?? 0,
    projects: f?.project_ids?.length ?? 0,
  };
  return (
    <div className="rounded-lg border bg-card text-card-foreground p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <span className="font-medium text-foreground">Scope</span>
        <span className="text-muted-foreground">Source: Roadmap filters</span>
        <span className="text-muted-foreground">
          Workspaces: {counts.workspaces === 0 ? "All" : counts.workspaces}
        </span>
        <span className="text-muted-foreground">
          Programs: {counts.programs === 0 ? "All" : counts.programs}
        </span>
        <span className="text-muted-foreground">
          Projects: {counts.projects === 0 ? "All" : counts.projects}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto text-muted-foreground cursor-help underline decoration-dotted underline-offset-2">
              Selected sections: <span className="font-medium text-foreground">{selectedCount}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Selected sections are included in this in-memory preview only.
            Unselected optional sections remain available in the Configure
            panel. Save Presentation View is not enabled yet.
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="text-[11px] text-muted-foreground border-t pt-2">
        Scope follows the Roadmap filters above. To change this Status Pack
        scope, adjust the Roadmap filters.
      </div>
    </div>
  );
}

function SectionSelector({
  manifest,
  onToggle,
}: {
  manifest: RoadmapStatusPackManifest;
  onToggle: (id: StatusPackSectionRegistryEntry["id"]) => void;
}) {
  const selected = new Set(manifest.selectedSectionIds);
  return (
    <aside className="rounded-md border bg-card text-card-foreground flex flex-col max-h-[calc(100vh-12rem)]">
      <div className="p-3 border-b shrink-0">
        <h3 className="text-sm font-semibold">Sections</h3>
        <p className="text-xs text-muted-foreground">
          Mandatory sections (scope, executive summary, data/source disclosure)
          are locked. Toggle optional sections to update the Live Preview.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <ul className="p-2 space-y-1">
          {ROADMAP_STATUS_PACK_SECTION_REGISTRY.map((entry) => {
            const isOn = selected.has(entry.id);
            return (
              <li
                key={entry.id}
                className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/40"
              >
                <div className="pt-0.5">
                  {entry.mandatory ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex h-5 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Lock className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Mandatory — always included in every Status Pack
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Switch
                      checked={isOn}
                      onCheckedChange={() => onToggle(entry.id)}
                      aria-label={`Toggle ${entry.title}`}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">
                      {entry.title}
                    </span>
                    {entry.placement === "appendix" && (
                      <Badge variant="outline" className="text-[10px]">Appendix</Badge>
                    )}
                    {entry.resolverStatus === "connected" && (
                      <Badge className="text-[10px]" variant="secondary">Live</Badge>
                    )}
                    {entry.mandatory && (
                      <Badge variant="outline" className="text-[10px]">Mandatory</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">
                    {entry.shortDescription}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

    </aside>
  );
}

interface PreviewState {
  data: ReturnType<typeof useRoadmapStatusPackPreviewData>["data"];
  isLoading: boolean;
  isError: boolean;
  reportingError: boolean;
  risksBlockersLoading: boolean;
  dependenciesLoading: boolean;
  kpisLoading: boolean;
  governanceLoading: boolean;
  progressLoading: boolean;
  teamWorkLoading: boolean;
  teamWorkDetailAnnexLoading: boolean;
  projectDetailAnnexLoading: boolean;
}

function PreviewBlock({
  title,
  sections,
  emptyText,
  preview,
}: {
  title: string;
  sections: StatusPackSectionRegistryEntry[];
  emptyText: string;
  preview: PreviewState;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((s) => (
            <SectionCard key={s.id} section={s} preview={preview} />
          ))}
        </div>
      )}
    </section>
  );
}

function SectionCard({
  section,
  preview,
}: {
  section: StatusPackSectionRegistryEntry;
  preview: PreviewState;
}) {
  const live = section.resolverStatus === "connected";
  return (
    <article className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <h3 className="text-base font-semibold truncate">{section.title}</h3>
          {section.mandatory && (
            <Badge variant="secondary" className="text-[10px]">Mandatory</Badge>
          )}
          <Badge variant="outline" className="text-[10px] capitalize">
            {section.category}
          </Badge>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {live ? "Live" : "Placeholder"}
        </span>
      </header>
      <div className="px-4 py-4">
        {section.id === "cover_scope" ? (
          <CoverScopeBody preview={preview} />
        ) : section.id === "exec_summary" ? (
          <ExecutiveSummaryBody preview={preview} />
        ) : section.id === "control_board" ? (
          <ControlBoardBody preview={preview} />
        ) : section.id === "timeline" ? (
          <TimelineBody preview={preview} />
        ) : section.id === "calendar_milestones" ? (
          <CalendarMilestonesBody preview={preview} />
        ) : section.id === "risks_blockers" ? (
          <RisksBlockersBody preview={preview} />
        ) : section.id === "dependencies" ? (
          <DependenciesBody preview={preview} />
        ) : section.id === "kpis" ? (
          <KpisBody preview={preview} />
        ) : section.id === "governance" ? (
          <GovernanceBody preview={preview} />
        ) : section.id === "progress_since_last" ? (
          <ProgressSinceLastBody preview={preview} />
        ) : section.id === "team_work_summary" ? (
          <TeamWorkSummaryBody preview={preview} />
        ) : section.id === "team_work_detail_annex" ? (
          <TeamWorkDetailAnnexBody preview={preview} />
        ) : section.id === "project_detail_annex" ? (
          <ProjectDetailAnnexBody preview={preview} />
        ) : section.id === "scope_data_notes" ? (
          <ScopeDataNotesBody preview={preview} />
        ) : (
          <PlaceholderBody section={section} />
        )}
      </div>
    </article>
  );
}

function PlaceholderBody({ section }: { section: StatusPackSectionRegistryEntry }) {
  return (
    <div className="min-h-[100px] flex flex-col justify-center gap-2">
      <p className="text-sm text-foreground">{section.shortDescription}</p>
      <p className="text-xs text-muted-foreground">{section.emptyStateText}</p>
    </div>
  );
}

/* ───── Cover & Scope (live) ───── */

function CoverScopeBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading) return <LoadingRows lines={4} />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for the Cover & Scope summary." />
    );
  }
  const s: RoadmapStatusPackScopeSummary = preview.data.scopeSummary;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {s.sourceSurface} · {s.scopeKind}
          </div>
          <div className="text-lg font-semibold">{s.packTitle}</div>
        </div>
        <div className="text-xs text-muted-foreground">
          Generated&nbsp;
          <time dateTime={s.generatedAt}>
            {new Date(s.generatedAt).toLocaleString()}
          </time>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <StatTile label="Projects in scope" value={s.totalProjectsInScope} />
        <StatTile
          label="Accessible projects"
          value={s.totalAccessibleProjects}
          hint="Before filters"
        />
        <StatTile label="Workspaces" value={s.workspaceCountInScope} />
        <StatTile label="Programs" value={s.programCountInScope} />
      </div>

      {s.totalProjectsInScope === 0 && (
        <EmptyState message="No projects match the current Roadmap filters." />
      )}

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Applied filters</div>
        <div className="flex flex-wrap gap-1.5">
          {s.appliedFilters.map((f) => (
            <Badge key={f.label} variant="outline" className="text-[11px] font-normal">
              <span className="text-muted-foreground mr-1">{f.label}:</span>
              <span className="text-foreground">{f.value}</span>
            </Badge>
          ))}
        </div>
      </div>

      {(s.workspaceLabels.length > 0 || s.programLabels.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {s.workspaceLabels.length > 0 && (
            <LabelList title="Workspaces in scope" items={s.workspaceLabels} />
          )}
          {s.programLabels.length > 0 && (
            <LabelList title="Programs in scope" items={s.programLabels} />
          )}
        </div>
      )}

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Reporting summaries: {s.reportingSummariesAvailable} available
        {s.reportingSummariesMissing > 0 ? `, ${s.reportingSummariesMissing} missing` : ""}
        {!s.reportingAvailable && (
          <span className="ml-1 text-destructive">· reporting service unavailable</span>
        )}
        <span className="block mt-1">{s.note}</span>
      </div>
    </div>
  );
}

function LabelList({ title, items }: { title: string; items: string[] }) {
  const MAX = 8;
  const shown = items.slice(0, MAX);
  const extra = items.length - shown.length;
  return (
    <div>
      <div className="font-medium text-muted-foreground mb-1">{title}</div>
      <div className="flex flex-wrap gap-1">
        {shown.map((l) => (
          <Badge key={l} variant="secondary" className="text-[10px] font-normal">
            {l}
          </Badge>
        ))}
        {extra > 0 && (
          <Badge variant="outline" className="text-[10px] font-normal">
            +{extra} more
          </Badge>
        )}
      </div>
    </div>
  );
}

/* ───── Executive Summary (live) ───── */

function ExecutiveSummaryBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading) return <LoadingRows lines={5} />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for the Executive Summary." />
    );
  }
  const e: RoadmapStatusPackExecutiveSummary = preview.data.executiveSummary;

  if (e.totalProjects === 0) {
    return <EmptyState message="No projects match the current Roadmap filters." />;
  }

  const reportingOk = preview.data.scopeSummary.reportingAvailable;
  const completionLabel =
    e.averageCompletionPercent == null
      ? reportingOk
        ? "—"
        : "Unavailable"
      : `${e.averageCompletionPercent}%`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <StatTile label="Projects" value={e.totalProjects} />
        <StatTile
          label="Avg completion"
          value={completionLabel}
          hint={
            e.averageCompletionBasis > 0
              ? `${e.averageCompletionBasis} project(s) with reporting`
              : "No reporting summaries"
          }
        />
        <StatTile label="Behind schedule" value={e.behindScheduleCount} />
        <StatTile label="No schedule basis" value={e.noScheduleBasisCount} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Breakdown title="Status" items={e.statusDistribution} total={e.totalProjects} paletteKind="status" />
        <Breakdown title="Priority" items={e.priorityDistribution} total={e.totalProjects} paletteKind="priority" />
        <Breakdown
          title="Health"
          items={e.healthDistribution}
          total={e.totalProjects}
          unavailable={!reportingOk}
        />
        <Breakdown
          title="Schedule"
          items={e.scheduleDistribution}
          total={e.totalProjects}
          unavailable={!reportingOk}
        />
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Reporting coverage: {e.reportingSummariesAvailable} of {e.totalProjects} projects
        {e.reportingSummariesMissing > 0
          ? ` (${e.reportingSummariesMissing} missing)`
          : ""}
        {e.latestComputedAt && (
          <span className="ml-1">
            · latest computed {new Date(e.latestComputedAt).toLocaleString()}
          </span>
        )}
        <span className="block mt-1">
          Risks, blockers, KPIs, governance, dependencies, and Team Work signals
          are not connected in this preview yet — they will appear in later
          Phase 6A steps.
        </span>
      </div>
    </div>
  );
}

/* ───── Control Board (live) ───── */

const ATTENTION_LABELS: Record<RoadmapStatusPackControlBoardAttentionSignal, string> = {
  red_health: "Red health",
  behind_schedule: "Behind schedule",
  amber_health: "Amber health",
  missing_reporting: "Reporting missing",
  no_schedule_basis: "No schedule basis",
  high_priority: "High priority",
};

function attentionVariant(
  sig: RoadmapStatusPackControlBoardAttentionSignal,
): "destructive" | "secondary" | "outline" {
  // Behind schedule is a delay signal (orange) — styled via
  // attentionClassName below. Keep true critical signals on destructive red.
  if (sig === "red_health") return "destructive";
  if (sig === "amber_health" || sig === "no_schedule_basis") return "secondary";
  return "outline";
}

/** Canonical color className overrides for attention signals. */
function attentionClassName(
  sig: RoadmapStatusPackControlBoardAttentionSignal,
): string {
  if (sig === "behind_schedule") return getPmHealthBadgeClass("behind");
  if (sig === "amber_health") return getPmHealthBadgeClass("needs_attention");
  return "";
}

function healthDotClass(rag: "green" | "amber" | "red" | null): string {
  if (rag === "red") return getPmHealthDotClass("at_risk");
  if (rag === "amber") return getPmHealthDotClass("needs_attention");
  if (rag === "green") return getPmHealthDotClass("on_track");
  return "bg-muted-foreground/40";
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (d: string) => new Date(d).toLocaleDateString();
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `${fmt(start)} → —`;
  return `— → ${fmt(end!)}`;
}

function ControlBoardBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading) return <LoadingRows lines={6} />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for the Control Board." />
    );
  }
  const cb: RoadmapStatusPackControlBoard = preview.data.controlBoard;
  if (cb.totalProjects === 0) {
    return <EmptyState message="No projects match the current Roadmap filters." />;
  }
  const reportingOk = cb.reportingAvailable;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Project-level delivery control view for the selected Roadmap scope.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <StatTile label="Projects shown" value={cb.totalProjects} />
        <StatTile
          label="With reporting data"
          value={reportingOk ? cb.projectsWithReporting : "Unavailable"}
          hint={
            reportingOk
              ? cb.projectsMissingReporting > 0
                ? `${cb.projectsMissingReporting} missing`
                : "All projects covered"
              : "Reporting service unavailable"
          }
        />
        <StatTile
          label="Behind schedule"
          value={reportingOk ? cb.behindScheduleCount : "Unavailable"}
        />
        <StatTile
          label="Red health"
          value={reportingOk ? cb.redHealthCount : "Unavailable"}
        />
        <StatTile
          label="Amber health"
          value={reportingOk ? cb.amberHealthCount : "Unavailable"}
        />
      </div>

      {!reportingOk && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
          Reporting service is unavailable. Project rows show canonical fields
          only; health, schedule, and completion are marked unavailable.
        </div>
      )}

      <ul className="space-y-2">
        {cb.rows.map((row) => (
          <ControlBoardRow key={row.projectId} row={row} reportingOk={reportingOk} />
        ))}
      </ul>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Attention rows shown first: red health → behind schedule → amber → missing
        reporting → high priority. Risks, blockers, KPIs, dependencies, and Team
        Work signals are not connected on the Control Board yet.
      </div>
    </div>
  );
}

function ControlBoardRow({
  row,
  reportingOk,
}: {
  row: RoadmapStatusPackControlBoardProject;
  reportingOk: boolean;
}) {
  const dateRange = formatDateRange(row.startDate, row.targetEndDate);
  const completionDisplay =
    !reportingOk
      ? "Unavailable"
      : row.completionPercent == null
      ? "—"
      : `${Math.round(row.completionPercent)}%`;
  const healthDisplay =
    !reportingOk
      ? "Unavailable"
      : row.healthLabel ?? "Unknown";
  const scheduleDisplay =
    !reportingOk
      ? "Unavailable"
      : row.scheduleLabel ?? "Unknown";

  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`inline-block h-2 w-2 rounded-full shrink-0 ${healthDotClass(
                reportingOk ? row.healthRag : null,
              )}`}
              aria-hidden
            />
            <span className="text-sm font-medium text-foreground truncate">
              {row.projectName}
            </span>
            <Badge variant="outline" className="text-[10px] capitalize">
              {row.statusLabel}
            </Badge>
            <Badge variant="outline" className="text-[10px] capitalize">
              {row.priorityLabel}
            </Badge>
            {row.projectStage && (
              <Badge variant="secondary" className="text-[10px]">
                {row.projectStage}
              </Badge>
            )}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground truncate">
            {row.workspaceName}
            {row.programName ? ` · ${row.programName}` : " · Standalone"}
            {dateRange ? ` · ${dateRange}` : ""}
            {!row.hasReportingSummary && reportingOk && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                · Reporting unavailable
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums shrink-0">
          <span>
            <span className="text-[10px] uppercase mr-1">Health</span>
            <span className="text-foreground">{healthDisplay}</span>
          </span>
          <span>
            <span className="text-[10px] uppercase mr-1">Schedule</span>
            <span className="text-foreground">{scheduleDisplay}</span>
          </span>
          <span>
            <span className="text-[10px] uppercase mr-1">Complete</span>
            <span className="text-foreground">{completionDisplay}</span>
          </span>
        </div>
      </div>
      {row.attentionSignals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.attentionSignals.map((sig) => (
            <Badge
              key={sig}
              variant={attentionVariant(sig)}
              className={`text-[10px] font-normal ${attentionClassName(sig)}`}
            >
              {ATTENTION_LABELS[sig]}
            </Badge>
          ))}
        </div>
      )}
    </li>
  );
}

function Breakdown({
  title,
  items,
  total,
  unavailable,
  paletteKind = "neutral",
}: {
  title: string;
  items: RoadmapStatusPackBreakdownItem[];
  total: number;
  unavailable?: boolean;
  /**
   * Which canonical color palette to use for the per-row bar color:
   *  - "status"   → PM workflow status colors (planned/active/completed/on_hold/cancelled)
   *  - "priority" → PM priority colors (low/medium/high/critical)
   *  - "neutral"  → keep the plain muted-foreground tint (health, schedule, etc.)
   *
   * Health and Schedule breakdowns intentionally do NOT force PM workflow
   * colors — their own tokens (RAG / schedule signal) live elsewhere.
   */
  paletteKind?: "status" | "priority" | "neutral";
}) {
  const colorForKey = (key: string): string | undefined => {
    if (paletteKind === "status") return getPmWorkflowStatusHex(key);
    if (paletteKind === "priority") return getPmPriorityHex(key);
    return undefined;
  };
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        {unavailable && (
          <Badge variant="outline" className="text-[10px]">Reporting unavailable</Badge>
        )}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No data.</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => {
            const pct = total > 0 ? Math.round((it.count / total) * 100) : 0;
            const barColor = colorForKey(it.key);
            return (
              <li key={it.key} className="text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-foreground">{it.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {it.count}
                    <span className="ml-1 text-[10px]">({pct}%)</span>
                  </span>
                </div>
                <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={barColor ? "h-full" : "h-full bg-muted-foreground/60"}
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ───── small primitives ───── */

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold text-foreground tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function LoadingRows({ lines }: { lines: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/* ───── Timeline (live) — Phase 6A.5 ───── */

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function timelineScheduleBadgeVariant(
  bucket: RoadmapStatusPackTimelineItem["scheduleBucket"],
  reportingOk: boolean,
): "destructive" | "secondary" | "outline" {
  if (!reportingOk) return "outline";
  // behind_schedule uses orange className (see timelineScheduleBadgeClass).
  if (bucket === "on_track" || bucket === "complete") return "secondary";
  return "outline";
}

function timelineScheduleBadgeClass(
  bucket: RoadmapStatusPackTimelineItem["scheduleBucket"],
  reportingOk: boolean,
): string {
  if (!reportingOk) return "";
  if (bucket === "behind_schedule") return getPmHealthBadgeClass("behind");
  if (bucket === "complete") return getPmWorkflowStatusBadgeClass("completed");
  return "";
}

function TimelineBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading) return <LoadingRows lines={6} />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for the Timeline." />
    );
  }
  const t: RoadmapStatusPackTimeline = preview.data.timeline;
  if (t.totalProjects === 0) {
    return <EmptyState message="No projects match the current Roadmap filters." />;
  }
  const reportingOk = t.reportingAvailable;
  const period = t.period;
  const periodLabel =
    period.earliestStart || period.latestEnd
      ? `${formatShortDate(period.earliestStart)} → ${formatShortDate(period.latestEnd)}${
          period.spanDays != null ? ` · ${period.spanDays} day${period.spanDays === 1 ? "" : "s"}` : ""
        }`
      : "No date range available";

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Roadmap timeline view for the selected project scope. Derived from
        project start / target end dates and reporting summaries — read-only.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <StatTile label="Projects in scope" value={t.totalProjects} />
        <StatTile
          label="With date range"
          value={t.withDateRange}
          hint={
            t.partialDateRange > 0
              ? `${t.partialDateRange} with partial dates`
              : undefined
          }
        />
        <StatTile
          label="Missing date range"
          value={t.missingDateRange}
          hint={t.missingDateRange > 0 ? "No start or end set" : undefined}
        />
        <StatTile
          label="Behind schedule"
          value={reportingOk ? t.behindScheduleCount : "Unavailable"}
          hint={reportingOk ? undefined : "Reporting service unavailable"}
        />
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Period: <span className="text-foreground">{periodLabel}</span>
      </div>

      {!reportingOk && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
          Reporting service is unavailable. Health, schedule and completion are
          marked unavailable; project date ranges still shown.
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Scheduled projects
        </div>
        {t.dated.length === 0 ? (
          <EmptyState message="No projects in scope have a usable date range." />
        ) : (
          <ul className="space-y-2">
            {t.dated.map((it) => (
              <TimelineRow key={it.projectId} item={it} reportingOk={reportingOk} />
            ))}
          </ul>
        )}
      </div>

      {t.undated.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Missing timeline basis ({t.undated.length})
          </div>
          <ul className="space-y-2">
            {t.undated.map((it) => (
              <TimelineRow key={it.projectId} item={it} reportingOk={reportingOk} />
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Read-only presentation projection. Phases and tasks are not connected in
        this view. Gantt editing and drill-down remain in the existing Roadmap
        surface.
      </div>
    </div>
  );
}

function TimelineRow({
  item,
  reportingOk,
}: {
  item: RoadmapStatusPackTimelineItem;
  reportingOk: boolean;
}) {
  const dateLabel =
    item.hasDateRange
      ? `${formatShortDate(item.startDate)} → ${formatShortDate(item.endDate)}`
      : item.hasStartOnly
      ? `${formatShortDate(item.startDate)} → —`
      : item.hasEndOnly
      ? `— → ${formatShortDate(item.endDate)}`
      : "Missing date range";

  const completionDisplay = !reportingOk
    ? "Unavailable"
    : item.completionPercent == null
    ? "—"
    : `${Math.round(item.completionPercent)}%`;

  const healthDisplay = !reportingOk
    ? "Unavailable"
    : item.healthLabel ?? "Unknown";

  const scheduleDisplay = !reportingOk
    ? "Unavailable"
    : item.scheduleLabel ?? "Unknown";

  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">
              {item.projectName}
            </span>
            <Badge variant="outline" className="text-[10px] capitalize">
              {item.statusLabel}
            </Badge>
            <Badge variant="outline" className="text-[10px] capitalize">
              {item.priorityLabel}
            </Badge>
            {item.projectStage && (
              <Badge variant="secondary" className="text-[10px]">
                {item.projectStage}
              </Badge>
            )}
            {item.isAttention && (
              <Badge variant="destructive" className="text-[10px]">
                Attention
              </Badge>
            )}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground truncate">
            {item.workspaceName}
            {item.programName ? ` · ${item.programName}` : " · Standalone"}
            {" · "}
            <span
              className={
                !item.hasDateRange && !item.hasStartOnly && !item.hasEndOnly
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-foreground"
              }
            >
              {dateLabel}
            </span>
            {item.durationDays != null && (
              <span className="ml-1">
                ({item.durationDays} day{item.durationDays === 1 ? "" : "s"})
              </span>
            )}
            {(item.hasStartOnly || item.hasEndOnly) && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                · Partial dates
              </span>
            )}
            {!item.hasReportingSummary && reportingOk && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                · Reporting unavailable
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums shrink-0">
          <span>
            <span className="text-[10px] uppercase mr-1">Health</span>
            <span className="text-foreground">{healthDisplay}</span>
          </span>
          <Badge
            variant={timelineScheduleBadgeVariant(item.scheduleBucket, reportingOk)}
            className={`text-[10px] font-normal ${timelineScheduleBadgeClass(item.scheduleBucket, reportingOk)}`}
          >
            {scheduleDisplay}
          </Badge>
          <span>
            <span className="text-[10px] uppercase mr-1">Complete</span>
            <span className="text-foreground">{completionDisplay}</span>
          </span>
        </div>
      </div>
    </li>
  );
}

/* ───── Calendar / Upcoming Milestones (live) — Phase 6A.6 ───── */

function CalendarMilestonesBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading) return <LoadingRows lines={6} />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for Calendar / Upcoming Milestones." />
    );
  }
  const c: RoadmapStatusPackCalendarMilestones = preview.data.calendarMilestones;
  if (c.totalProjects === 0) {
    return <EmptyState message="No projects match the current Roadmap filters." />;
  }
  const reportingOk = c.reportingAvailable;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Upcoming Roadmap delivery dates for the selected project scope. Derived
        from project start / target end dates — read-only.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <StatTile label="Upcoming next 30 days" value={c.upcomingNext30Count} />
        <StatTile label="Upcoming next 90 days" value={c.upcomingNext90Count} />
        <StatTile
          label="Overdue / past target"
          value={c.overdueCount}
          hint={c.overdueCount > 0 ? "Target end in the past" : undefined}
        />
        <StatTile
          label="Missing date basis"
          value={c.missingDateProjectsCount}
          hint={c.missingDateProjectsCount > 0 ? "No start or end set" : undefined}
        />
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Reference date: <span className="text-foreground">{c.referenceDate}</span>
        {" · "}Total items:{" "}
        <span className="text-foreground">{c.totalItems}</span>
        {reportingOk && (
          <>
            {" · "}Behind schedule:{" "}
            <span className="text-foreground">{c.behindScheduleCount}</span>
          </>
        )}
      </div>

      {!reportingOk && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
          Reporting service is unavailable. Calendar items still show project
          dates; health, schedule, and completion are marked unavailable.
        </div>
      )}

      {c.totalItems === 0 && c.missingDateProjectsCount === c.totalProjects && (
        <EmptyState message="No projects in scope have a usable start or target end date." />
      )}

      <div className="space-y-3">
        {c.buckets.map((bucket) => (
          <CalendarBucketBlock
            key={bucket.key}
            bucket={bucket}
            reportingOk={reportingOk}
            missingProjects={
              bucket.key === "missing" ? c.missingProjects : undefined
            }
          />
        ))}
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Read-only projection from canonical project dates. Phase/task milestones,
        drill-down, and schedule editing are not connected in this view.
      </div>
    </div>
  );
}

function CalendarBucketBlock({
  bucket,
  reportingOk,
  missingProjects,
}: {
  bucket: RoadmapStatusPackCalendarBucket;
  reportingOk: boolean;
  missingProjects?: RoadmapStatusPackCalendarMissingProject[];
}) {
  const hasItems = bucket.items.length > 0;
  const hasMissing = bucket.key === "missing" && (missingProjects?.length ?? 0) > 0;
  if (!hasItems && !hasMissing) {
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {bucket.label}
        </div>
        <div className="rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
          None.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {bucket.label}
        <span className="ml-1 text-muted-foreground/70">
          ({bucket.key === "missing" ? missingProjects?.length ?? 0 : bucket.items.length})
        </span>
      </div>
      {hasItems && (
        <ul className="space-y-2">
          {bucket.items.map((it) => (
            <CalendarItemRow key={it.itemId} item={it} reportingOk={reportingOk} />
          ))}
        </ul>
      )}
      {hasMissing && (
        <ul className="space-y-2">
          {missingProjects!.map((mp) => (
            <li
              key={mp.projectId}
              className="rounded-md border bg-card px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {mp.projectName}
                </span>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {mp.statusLabel}
                </Badge>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {mp.priorityLabel}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  No start or target end
                </Badge>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {mp.workspaceName}
                {mp.programName ? ` · ${mp.programName}` : " · Standalone"}
                {reportingOk && mp.healthLabel && (
                  <> · Health: <span className="text-foreground">{mp.healthLabel}</span></>
                )}
                {reportingOk && mp.scheduleLabel && (
                  <> · Schedule: <span className="text-foreground">{mp.scheduleLabel}</span></>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CalendarItemRow({
  item,
  reportingOk,
}: {
  item: RoadmapStatusPackCalendarItem;
  reportingOk: boolean;
}) {
  const completionDisplay = !reportingOk
    ? "Unavailable"
    : item.completionPercent == null
    ? "—"
    : `${Math.round(item.completionPercent)}%`;

  const healthDisplay = !reportingOk
    ? "Unavailable"
    : item.healthLabel ?? "Unknown";

  const scheduleDisplay = !reportingOk
    ? "Unavailable"
    : item.scheduleLabel ?? "Unknown";

  const relLabel =
    item.daysFromToday === 0
      ? "Today"
      : item.daysFromToday > 0
      ? `In ${item.daysFromToday} day${item.daysFromToday === 1 ? "" : "s"}`
      : `${Math.abs(item.daysFromToday)} day${item.daysFromToday === -1 ? "" : "s"} ago`;

  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-[11px] tabular-nums text-foreground font-medium">
              {item.dateLabel}
            </span>
            <Badge
              variant={item.isOverdue ? "destructive" : "outline"}
              className="text-[10px]"
            >
              {item.itemTypeLabel}
            </Badge>
            <span className="text-sm font-medium text-foreground truncate">
              {item.projectName}
            </span>
            <Badge variant="outline" className="text-[10px] capitalize">
              {item.statusLabel}
            </Badge>
            <Badge variant="outline" className="text-[10px] capitalize">
              {item.priorityLabel}
            </Badge>
            {item.isOverdue && (
              <Badge variant="destructive" className="text-[10px]">
                Overdue
              </Badge>
            )}
            {item.isCurrent && (
              <Badge variant="secondary" className="text-[10px]">
                Today
              </Badge>
            )}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground truncate">
            {item.workspaceName}
            {item.programName ? ` · ${item.programName}` : " · Standalone"}
            {" · "}
            <span className="text-foreground">{relLabel}</span>
            {!item.hasReportingSummary && reportingOk && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                · Reporting unavailable
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums shrink-0">
          <span>
            <span className="text-[10px] uppercase mr-1">Health</span>
            <span className="text-foreground">{healthDisplay}</span>
          </span>
          <span>
            <span className="text-[10px] uppercase mr-1">Schedule</span>
            <span className="text-foreground">{scheduleDisplay}</span>
          </span>
          <span>
            <span className="text-[10px] uppercase mr-1">Complete</span>
            <span className="text-foreground">{completionDisplay}</span>
          </span>
        </div>
      </div>
    </li>
  );
}

/* ───── Risks & Blockers (live) — Phase 6A.7 ───── */

function severityBadgeVariant(
  bucket: RoadmapStatusPackRiskSeverityBucket,
): "destructive" | "secondary" | "outline" {
  if (bucket === "critical" || bucket === "high") return "destructive";
  if (bucket === "medium") return "secondary";
  return "outline";
}

function RisksBlockersBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading || preview.risksBlockersLoading) return <LoadingRows lines={6} />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for Risks & Blockers." />
    );
  }
  const rb: RoadmapStatusPackRisksBlockers = preview.data.risksBlockers;

  if (rb.projectsInScope === 0) {
    return <EmptyState message="No projects match the current Roadmap filters." />;
  }

  if (rb.dataStatus === "unavailable") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Open execution constraints and future delivery risks for the selected
          Roadmap scope. Risks and blockers are kept as separate concepts.
        </p>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {rb.unavailableReason ??
              "Risks & Blockers require a protected roadmap-level resolver before they can be shown here."}
          </span>
        </div>
      </div>
    );
  }

  // Loading-but-partial: still render whatever is already authorized + coverage note.
  const coverageLabel =
    rb.projectsFailed > 0
      ? `${rb.projectsWithData}/${rb.projectsInScope} projects covered · ${rb.projectsFailed} unavailable`
      : `${rb.projectsWithData}/${rb.projectsInScope} projects covered`;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Open execution constraints and future delivery risks for the selected
        Roadmap scope. Risks and blockers are kept as separate concepts.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
        <StatTile label="Open risks" value={rb.openRisksCount} />
        <StatTile
          label="High / Critical risks"
          value={rb.highCriticalRisksCount}
          hint={rb.realizedRisksCount > 0 ? `${rb.realizedRisksCount} realized` : undefined}
        />
        <StatTile
          label="Stale risks"
          value={rb.staleRisksCount}
          hint={rb.staleRisksCount > 0 ? "Active 30+ days w/o update" : undefined}
        />
        <StatTile label="Open blockers" value={rb.openBlockersCount} />
        <StatTile
          label="High / Critical blockers"
          value={rb.highCriticalBlockersCount}
        />
        <StatTile
          label="Stale blockers"
          value={rb.staleBlockersCount}
          hint={rb.staleBlockersCount > 0 ? "Open 30+ days w/o update" : undefined}
        />
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Data coverage: <span className="text-foreground">{coverageLabel}</span>
        {rb.partial && (
          <span className="ml-1 text-amber-600 dark:text-amber-400">
            · Partial — some projects could not be read
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Risks */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Risks
              <span className="ml-1 text-muted-foreground/70">({rb.totalRisks})</span>
            </div>
            {rb.topRisks.length < rb.totalRisks && (
              <Badge variant="outline" className="text-[10px]">
                Showing top {rb.topRisks.length}
              </Badge>
            )}
          </div>
          {rb.totalRisks === 0 ? (
            <EmptyState message="No risks recorded in the selected scope." />
          ) : (
            <ul className="space-y-2">
              {rb.topRisks.map((r) => (
                <RiskCard key={r.riskId} risk={r} />
              ))}
            </ul>
          )}
        </div>

        {/* Blockers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Blockers
              <span className="ml-1 text-muted-foreground/70">({rb.totalBlockers})</span>
            </div>
            {rb.topBlockers.length < rb.totalBlockers && (
              <Badge variant="outline" className="text-[10px]">
                Showing top {rb.topBlockers.length}
              </Badge>
            )}
          </div>
          {rb.totalBlockers === 0 ? (
            <EmptyState message="No blockers recorded in the selected scope." />
          ) : (
            <ul className="space-y-2">
              {rb.topBlockers.map((b) => (
                <BlockerCard key={b.blockerId} blocker={b} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Read-only presentation projection. Risks and blockers remain separate
        concepts. Drill-down, edit controls, and aggregate roadmap-level
        resolver are not enabled in this view.
      </div>
    </div>
  );
}

function RiskCard({ risk }: { risk: RoadmapStatusPackRiskItem }) {
  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <Badge
          variant={severityBadgeVariant(risk.severityBucket)}
          className="text-[10px]"
        >
          {risk.severityLabel}
        </Badge>
        <Badge variant="outline" className="text-[10px] capitalize">
          {risk.statusLabel}
        </Badge>
        {risk.isRealized && (
          <Badge variant="destructive" className="text-[10px]">Realized</Badge>
        )}
        {risk.isStale && (
          <Badge variant="secondary" className="text-[10px]">Stale</Badge>
        )}
        <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
          {risk.title}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground truncate">
        {risk.projectName}
        {" · "}
        {risk.workspaceName}
        {risk.programName ? ` · ${risk.programName}` : ""}
        {" · "}
        <span className="capitalize">{risk.targetType}</span>
        {" · "}
        Updated {risk.ageDays === 0 ? "today" : `${risk.ageDays}d ago`}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        Likelihood: <span className="text-foreground">{risk.likelihood || "—"}</span>
        {" · "}
        Impact: <span className="text-foreground">{risk.impact || "—"}</span>
      </div>
    </li>
  );
}

function BlockerCard({ blocker }: { blocker: RoadmapStatusPackBlockerItem }) {
  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <Badge
          variant={severityBadgeVariant(blocker.severityBucket)}
          className="text-[10px]"
        >
          {blocker.severityLabel}
        </Badge>
        <Badge
          variant={blocker.isOpen ? "destructive" : "outline"}
          className="text-[10px] capitalize"
        >
          {blocker.statusLabel}
        </Badge>
        {blocker.isStale && (
          <Badge variant="secondary" className="text-[10px]">Stale</Badge>
        )}
        <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
          {blocker.title}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground truncate">
        {blocker.projectName}
        {" · "}
        {blocker.workspaceName}
        {blocker.programName ? ` · ${blocker.programName}` : ""}
        {" · "}
        <span className="capitalize">{blocker.targetType}</span>
        {" · "}
        Updated {blocker.ageDays === 0 ? "today" : `${blocker.ageDays}d ago`}
        {blocker.resolvedAt && (
          <> · Resolved {new Date(blocker.resolvedAt).toLocaleDateString()}</>
        )}
      </div>
    </li>
  );
}

/* ───── Dependencies & Coordination (live) — Phase 6A.8 ───── */

function DependenciesBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading || preview.dependenciesLoading) return <LoadingRows lines={6} />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for Dependencies & Coordination." />
    );
  }
  const d: RoadmapStatusPackDependencies = preview.data.dependencies;

  const description = (
    <p className="text-xs text-muted-foreground">
      Cross-project and same-level execution dependencies for the selected
      Roadmap scope. Dependencies remain <span className="font-medium text-foreground">same-level only</span>{" "}
      (project-to-project shown here; phase- and task-level dependencies stay
      within their own surfaces).
    </p>
  );

  if (d.projectsInScope === 0) {
    return (
      <div className="space-y-3">
        {description}
        <EmptyState message="No projects match the current Roadmap filters." />
      </div>
    );
  }

  if (d.dataStatus === "unavailable") {
    return (
      <div className="space-y-3">
        {description}
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {d.unavailableReason ??
              "Dependencies require a protected roadmap-level resolver before they can be shown here."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {description}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
        <StatTile label="Total dependencies" value={d.totalDependencies} />
        <StatTile
          label="Project-level"
          value={d.projectLevelCount}
          hint="Same-level only"
        />
        <StatTile label="Inbound" value={d.inboundCount} hint="External → in-scope" />
        <StatTile label="Outbound" value={d.outboundCount} hint="In-scope → external" />
        <StatTile label="Internal" value={d.internalCount} hint="Within scope" />
        <StatTile
          label="Attention"
          value={d.attentionCount}
          hint={d.attentionCount > 0 ? "Touches red / behind schedule" : undefined}
        />
      </div>

      {d.coverageNotes.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
          {d.coverageNotes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {d.totalDependencies === 0 ? (
        <EmptyState message="No project-to-project dependencies recorded for the selected scope." />
      ) : (
        <div className="space-y-4">
          {d.attentionItems.length > 0 && (
            <DependencyBlock
              title="Attention needed"
              hint="At least one side is red or behind schedule."
              items={d.attentionItems}
            />
          )}
          <DependencyBlock
            title="Inbound"
            hint="External predecessor affects an in-scope project."
            items={d.inboundItems}
          />
          <DependencyBlock
            title="Outbound"
            hint="In-scope project affects an external successor."
            items={d.outboundItems}
          />
          <DependencyBlock
            title="Internal"
            hint="Both predecessor and successor are within current scope."
            items={d.internalItems}
          />
        </div>
      )}

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Read-only presentation projection. Dependency edit, Gantt scheduling,
        and drill-down are not enabled in this view.
      </div>
    </div>
  );
}

function DependencyBlock({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: readonly RoadmapStatusPackDependencyItem[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
          <span className="ml-1 text-muted-foreground/70">({items.length})</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      {items.length === 0 ? (
        <EmptyState message="None." />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <DependencyRow key={item.dependencyId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DependencyRow({ item }: { item: RoadmapStatusPackDependencyItem }) {
  const directionLabel =
    item.direction === "inbound"
      ? "Inbound"
      : item.direction === "outbound"
      ? "Outbound"
      : "Internal";
  const directionVariant: "destructive" | "secondary" | "outline" =
    item.direction === "inbound"
      ? "secondary"
      : item.direction === "outbound"
      ? "outline"
      : "outline";
  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] capitalize">
          {item.level}
        </Badge>
        <Badge variant={directionVariant} className="text-[10px]">
          {directionLabel}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {item.dependencyTypeLabel}
        </Badge>
        {item.isAttention && (
          <Badge variant="destructive" className="text-[10px]">
            Attention
          </Badge>
        )}
      </div>
      <div className="mt-1.5 text-sm text-foreground flex flex-wrap items-center gap-1.5 min-w-0">
        <DependencyEndpointLabel endpoint={item.source} />
        <span className="text-muted-foreground">→</span>
        <DependencyEndpointLabel endpoint={item.target} />
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        Updated{" "}
        <time dateTime={item.updatedAt}>
          {new Date(item.updatedAt).toLocaleDateString()}
        </time>
      </div>
    </li>
  );
}

function DependencyEndpointLabel({
  endpoint,
}: {
  endpoint: RoadmapStatusPackDependencyItem["source"];
}) {
  return (
    <span
      className={
        endpoint.inScope
          ? "font-medium text-foreground"
          : "font-medium text-muted-foreground italic"
      }
      title={
        endpoint.inScope
          ? `${endpoint.workspaceName ?? ""}${
              endpoint.programName ? " · " + endpoint.programName : ""
            }`
          : "Outside current Roadmap scope or not authorized"
      }
    >
      {endpoint.projectName}
      {endpoint.inScope && endpoint.workspaceName && (
        <span className="ml-1 text-[11px] font-normal text-muted-foreground">
          ({endpoint.workspaceName})
        </span>
      )}
    </span>
  );
}

/* ───── KPIs (live) — Phase 6A.9 ───── */

function KpisBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading || preview.kpisLoading) return <LoadingRows lines={6} />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for KPIs." />
    );
  }
  const k: RoadmapStatusPackKpis = preview.data.kpis;

  const description = (
    <p className="text-xs text-muted-foreground">
      Current KPI values use the same latest-reading precedence as the
      project KPI surface: latest{" "}
      <span className="font-medium text-foreground">official snapshot</span>{" "}
      (if reportable), then latest{" "}
      <span className="font-medium text-foreground">manual update</span>,
      then the KPI definition's current value. When the latest official
      snapshot is not reportable, no older snapshot or manual value is
      substituted — the KPI is shown as "Latest snapshot not reportable".
    </p>
  );


  if (k.projectsInScope === 0) {
    return (
      <div className="space-y-3">
        {description}
        <EmptyState message="No projects match the current Roadmap filters." />
      </div>
    );
  }

  if (k.dataStatus === "unavailable") {
    return (
      <div className="space-y-3">
        {description}
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {k.unavailableReason ??
              "KPIs require an authorized roadmap-level resolver before they can be shown here."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {description}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
        <StatTile label="KPIs in scope" value={k.totalKpis} />
        <StatTile
          label="With latest update"
          value={k.withLatestUpdate}
          hint={k.totalKpis > 0 ? `of ${k.totalKpis}` : undefined}
        />
        <StatTile
          label="Missing snapshot & update"
          value={k.missingUpdateHistory}
          hint={k.missingUpdateHistory > 0 ? "No snapshot or manual update" : undefined}
        />
        <StatTile
          label="Stale (>30d)"
          value={k.staleCount}
          hint={k.staleCount > 0 ? "Latest reading over 30 days old" : undefined}
        />
        <StatTile
          label="On target"
          value={k.onTargetCount}
          hint={k.unknownStatusCount > 0 ? `${k.unknownStatusCount} unknown` : undefined}
        />
        <StatTile
          label="Off target"
          value={k.offTargetCount}
          hint={k.offTargetCount > 0 ? "Versus configured target" : undefined}
        />
      </div>

      {k.coverageNotes.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
          {k.coverageNotes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {k.totalKpis === 0 ? (
        <EmptyState message="No project-level KPIs are defined for the selected scope." />
      ) : (
        <div className="space-y-4">
          {k.attentionItems.length > 0 && (
            <KpiBlock
              title="Attention needed"
              hint="Off target, stale, missing snapshot & update, or attached to a red/behind-schedule project."
              items={k.attentionItems}
            />
          )}
          <KpiBlock
            title="Recently updated"
            hint="Most recent KPI reading first (official snapshot or manual update)."
            items={k.recentlyUpdatedItems.slice(0, 10)}
          />
          {k.staleItems.length > 0 && (
            <KpiBlock
              title="Stale"
              hint="Latest reading is older than 30 days."
              items={k.staleItems}
            />
          )}
          {k.missingHistoryItems.length > 0 && (
            <KpiBlock
              title="Missing snapshot & update"
              hint="No official snapshot and no manual update recorded yet."
              items={k.missingHistoryItems}
            />
          )}
        </div>
      )}

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Read-only presentation projection. KPI edit, drill-down, and chart
        controls are not enabled in this view.
      </div>
    </div>
  );
}

function KpiBlock({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: readonly RoadmapStatusPackKpiItem[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
          <span className="ml-1 text-muted-foreground/70">({items.length})</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      {items.length === 0 ? (
        <EmptyState message="None." />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <KpiRow key={item.definitionId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function formatKpiValue(
  value: number | null,
  unit: string | null,
  _direction?: string | null,
): string {
  if (value === null || value === undefined) return "—";
  const str = Number.isInteger(value) ? String(value) : String(value);
  return unit ? `${str} ${unit}` : str;
}

function kpiStatusLabel(status: RoadmapStatusPackKpiItem["status"]): string {
  switch (status) {
    case "on_target":
      return "On target";
    case "off_target":
      return "Off target";
    case "no_target":
      return "No target set";
    case "no_value":
      return "No value yet";
    default:
      return "Unknown";
  }
}

function kpiTrendLabel(trend: RoadmapStatusPackKpiItem["trend"]): string {
  switch (trend) {
    case "improving":
      return "Trend: improving";
    case "declining":
      return "Trend: declining";
    case "flat":
      return "Trend: flat";
    case "insufficient_history":
      return "Trend: needs more history";
    default:
      return "Trend: unavailable";
  }
}

function kpiSourceLabel(
  source: RoadmapStatusPackKpiItem["latestValueSource"],
): string | null {
  switch (source) {
    case "official_snapshot":
      return "Official snapshot";
    case "official_snapshot_unavailable":
      return "Latest snapshot not reportable";
    case "manual_update":
      return "Manual update";
    case "definition_current_value":
      return "Definition current value";
    default:
      return null;
  }
}

function KpiRow({ item }: { item: RoadmapStatusPackKpiItem }) {
  const statusVariant: "destructive" | "secondary" | "outline" =
    item.status === "off_target"
      ? "destructive"
      : item.status === "on_target"
      ? "secondary"
      : "outline";
  const sourceLabel = kpiSourceLabel(item.latestValueSource);
  const isSnapshotUnavailable =
    item.latestValueSource === "official_snapshot_unavailable";
  const currentValueDisplay = isSnapshotUnavailable
    ? "Not reportable"
    : formatKpiValue(
        item.latestValue ?? item.currentValue,
        item.unit,
        item.targetDirection,
      );
  const lastReadingLabel =
    item.latestValueSource === "official_snapshot" ||
    item.latestValueSource === "official_snapshot_unavailable"
      ? "Last snapshot: "
      : "Last update: ";
  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant} className="text-[10px]">
          {kpiStatusLabel(item.status)}
        </Badge>
        {sourceLabel && (
          <Badge
            variant={isSnapshotUnavailable ? "secondary" : "outline"}
            className="text-[10px]"
            title={
              isSnapshotUnavailable && item.latestSnapshotCalculationStatus
                ? `Latest snapshot calculation_status="${item.latestSnapshotCalculationStatus}"`
                : undefined
            }
          >
            {sourceLabel}
          </Badge>
        )}
        {item.freshness === "stale" && (
          <Badge variant="destructive" className="text-[10px]">
            Stale
          </Badge>
        )}
        {item.missingUpdateHistory && (
          <Badge variant="outline" className="text-[10px]">
            No snapshot or update yet
          </Badge>
        )}
        {item.projectAttention && (
          <Badge variant="destructive" className="text-[10px]">
            Project attention
          </Badge>
        )}
      </div>
      <div className="mt-1.5 text-sm font-medium text-foreground truncate">
        {item.name}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
        {item.projectName}
        {item.workspaceName && (
          <span className="ml-1">· {item.workspaceName}</span>
        )}
        {item.programName && <span className="ml-1">· {item.programName}</span>}
      </div>
      <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <div>
          <span className="text-muted-foreground/70">Current: </span>
          <span className="text-foreground font-medium">
            {currentValueDisplay}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground/70">Target: </span>
          <span className="text-foreground font-medium">
            {formatKpiValue(item.targetValue, item.unit, item.targetDirection)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground/70">{lastReadingLabel}</span>
          <span className="text-foreground font-medium">
            {item.latestValueDate
              ? new Date(item.latestValueDate).toLocaleDateString()
              : item.latestValueSource === "definition_current_value"
              ? "—"
              : "No snapshot or update yet"}
          </span>
        </div>
        <div className="truncate" title={kpiTrendLabel(item.trend)}>
          {kpiTrendLabel(item.trend)}
        </div>
      </div>
    </li>
  );
}



/* ───── Governance / Decisions / Asks (live) — Phase 6A.10 ───── */

function GovernanceBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading || preview.governanceLoading) {
    return <LoadingRows lines={6} />;
  }
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for Governance / Decisions / Asks." />
    );
  }
  const g: RoadmapStatusPackGovernance = preview.data.governance;

  const description = (
    <p className="text-xs text-muted-foreground">
      Governance records and decision items for the selected Roadmap scope.
      Items derive from canonical{" "}
      <span className="font-medium text-foreground">BTPM governance records</span>{" "}
      (general evidence records + decision cases). Asks are not separately
      classified yet in the data model.
    </p>
  );

  if (g.projectsInScope === 0) {
    return (
      <div className="space-y-3">
        {description}
        <EmptyState message="No projects match the current Roadmap filters." />
      </div>
    );
  }

  if (g.dataStatus === "unavailable") {
    return (
      <div className="space-y-3">
        {description}
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {g.unavailableReason ??
              "Governance records require an authorized roadmap-level resolver before they can be shown here."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {description}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
        <StatTile label="Records in scope" value={g.totalRecords} />
        <StatTile
          label="Decisions required"
          value={g.decisionsRequiredCount}
          hint={g.decisionCasesCount > 0 ? `of ${g.decisionCasesCount} decisions` : "Decision cases"}
        />
        <StatTile
          label="Decisions made"
          value={g.decisionsMadeCount}
          hint="Decided or closed"
        />
        <StatTile
          label="Evidence records"
          value={g.evidenceRecordsCount}
          hint="General governance"
        />
        <StatTile
          label="Overdue decisions"
          value={g.overdueCount}
          hint={g.overdueCount > 0 ? "Past target decision date" : undefined}
        />
        <StatTile
          label="Stale items"
          value={g.staleCount}
          hint={g.staleCount > 0 ? "No update in 60+ days" : "Last 60 days"}
        />
      </div>

      {g.coverageNotes.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
          {g.coverageNotes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {g.partial && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
          Partial coverage: governance data could not be loaded for {g.projectsFailed}{" "}
          of {g.projectsInScope} projects in scope.
        </div>
      )}

      {g.totalRecords === 0 ? (
        <EmptyState message="No governance records exist for the selected scope." />
      ) : (
        <div className="space-y-4">
          <GovernanceBlock
            title="Decisions required"
            hint="Decision cases that are not yet decided or closed."
            items={g.decisionsRequired}
            emptyMessage="No open decision cases in scope."
          />
          <GovernanceBlock
            title="Open asks"
            hint='No separate "ask" object exists in the current model yet.'
            items={[]}
            emptyMessage="Asks are not separately classified yet."
          />
          <GovernanceBlock
            title="Recent decisions"
            hint="Decision cases marked decided or closed."
            items={g.recentDecisions}
            emptyMessage="No recent decisions in scope."
          />
          <GovernanceBlock
            title="Recent governance records"
            hint="Most recent general evidence / cadence records."
            items={g.recentGovernanceRecords}
            emptyMessage="No recent governance records in scope."
          />
          {g.overdueOrStaleItems.length > 0 && (
            <GovernanceBlock
              title="Overdue or stale items"
              hint="Decisions past their target date or items not updated in 60+ days."
              items={g.overdueOrStaleItems}
              emptyMessage="None."
            />
          )}
        </div>
      )}

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Read-only presentation projection. Governance edit, drill-down, and
        cadence controls are not enabled in this view.
      </div>
    </div>
  );
}

function GovernanceBlock({
  title,
  hint,
  items,
  emptyMessage,
}: {
  title: string;
  hint: string;
  items: readonly RoadmapStatusPackGovernanceItem[];
  emptyMessage: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
          <span className="ml-1 text-muted-foreground/70">({items.length})</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      {items.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <GovernanceRow key={item.recordId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function governanceDecisionStatusLabel(
  s: RoadmapStatusPackGovernanceItem["decisionStatus"],
): string {
  switch (s) {
    case "not_started":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "pending_decision":
      return "Pending decision";
    case "decided":
      return "Decided";
    case "closed":
      return "Closed";
    default:
      return "—";
  }
}

function GovernanceRow({ item }: { item: RoadmapStatusPackGovernanceItem }) {
  const isDecision = item.recordKind === "decision_case";
  const statusVariant: "destructive" | "secondary" | "outline" =
    item.isOverdue
      ? "destructive"
      : item.decisionStatus === "decided" || item.decisionStatus === "closed"
      ? "secondary"
      : "outline";
  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isDecision ? "secondary" : "outline"} className="text-[10px]">
          {isDecision ? "Decision case" : "Evidence record"}
        </Badge>
        {isDecision && (
          <Badge variant={statusVariant} className="text-[10px]">
            {governanceDecisionStatusLabel(item.decisionStatus)}
          </Badge>
        )}
        {item.isOverdue && (
          <Badge variant="destructive" className="text-[10px]">
            Overdue
          </Badge>
        )}
        {item.isStale && (
          <Badge variant="outline" className="text-[10px]">
            Stale
          </Badge>
        )}
        {item.projectAttention && (
          <Badge variant="destructive" className="text-[10px]">
            Project attention
          </Badge>
        )}
        {item.hasSharepointEvidence && (
          <Badge variant="outline" className="text-[10px]">
            Evidence linked
          </Badge>
        )}
      </div>
      <div className="mt-1.5 text-sm font-medium text-foreground truncate">
        {item.title}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
        {item.projectName}
        {item.workspaceName && <span className="ml-1">· {item.workspaceName}</span>}
        {item.programName && <span className="ml-1">· {item.programName}</span>}
      </div>
      {(item.decisionQuestion || item.summary) && (
        <div className="mt-1 text-[11px] text-foreground/80 line-clamp-2">
          {item.decisionQuestion ?? item.summary}
        </div>
      )}
      <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <div>
          <span className="text-muted-foreground/70">Held: </span>
          <span className="text-foreground font-medium">
            {item.actualDateHeld
              ? new Date(item.actualDateHeld).toLocaleDateString()
              : "—"}
          </span>
        </div>
        {isDecision && (
          <div>
            <span className="text-muted-foreground/70">Target: </span>
            <span className="text-foreground font-medium">
              {item.targetDecisionDate
                ? new Date(item.targetDecisionDate).toLocaleDateString()
                : "—"}
            </span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground/70">Updated: </span>
          <span className="text-foreground font-medium">
            {new Date(item.updatedAt).toLocaleDateString()}
          </span>
        </div>
        {item.decisionCount > 0 && (
          <div>
            <span className="text-muted-foreground/70">Decisions: </span>
            <span className="text-foreground font-medium">{item.decisionCount}</span>
          </div>
        )}
      </div>
    </li>
  );
}

/* ───── Progress Since Last Period (live) — Phase 6A.11 ───── */

function progressCategoryLabel(c: RoadmapStatusPackProgressItem["category"]): string {
  switch (c) {
    case "completed_delivered":
      return "Completed";
    case "schedule_movement":
      return "Schedule";
    case "governance_decision":
      return "Governance";
    case "risk_blocker_kpi":
      return "Risk / Blocker / KPI";
    case "ownership_metadata":
      return "Ownership / Edits";
    case "lifecycle_stage":
      return "Lifecycle / Stage";
    default:
      return "Other";
  }
}

function ProgressSinceLastBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading || preview.progressLoading) {
    return <LoadingRows lines={6} />;
  }
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for Progress Since Last Period." />
    );
  }
  const p: RoadmapStatusPackProgressSinceLast = preview.data.progressSinceLast;

  const description = (
    <p className="text-xs text-muted-foreground">
      Recent progress, changes, and updates for the selected Roadmap scope.
      Items derive from canonical{" "}
      <span className="font-medium text-foreground">BTPM activity events</span>{" "}
      (project tree: project, phases, tasks, blockers, risks, KPIs).
    </p>
  );

  const periodBadge = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="text-[10px]">
        Period: {p.period.label}
      </Badge>
      <span className="text-[10px] text-muted-foreground">
        Default lookback — not a comparison against a previously generated pack.
      </span>
    </div>
  );

  if (p.projectsInScope === 0) {
    return (
      <div className="space-y-3">
        {description}
        {periodBadge}
        <EmptyState message="No projects match the current Roadmap filters." />
      </div>
    );
  }

  if (p.dataStatus === "unavailable") {
    return (
      <div className="space-y-3">
        {description}
        {periodBadge}
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {p.unavailableReason ??
              "Progress since last period requires an authorized roadmap-level traceability resolver before it can be shown here."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {description}
      {periodBadge}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
        <StatTile label="Changes in period" value={p.totalEventsInPeriod} />
        <StatTile
          label="Completed / delivered"
          value={p.completedDeliveredCount}
          hint="Explicit completion events"
        />
        <StatTile
          label="Schedule movements"
          value={p.scheduleMovementCount}
          hint="Plan, baseline, resize"
        />
        <StatTile
          label="Governance / decisions"
          value={p.governanceDecisionCount}
          hint="Governance events"
        />
        <StatTile
          label="Risk / blocker / KPI"
          value={p.riskBlockerKpiCount}
          hint="Status movements"
        />
        <StatTile
          label="Execution updates"
          value={"—"}
          hint="Not available in this view"
        />
      </div>

      {p.coverageNotes.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
          {p.coverageNotes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {p.partial && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
          Partial coverage: progress activity could not be loaded for{" "}
          {p.projectsFailed} of {p.projectsInScope} projects in scope.
        </div>
      )}

      {p.totalEventsInPeriod === 0 ? (
        <EmptyState message={`No progress events recorded in the ${p.period.label.toLowerCase()} for the selected scope.`} />
      ) : (
        <div className="space-y-4">
          <ProgressBlock
            title="Completed / delivered"
            hint="Explicit task/phase/project completion events."
            items={p.completedDelivered}
            emptyMessage="No completions in this period."
          />
          <ProgressBlock
            title="Schedule movements"
            hint="Plan changes, baseline events, phase resize/shift."
            items={p.scheduleMovements}
            emptyMessage="No schedule movements in this period."
          />
          <ProgressBlock
            title="Governance / decision updates"
            hint="Governance record activity."
            items={p.governanceDecisionUpdates}
            emptyMessage="No governance events in this period."
          />
          <ProgressBlock
            title="Risk / blocker / KPI changes"
            hint="Status movements on risks, blockers, and KPIs."
            items={p.riskBlockerKpiChanges}
            emptyMessage="No risk / blocker / KPI movements in this period."
          />
          <ProgressBlock
            title="Other recent activity"
            hint="Lifecycle, stage, ownership, and metadata edits."
            items={p.otherRecentActivity}
            emptyMessage="No other recent activity in this period."
          />
        </div>
      )}

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Read-only presentation projection. Progress edits, drill-downs, and
        period controls are not enabled in this view.
      </div>
    </div>
  );
}

function ProgressBlock({
  title,
  hint,
  items,
  emptyMessage,
}: {
  title: string;
  hint: string;
  items: readonly RoadmapStatusPackProgressItem[];
  emptyMessage: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
          <span className="ml-1 text-muted-foreground/70">({items.length})</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      {items.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <ProgressRow key={item.eventId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProgressRow({ item }: { item: RoadmapStatusPackProgressItem }) {
  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={item.important ? "secondary" : "outline"} className="text-[10px]">
          {progressCategoryLabel(item.category)}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {item.targetType}
        </Badge>
        <span className="text-[10px] text-muted-foreground font-mono">
          {item.eventType}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground truncate">
        {item.projectName}
        {item.workspaceName && <span className="ml-1">· {item.workspaceName}</span>}
        {item.programName && <span className="ml-1">· {item.programName}</span>}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {new Date(item.occurredAt).toLocaleString()}
      </div>
    </li>
  );
}

/* ───── Team Work Summary (live) — Phase 6A.12 ───── */

function TeamWorkSummaryBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading || preview.teamWorkLoading) {
    return <LoadingRows lines={6} />;
  }
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for Team Work Summary." />
    );
  }
  const tw: RoadmapStatusPackTeamWorkSummary = preview.data.teamWorkSummary;

  const description = (
    <p className="text-xs text-muted-foreground">
      Team workload, overdue work, and upcoming work for the selected Roadmap
      scope. Items derive from canonical{" "}
      <span className="font-medium text-foreground">
        BTPM project / phase / task / assignment / blocker
      </span>{" "}
      data via the authorized Team Work overview.
    </p>
  );

  const windowBadge = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="text-[10px]">
        Open work only
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        Due-soon window: next {tw.dueSoonWindowDays} days
      </Badge>
    </div>
  );

  if (tw.projectsInScope === 0) {
    return (
      <div className="space-y-3">
        {description}
        {windowBadge}
        <EmptyState message="No projects match the current Roadmap filters." />
      </div>
    );
  }

  if (tw.dataStatus === "unavailable") {
    return (
      <div className="space-y-3">
        {description}
        {windowBadge}
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {tw.unavailableReason ??
              "Team Work Summary requires an authorized roadmap-level work resolver before it can be shown here."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {description}
      {windowBadge}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-sm">
        <StatTile label="Open work" value={tw.totalOpen} />
        <StatTile label="Overdue" value={tw.overdueCount} hint="Past due date" />
        <StatTile
          label="Due soon"
          value={tw.dueTodayCount + tw.dueSoonCount}
          hint={`Today + next ${tw.dueSoonWindowDays}d`}
        />
        <StatTile label="High priority" value={tw.highPriorityCount} />
        <StatTile label="Unassigned" value={tw.unassignedCount} />
        <StatTile label="Blocked" value={tw.blockedCount} />
        <StatTile
          label="Owners"
          value={tw.ownersRepresented}
          hint="Distinct assignees"
        />
      </div>

      {tw.coverageNotes.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
          {tw.coverageNotes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {tw.partial && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
          Partial coverage: Team Work could not be loaded for {tw.projectsFailed}{" "}
          of {tw.projectsInScope} projects in scope.
        </div>
      )}

      {tw.totalOpen === 0 ? (
        <EmptyState message="No open Team Work items for the selected Roadmap scope." />
      ) : (
        <div className="space-y-4">
          <TeamWorkBlock
            title="Overdue work"
            hint="Past due date, attention-first."
            items={tw.overdueWork}
            emptyMessage="No overdue work in scope."
          />
          <TeamWorkBlock
            title="Due soon"
            hint={`Due today or within the next ${tw.dueSoonWindowDays} days.`}
            items={tw.dueSoonWork}
            emptyMessage="No work due in the upcoming window."
          />
          <TeamWorkBlock
            title="High-priority open work"
            hint="Items flagged as high priority in source data."
            items={tw.highPriorityOpenWork}
            emptyMessage="No high-priority open work in scope."
          />
          <TeamWorkBlock
            title="Unassigned work"
            hint="Open tasks with no assignee."
            items={tw.unassignedWork}
            emptyMessage="No unassigned open work in scope."
          />
          <TeamWorkOwnerWorkloadBlock owners={tw.ownerWorkload} />
        </div>
      )}

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Summary view only — detailed per-task annex, drill-downs, and work
        editing are not enabled here.
      </div>
    </div>
  );
}

function TeamWorkBlock({
  title,
  hint,
  items,
  emptyMessage,
}: {
  title: string;
  hint: string;
  items: readonly RoadmapStatusPackTeamWorkItem[];
  emptyMessage: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
          <span className="ml-1 text-muted-foreground/70">
            ({items.length})
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      {items.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <TeamWorkRow key={item.taskId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamWorkRow({ item }: { item: RoadmapStatusPackTeamWorkItem }) {
  const dueLabel = (() => {
    if (item.isOverdue) {
      return `Overdue by ${item.daysOverdue} day${item.daysOverdue === 1 ? "" : "s"}`;
    }
    if (item.isDueToday) return "Due today";
    if (item.daysUntilDue !== null && item.daysUntilDue >= 0) {
      return `Due in ${item.daysUntilDue} day${item.daysUntilDue === 1 ? "" : "s"}`;
    }
    return item.dueDate ? `Due ${item.dueDate}` : "No due date";
  })();

  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {item.isOverdue && (
          <Badge variant="destructive" className="text-[10px]">
            Overdue
          </Badge>
        )}
        {item.isDueToday && (
          <Badge variant="secondary" className="text-[10px]">
            Due today
          </Badge>
        )}
        {item.isHighPriority && (
          <Badge variant="secondary" className="text-[10px]">
            High priority
          </Badge>
        )}
        {item.isBlocked && (
          <Badge variant="outline" className="text-[10px]">
            Blocked ({item.openBlockerCount})
          </Badge>
        )}
        {item.isUnassigned && (
          <Badge variant="outline" className="text-[10px]">
            Unassigned
          </Badge>
        )}
        <Badge className={`text-[10px] ${getPmWorkflowStatusBadgeClass(item.taskStatus)}`}>
          {getPmWorkflowStatusLabel(item.taskStatus)}
        </Badge>
      </div>
      <div className="mt-1 text-sm text-foreground font-medium truncate">
        {item.taskName}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
        {item.projectName}
        {item.phaseName && <span className="ml-1">· {item.phaseName}</span>}
        {item.workspaceName && (
          <span className="ml-1">· {item.workspaceName}</span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground flex flex-wrap gap-x-3">
        <span>{dueLabel}</span>
        <span>
          Owner:{" "}
          <span className="text-foreground">
            {item.assigneeName ?? (item.isUnassigned ? "Unassigned" : "—")}
          </span>
        </span>
      </div>
    </li>
  );
}

function TeamWorkOwnerWorkloadBlock({
  owners,
}: {
  owners: readonly RoadmapStatusPackTeamWorkOwnerSummary[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Owner / assignee workload
          <span className="ml-1 text-muted-foreground/70">({owners.length})</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          Open tasks by owner, attention-first.
        </span>
      </div>
      {owners.length === 0 ? (
        <EmptyState message="No owners represented in the current scope." />
      ) : (
        <ul className="space-y-1.5">
          {owners.map((o) => (
            <li
              key={o.assigneeId ?? "__unassigned__"}
              className="rounded-md border bg-card px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
            >
              <span className="text-sm font-medium text-foreground">
                {o.assigneeName}
              </span>
              <span className="text-muted-foreground">
                Open: <span className="text-foreground">{o.openTasks}</span>
              </span>
              <span className="text-muted-foreground">
                Overdue:{" "}
                <span className="text-foreground">{o.overdueTasks}</span>
              </span>
              <span className="text-muted-foreground">
                Due soon:{" "}
                <span className="text-foreground">{o.dueSoonTasks}</span>
              </span>
              <span className="text-muted-foreground">
                High priority:{" "}
                <span className="text-foreground">{o.highPriorityTasks}</span>
              </span>
              <span className="text-muted-foreground">
                Blocked:{" "}
                <span className="text-foreground">{o.blockedTasks}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───── Project Detail Annex (live) ───── */

function ProjectDetailAnnexBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading || preview.projectDetailAnnexLoading) {
    return <LoadingRows lines={8} />;
  }
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for the Project Detail Annex." />
    );
  }
  const annex: RoadmapStatusPackProjectDetailAnnex =
    preview.data.projectDetailAnnex;

  const description = (
    <p className="text-xs text-muted-foreground">
      Bounded project-level detail for the selected Roadmap scope. Values
      derive from canonical{" "}
      <span className="font-medium text-foreground">
        BTPM project / reporting summary / risks / blockers / KPIs / governance
        / Team Work / activity
      </span>{" "}
      data via already-authorized read paths used by other Status Pack
      sections.
    </p>
  );

  const lookbackBadge = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="text-[10px]">
        Recent activity lookback: last {annex.recentActivityLookbackDays} days
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        Open work only
      </Badge>
    </div>
  );

  if (annex.projectsInScope === 0) {
    return (
      <div className="space-y-3">
        {description}
        {lookbackBadge}
        <EmptyState message="No projects match the current Roadmap filters." />
      </div>
    );
  }

  if (annex.dataStatus === "unavailable") {
    return (
      <div className="space-y-3">
        {description}
        {lookbackBadge}
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {annex.unavailableReason ??
              "Project Detail Annex requires authorized project detail data before it can be shown here."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {description}
      {lookbackBadge}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
        <StatTile label="Projects in annex" value={annex.projectsInAnnex} />
        <StatTile
          label="Needing attention"
          value={annex.projectsNeedingAttention}
          hint="Any attention flag beyond high-priority"
        />
        <StatTile
          label="Schedule attention"
          value={annex.scheduleAttentionCount}
          hint="Red / behind / overdue target"
        />
        <StatTile
          label="Risk / blocker attention"
          value={annex.riskBlockerAttentionCount}
          hint="Open risks or blockers"
        />
        <StatTile
          label="Governance / work attention"
          value={annex.kpiGovernanceWorkAttentionCount}
          hint="Projects with governance or work attention"
        />
        <StatTile
          label="Missing reporting"
          value={annex.projectsMissingReporting}
          hint="No reporting summary visible"
        />
      </div>

      {annex.coverageNotes.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
          {annex.coverageNotes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {annex.partial && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
          Partial coverage: some project detail dimensions could not be loaded
          for the full scope. Per-project rows show the available subset.
        </div>
      )}

      <ul className="space-y-2">
        {annex.items.map((item) => (
          <ProjectDetailAnnexRow key={item.projectId} item={item} />
        ))}
      </ul>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Annex view only — drill-downs, project / phase / task editing, and the
        detailed Team Work annex are not enabled here.
      </div>
    </div>
  );
}

const ATTENTION_FLAG_LABELS: Record<string, string> = {
  red_health: "Red health",
  amber_health: "Amber health",
  behind_schedule: "Behind schedule",
  overdue_target: "Overdue target",
  no_schedule_basis: "No schedule basis",
  missing_reporting: "Missing reporting",
  open_risks: "Open risks",
  open_blockers: "Open blockers",
  // kpi_attention intentionally removed — annex does not derive KPI attention.
  governance_attention: "Governance attention",
  work_overdue: "Work overdue",
  work_due_soon: "Work due soon",
  high_priority: "High priority",
};

function ProjectDetailAnnexRow({
  item,
}: {
  item: RoadmapStatusPackProjectDetailItem;
}) {
  const fmtCount = (v: number | null) => (v === null ? "—" : String(v));
  const fmtPct = (v: number | null) =>
    v === null ? "—" : `${Math.round(v)}%`;
  const fmtDate = (v: string | null) => (v ? v.slice(0, 10) : "—");

  return (
    <li className="rounded-md border bg-card px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground truncate">
          {item.projectName}
        </span>
        {item.healthLabel && (
          <Badge
            variant={
              item.healthRag === "red"
                ? "destructive"
                : item.healthRag === "amber"
                ? "secondary"
                : "outline"
            }
            className="text-[10px]"
          >
            {item.healthLabel}
          </Badge>
        )}
        {item.scheduleLabel && (
          <Badge variant="outline" className="text-[10px]">
            {item.scheduleLabel}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px]">
          {item.statusLabel}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {item.priorityLabel}
        </Badge>
        {item.isOverdueTarget && (
          <Badge variant="destructive" className="text-[10px]">
            Overdue target
          </Badge>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground truncate">
        {item.workspaceName ?? "—"}
        {item.programName && <span className="ml-1">· {item.programName}</span>}
        {item.projectStage && (
          <span className="ml-1">· Stage: {item.projectStage}</span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">
          Start: <span className="text-foreground">{fmtDate(item.startDate)}</span>
        </span>
        <span className="text-muted-foreground">
          Target end:{" "}
          <span className="text-foreground">{fmtDate(item.targetEndDate)}</span>
        </span>
        <span className="text-muted-foreground">
          Completion:{" "}
          <span className="text-foreground">
            {item.hasReportingSummary ? fmtPct(item.completionPercent) : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Open risks:{" "}
          <span className="text-foreground">
            {item.risksBlockersAvailable ? fmtCount(item.openRisksCount) : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Open blockers:{" "}
          <span className="text-foreground">
            {item.risksBlockersAvailable
              ? fmtCount(item.openBlockersCount)
              : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          KPIs:{" "}
          <span className="text-foreground">
            {item.kpisAvailable ? fmtCount(item.kpiCount) : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Governance:{" "}
          <span className="text-foreground">
            {item.governanceAvailable
              ? `${fmtCount(item.governanceTotalCount)} (${fmtCount(item.governanceAttentionCount)} attn)`
              : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Open work:{" "}
          <span className="text-foreground">
            {item.teamWorkAvailable ? fmtCount(item.openWorkCount) : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Overdue work:{" "}
          <span className="text-foreground">
            {item.teamWorkAvailable ? fmtCount(item.overdueWorkCount) : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Due soon:{" "}
          <span className="text-foreground">
            {item.teamWorkAvailable ? fmtCount(item.dueSoonWorkCount) : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Recent activity:{" "}
          <span className="text-foreground">
            {item.recentActivityAvailable
              ? fmtCount(item.recentActivityCount)
              : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Latest activity:{" "}
          <span className="text-foreground">
            {item.recentActivityAvailable
              ? fmtDate(item.latestActivityAt)
              : "—"}
          </span>
        </span>
      </div>

      {item.attentionFlags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.attentionFlags.map((f) => (
            <Badge
              key={f}
              variant={
                f === "red_health" || f === "overdue_target" || f === "work_overdue"
                  ? "destructive"
                  : "secondary"
              }
              className="text-[10px]"
            >
              {ATTENTION_FLAG_LABELS[f] ?? f}
            </Badge>
          ))}
        </div>
      )}

      {item.coverageNotes.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          {item.coverageNotes.join(" · ")}
        </div>
      )}
    </li>
  );
}

/* ───── Team Work Detail Annex (live) — Phase 6A.14 ───── */

function TeamWorkDetailAnnexBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading || preview.teamWorkDetailAnnexLoading) {
    return <LoadingRows lines={8} />;
  }
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not load Roadmap projects for the Team Work Detail Annex." />
    );
  }
  const annex: RoadmapStatusPackTeamWorkDetailAnnex =
    preview.data.teamWorkDetailAnnex;

  const description = (
    <p className="text-xs text-muted-foreground">
      Detailed work items for the selected Roadmap scope. Rows derive from
      canonical{" "}
      <span className="font-medium text-foreground">
        BTPM project / phase / task / assignment / blocker
      </span>{" "}
      data via the authorized Team Work overview (same path as the Team Work
      Summary).
    </p>
  );

  const windowBadge = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="text-[10px]">
        Open work only
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        Due-soon window: next {annex.dueSoonWindowDays} days
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        Row cap: {annex.displayCap}
      </Badge>
    </div>
  );

  if (annex.projectsInScope === 0) {
    return (
      <div className="space-y-3">
        {description}
        {windowBadge}
        <EmptyState message="No projects match the current Roadmap filters." />
      </div>
    );
  }

  if (annex.dataStatus === "unavailable") {
    return (
      <div className="space-y-3">
        {description}
        {windowBadge}
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {annex.unavailableReason ??
              "Team Work Detail Annex requires authorized detailed Team Work rows before it can be shown here."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {description}
      {windowBadge}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-sm">
        <StatTile label="Work items available" value={annex.totalAvailable} />
        <StatTile label="Rows shown" value={annex.rowsShown} hint={`Capped at ${annex.displayCap}`} />
        <StatTile label="Overdue" value={annex.overdueCount} hint="Past due date" />
        <StatTile
          label="Due soon"
          value={annex.dueTodayCount + annex.dueSoonCount}
          hint={`Today + next ${annex.dueSoonWindowDays}d`}
        />
        <StatTile label="High priority" value={annex.highPriorityCount} />
        <StatTile label="Unassigned" value={annex.unassignedCount} />
        <StatTile
          label="Projects partial"
          value={annex.projectsFailed}
          hint="Team Work not loaded"
        />
      </div>

      {annex.coverageNotes.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
          {annex.coverageNotes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {annex.partial && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
          Partial coverage: Team Work could not be loaded for{" "}
          {annex.projectsFailed} of {annex.projectsInScope} projects in scope.
          Rows below reflect the authorized, available subset only.
        </div>
      )}

      {annex.items.length === 0 ? (
        <EmptyState message="No open Team Work items for the selected Roadmap scope." />
      ) : (
        <ul className="space-y-2">
          {annex.items.map((item) => (
            <TeamWorkDetailAnnexRow key={item.taskId} item={item} />
          ))}
        </ul>
      )}

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Detail annex view only — drill-downs, navigation, and work editing are
        not enabled here.
      </div>
    </div>
  );
}

function TeamWorkDetailAnnexRow({
  item,
}: {
  item: RoadmapStatusPackTeamWorkDetailItem;
}) {
  const dueLabel = (() => {
    if (item.isOverdue) {
      return `Overdue by ${item.daysOverdue} day${item.daysOverdue === 1 ? "" : "s"}`;
    }
    if (item.isDueToday) return "Due today";
    if (item.daysUntilDue !== null && item.daysUntilDue >= 0) {
      return `Due in ${item.daysUntilDue} day${item.daysUntilDue === 1 ? "" : "s"}`;
    }
    return item.dueDate ? `Due ${item.dueDate}` : "No due date";
  })();

  const priorityLabel =
    item.priorityBucket === "unset"
      ? item.rawPriority ?? "—"
      : item.priorityBucket;

  return (
    <li className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {item.isOverdue && (
          <Badge variant="destructive" className="text-[10px]">
            Overdue
          </Badge>
        )}
        {item.isDueToday && (
          <Badge variant="secondary" className="text-[10px]">
            Due today
          </Badge>
        )}
        {item.isDueSoon && (
          <Badge variant="secondary" className="text-[10px]">
            Due soon
          </Badge>
        )}
        {item.isHighPriority && (
          <Badge variant="secondary" className="text-[10px]">
            High priority
          </Badge>
        )}
        {item.isBlocked && (
          <Badge variant="outline" className="text-[10px]">
            Blocked ({item.openBlockerCount})
          </Badge>
        )}
        {item.isUnassigned && (
          <Badge variant="outline" className="text-[10px]">
            Unassigned
          </Badge>
        )}
        <Badge className={`text-[10px] ${getPmWorkflowStatusBadgeClass(item.taskStatus)}`}>
          {getPmWorkflowStatusLabel(item.taskStatus)}
        </Badge>
        <Badge className={`text-[10px] ${getPmPriorityBadgeClass(item.rawPriority)}`}>
          {item.rawPriority ? getPmPriorityLabel(item.rawPriority) : priorityLabel}
        </Badge>
      </div>
      <div className="mt-1 text-sm text-foreground font-medium truncate">
        {item.taskName}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
        {item.projectName}
        {item.phaseName && <span className="ml-1">· {item.phaseName}</span>}
        {item.workspaceName && (
          <span className="ml-1">· {item.workspaceName}</span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground flex flex-wrap gap-x-3">
        <span>{dueLabel}</span>
        <span>
          Owner:{" "}
          <span className="text-foreground">
            {item.assigneeName ?? (item.isUnassigned ? "Unassigned" : "—")}
          </span>
        </span>
        <span>Task ID: <span className="text-foreground">{item.taskId.slice(0, 8)}</span></span>
      </div>
      {(item.requestedByStakeholder ||
        (item.executedByStakeholders?.length ?? 0) > 0) && (
        <div className="mt-1">
          <TaskAccountabilityInline
            requester={item.requestedByStakeholder}
            executors={item.executedByStakeholders as AccountabilityStakeholder[]}
          />
        </div>
      )}
    </li>
  );
}

/* ───── Scope & Data Notes (live) — Phase 6A.15 ───── */

function sourceStatusLabel(status: RoadmapStatusPackScopeDataSourceNote["status"]): {
  label: string;
  tone: "ok" | "warn" | "muted";
} {
  switch (status) {
    case "connected":
      return { label: "Connected", tone: "ok" };
    case "partial":
      return { label: "Partial", tone: "warn" };
    case "unavailable":
      return { label: "Unavailable", tone: "warn" };
    case "not_connected_yet":
    default:
      return { label: "Not connected yet", tone: "muted" };
  }
}

function NoteList({ notes }: { notes: readonly RoadmapStatusPackScopeDataNote[] }) {
  if (notes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No notes for this category.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {notes.map((n) => (
        <li
          key={n.id}
          className="text-xs text-foreground leading-relaxed flex gap-2"
        >
          <span className="text-muted-foreground select-none">•</span>
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ScopeDataNotesBody({ preview }: { preview: PreviewState }) {
  if (preview.isLoading) return <LoadingRows lines={6} />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState message="Could not derive Scope & Data Notes for the current Roadmap scope." />
    );
  }
  const notes: RoadmapStatusPackScopeDataNotes = preview.data.scopeDataNotes;
  const scope = notes.scopeBasis;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-foreground">
          Scope, source coverage, assumptions, and known limitations for this
          Status Pack. Derived live from the current manifest and connected
          section coverage — nothing here is persisted.
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Generated{" "}
          <time dateTime={notes.generatedAt}>
            {new Date(notes.generatedAt).toLocaleString()}
          </time>
          {" · "}
          Overall coverage:{" "}
          <span className="font-medium text-foreground capitalize">
            {notes.dataStatus}
          </span>
        </p>
      </div>

      {/* Scope basis */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Scope basis
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <StatTile label="Projects in scope" value={scope.projectCount} />
          <StatTile
            label="Accessible projects"
            value={scope.accessibleProjectCount}
            hint="Before filters"
          />
          <StatTile label="Workspaces" value={scope.workspaceCount} />
          <StatTile label="Programs" value={scope.programCount} />
        </div>
        {scope.appliedFilters.length > 0 && (
          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-1">
              Applied filters
            </div>
            <div className="flex flex-wrap gap-1.5">
              {scope.appliedFilters.map((f) => (
                <Badge
                  key={f.label}
                  variant="outline"
                  className="text-[11px] font-normal"
                >
                  <span className="text-muted-foreground mr-1">{f.label}:</span>
                  <span className="text-foreground">{f.value}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">{scope.archivedNote}</p>
      </section>

      {/* Included sections */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Included sections
        </h4>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {notes.includedSections.map((s) => (
            <li
              key={s.sectionId}
              className="flex items-center gap-2 text-xs border rounded-md px-2.5 py-1.5"
            >
              <span className="text-foreground truncate flex-1">{s.title}</span>
              {s.mandatory && (
                <Badge variant="secondary" className="text-[10px]">
                  Mandatory
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] capitalize">
                {s.placement}
              </Badge>
              <Badge
                variant={s.resolverStatus === "connected" ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {s.resolverStatus === "connected" ? "Live" : "Placeholder"}
              </Badge>
            </li>
          ))}
        </ul>
        {notes.excludedOptionalSections.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            Excluded optional sections:{" "}
            {notes.excludedOptionalSections.map((s) => s.title).join(", ")}
          </div>
        )}
      </section>

      {/* Connected data sources */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Connected data sources
        </h4>
        <ul className="space-y-1.5">
          {notes.connectedSources.map((src) => {
            const { label, tone } = sourceStatusLabel(src.status);
            return (
              <li
                key={src.sectionId}
                className="flex items-start justify-between gap-3 text-xs border rounded-md px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="text-foreground font-medium truncate">
                    {src.sectionTitle}
                  </div>
                  <div className="text-muted-foreground">{src.sourceLabel}</div>
                </div>
                <Badge
                  variant={tone === "ok" ? "secondary" : "outline"}
                  className={
                    "text-[10px] " +
                    (tone === "warn" ? "border-destructive/40 text-destructive" : "")
                  }
                >
                  {label}
                </Badge>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Partial / unavailable coverage */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Partial or unavailable coverage
        </h4>
        <NoteList notes={notes.partialOrUnavailableNotes} />
      </section>

      {/* General coverage notes */}
      {notes.generalCoverageNotes.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What is intentionally not shown
          </h4>
          <NoteList notes={notes.generalCoverageNotes} />
        </section>
      )}

      {/* Period and cap assumptions */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Period and cap assumptions
        </h4>
        <NoteList notes={notes.periodAndCapNotes} />
      </section>

      {/* Deferred capabilities */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Deferred capabilities
        </h4>
        <NoteList notes={notes.deferredCapabilityNotes} />
      </section>
    </div>
  );
}
