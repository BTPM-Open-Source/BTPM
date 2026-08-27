import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useRoadmapProjects, useRoadmapDependencies, type RoadmapProject } from "@/hooks/useRoadmapData";
import { useProjectAccessMap } from "@/hooks/useProjectAccessMap";
import { useRoadmapDashboardData } from "@/hooks/useRoadmapDashboardData";
import { useRoadmapReportingSummaries } from "@/hooks/useRoadmapReportingSummaries";
import { useRoadmapAdoptionReportingSummaries } from "@/hooks/useRoadmapAdoptionReportingSummaries";
import { useRoadmapPhases, useRoadmapTasks, type RoadmapPhase, type RoadmapTask } from "@/hooks/useRoadmapHierarchy";
import { RoadmapOverview } from "@/components/roadmap/RoadmapOverview";
import { ProjectDashboard } from "@/components/roadmap/ProjectDashboard";
import { RoadmapCalendarView } from "@/components/roadmap/RoadmapCalendarView";
import { useActiveWorkspace } from "@/context/ActiveWorkspaceContext";
import {
  HealthScheduleDots,
  HEALTH_BAR_BORDER_CLASS,
} from "@/components/roadmap/HealthScheduleIndicators";
import type { ProjectReportingSummary } from "@/lib/reportingSummary";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoadmapMultiSelectFilter } from "@/components/roadmap/RoadmapMultiSelectFilter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { parseDate, daysBetween } from "@/components/gantt/ganttUtils";
import { useTimelineZoom } from "@/components/gantt/useTimelineZoom";
import { TimelineZoomControls } from "@/components/gantt/TimelineZoomControls";
import { TimelineAxis } from "@/components/gantt/TimelineAxis";
import { usePersistedViewState, codecs } from "@/hooks/usePersistedViewState";
import { useUserSavedViews } from "@/hooks/useUserSavedViews";
import { SavedViewsControl } from "@/components/views/SavedViewsControl";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, FolderKanban, ChevronRight, ChevronDown,
  LayoutGrid, GanttChart, ExternalLink, Layers, ListChecks,
  CalendarDays, AlertTriangle, CalendarClock, Presentation,
} from "lucide-react";
import { RoadmapGeneratePptDialog } from "@/components/roadmap/RoadmapGeneratePptDialog";
import { RoadmapStoriesLibrary } from "@/components/roadmap-story-pack/RoadmapStoriesLibrary";

// usePlanningAuthority intentionally removed for the Roadmap PPT button:
// PPT generation is a reporting/export action gated server-side per project.
import { PageContainer } from "@/components/layout/PageContainer";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KC_CONCEPTS } from "@/components/knowledge/kc-concepts";
import {
  getPmWorkflowStatusHex,
  getPmWorkflowStatusLabel,
  getPmPriorityBadgeClass,
  getPmPriorityHex,
  getPmPriorityLabel,
} from "@/lib/btpmVisualSemantics";

/* ── CSV codec for multi-select filter IDs (URL-persisted) ──
   Backward-compat: legacy single-id values like `?ws=<uuid>` parse to [uuid];
   the literal value "all" parses to [] (meaning All). Empty selection is
   omitted from URL/storage by stringify returning undefined. */
const csvIdCodec = {
  parse: (raw: string): string[] | undefined => {
    if (raw === "all" || raw === "") return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  },
  stringify: (v: string[]): string | undefined => {
    if (!Array.isArray(v) || v.length === 0) return undefined;
    return [...v].sort().join(",");
  },
};
const arrayEquals = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/* ── Saved-view snapshot shape (durable fields only) ── */
interface RoadmapSavedView {
  activeTab: RoadmapTab;
  portfolioFilterIds: string[];
  workspaceFilterIds: string[];
  programFilterIds: string[];
  projectFilterIds: string[];
  statusFilter: string;
  priorityFilter: string;
  healthFilter: string;
  scheduleFilter: string;
}
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const isRoadmapSavedView = (raw: unknown): raw is RoadmapSavedView => {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.activeTab === "string" &&
    (ROADMAP_TABS as readonly string[]).includes(r.activeTab) &&
    (r.portfolioFilterIds === undefined || isStringArray(r.portfolioFilterIds)) &&
    isStringArray(r.workspaceFilterIds) &&
    isStringArray(r.programFilterIds) &&
    isStringArray(r.projectFilterIds) &&
    typeof r.statusFilter === "string" &&
    typeof r.priorityFilter === "string" &&
    (r.healthFilter === undefined || typeof r.healthFilter === "string") &&
    (r.scheduleFilter === undefined || typeof r.scheduleFilter === "string")
  );
};

const ROADMAP_TABS = ["overview", "dashboard", "timeline", "calendar", "status-pack"] as const;
type RoadmapTab = typeof ROADMAP_TABS[number];

const HEALTH_FILTER_VALUES = ["all", "green", "amber", "red"] as const;
const SCHEDULE_FILTER_VALUES = [
  "all",
  "on_track",
  "behind_schedule",
  "complete",
  "no_schedule_basis",
] as const;

/* ── Layout constants ──────────────────────────────── */
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 52;
const LABEL_WIDTH = 380;
const BAR_HEIGHT = 22;
const PHASE_BAR_HEIGHT = 18;
const TASK_BAR_HEIGHT = 14;

/* Status/priority visuals derive from canonical btpmVisualSemantics helpers. */

/* ── Row types ─────────────────────────────────────── */
interface RoadmapRow {
  kind: "workspace-header" | "program-header" | "project" | "phase" | "task";
  id: string;
  label: string;
  sublabel?: string;
  project?: RoadmapProject;
  phase?: RoadmapPhase;
  task?: RoadmapTask;
  /** workspace_id for navigation */
  workspaceId?: string;
  /** project_id for navigation (on phase/task rows) */
  projectId?: string;
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
}

/* ── Hierarchy data component (fetches phases/tasks for expanded projects) ── */
function useHierarchyData(expandedProjects: Set<string>, expandedPhases: Set<string>) {
  // Get unique project IDs that need phase data
  const projectIdsForPhases = useMemo(() => Array.from(expandedProjects), [expandedProjects]);
  // Get unique project IDs that need task data (any project with an expanded phase)
  const projectIdsForTasks = useMemo(() => {
    const ids = new Set<string>();
    // We need to find which projects have expanded phases — we track phase→project mapping outside
    return Array.from(ids);
  }, []);

  // Fetch phases for all expanded projects in parallel using individual hooks
  // We'll use a pattern where the parent component manages the data
  return { projectIdsForPhases, projectIdsForTasks };
}

/* ── Phase/Task data fetcher component ─────────────── */
function useExpandedProjectData(projectId: string, isExpanded: boolean) {
  const { data: phases = [], isLoading: phasesLoading } = useRoadmapPhases(
    isExpanded ? projectId : undefined
  );
  return { phases, phasesLoading };
}

function useExpandedProjectTasks(projectId: string, hasExpandedPhase: boolean) {
  const { data: tasks = [], isLoading: tasksLoading } = useRoadmapTasks(
    hasExpandedPhase ? projectId : undefined
  );
  return { tasks, tasksLoading };
}

/* ── Main component ────────────────────────────────── */
export default function Roadmap() {
  const navigate = useNavigate();
  const location = useLocation();
  // Roadmap view state — Phase 4E.2.
  // URL-mode: activeTab + filters (shareable, refresh-stable).
  // Local-mode: expandedProjects/expandedPhases (personal convenience).
  // All on the shared 4E.1 persistence foundation — no ad hoc URL/storage logic.
  const { state: viewState, setField: setViewField } = usePersistedViewState({
    viewId: "roadmap",
    scopeKey: "global",
    schema: {
      activeTab: {
        mode: "url",
        urlKey: "tab",
        default: "dashboard" as RoadmapTab,
        codec: codecs.stringEnum(ROADMAP_TABS),
        localFallback: true,
      },
      portfolioFilterIds: {
        mode: "url",
        urlKey: "portfolio",
        default: [] as string[],
        codec: csvIdCodec,
        equals: arrayEquals,
        localFallback: true,
      },
      workspaceFilterIds: {
        mode: "url",
        urlKey: "ws",
        default: [] as string[],
        codec: csvIdCodec,
        equals: arrayEquals,
        localFallback: true,
      },
      programFilterIds: {
        mode: "url",
        urlKey: "prog",
        default: [] as string[],
        codec: csvIdCodec,
        equals: arrayEquals,
        localFallback: true,
      },
      projectFilterIds: {
        mode: "url",
        urlKey: "proj",
        default: [] as string[],
        codec: csvIdCodec,
        equals: arrayEquals,
        localFallback: true,
      },
      statusFilter: {
        mode: "url",
        urlKey: "status",
        default: "all",
        codec: codecs.string,
        localFallback: true,
      },
      priorityFilter: {
        mode: "url",
        urlKey: "priority",
        default: "all",
        codec: codecs.string,
        localFallback: true,
      },
      // Wave B.4 — Health/RAG and Schedule signal filters. URL-mode so they are
      // shareable and refresh-stable like the other roadmap filters.
      healthFilter: {
        mode: "url",
        urlKey: "health",
        default: "all",
        codec: codecs.stringEnum(HEALTH_FILTER_VALUES),
        localFallback: true,
      },
      scheduleFilter: {
        mode: "url",
        urlKey: "sched",
        default: "all",
        codec: codecs.stringEnum(SCHEDULE_FILTER_VALUES),
        localFallback: true,
      },
      expandedProjects: {
        mode: "local",
        default: [] as string[],
        codec: codecs.stringArray(","),
      },
      expandedPhases: {
        mode: "local",
        default: [] as string[],
        codec: codecs.stringArray(","),
      },
    },
  });
  const activeTab = viewState.activeTab;
  const setActiveTab = useCallback(
    (v: string) => setViewField("activeTab", v as RoadmapTab),
    [setViewField],
  );

  // Phase 6B.8e.1 — Stories tab is available to any authenticated active
  // user who can access Roadmap. Row-level visibility is still enforced
  // server-side (My Stories = owner-only RPCs, Published Stories =
  // all-source-projects access rule).



  const { activeWorkspaceId, isAllWorkspaces } = useActiveWorkspace();
  const { data: projectsRaw, isLoading } = useRoadmapProjects();
  const access = useProjectAccessMap();
  const projects = useMemo(
    () =>
      (projectsRaw || []).filter((p) =>
        access.canSeeProject({ id: p.id, workspace_id: p.workspace_id }),
      ),
    [projectsRaw, access],
  );
  const projectIds = useMemo(() => (projects || []).map(p => p.id), [projects]);
  const { data: deps = [] } = useRoadmapDependencies(projectIds);

  // Sync Roadmap workspace filter with the global Active Scope on initial load
  // and when the global scope changes. We only react to global scope changes;
  // the user can locally add/remove workspaces inside Roadmap without
  // immediately being overwritten on every render.
  const lastGlobalScopeRef = useRef<string | null>(null);
  useEffect(() => {
    const desiredKey = isAllWorkspaces ? "__all__" : activeWorkspaceId ?? "__all__";
    const isInitialMount = lastGlobalScopeRef.current === null;
    if (lastGlobalScopeRef.current === desiredKey) return;
    lastGlobalScopeRef.current = desiredKey;
    // On initial mount, respect a URL-restored Roadmap selection — only seed
    // the default when there was no prior selection.
    if (isInitialMount && viewState.workspaceFilterIds.length > 0) return;
    const desiredIds = isAllWorkspaces ? [] : activeWorkspaceId ? [activeWorkspaceId] : [];
    setViewField("workspaceFilterIds", desiredIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, isAllWorkspaces]);

  const portfolioFilterIds = viewState.portfolioFilterIds;
  const workspaceFilterIds = viewState.workspaceFilterIds;
  const programFilterIds = viewState.programFilterIds;
  const projectFilterIds = viewState.projectFilterIds;
  const setPortfolioFilterIds = useCallback(
    (v: string[]) => setViewField("portfolioFilterIds", v),
    [setViewField],
  );
  const setWorkspaceFilterIds = useCallback(
    (v: string[]) => setViewField("workspaceFilterIds", v),
    [setViewField],
  );
  const setProgramFilterIds = useCallback(
    (v: string[]) => setViewField("programFilterIds", v),
    [setViewField],
  );
  const setProjectFilterIds = useCallback(
    (v: string[]) => setViewField("projectFilterIds", v),
    [setViewField],
  );
  const statusFilter = viewState.statusFilter;
  const setStatusFilter = useCallback((v: string) => setViewField("statusFilter", v), [setViewField]);
  const priorityFilter = viewState.priorityFilter;
  const setPriorityFilter = useCallback((v: string) => setViewField("priorityFilter", v), [setViewField]);
  const healthFilter = viewState.healthFilter;
  const setHealthFilter = useCallback((v: string) => setViewField("healthFilter", v), [setViewField]);
  const scheduleFilter = viewState.scheduleFilter;
  const setScheduleFilter = useCallback((v: string) => setViewField("scheduleFilter", v), [setViewField]);

  /* Saved views are wired below, after option arrays are derived, so that
     applying a saved view can prune unavailable IDs synchronously. */

  // (legacy single-select state removed; see multi-select block above.)
  // Expand/collapse — persisted as string[] in localStorage; surfaced as Set<string> for cheap lookup.
  const expandedProjects = useMemo(
    () => new Set(viewState.expandedProjects),
    [viewState.expandedProjects],
  );
  const expandedPhases = useMemo(
    () => new Set(viewState.expandedPhases),
    [viewState.expandedPhases],
  );
  const setExpandedProjects = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setViewField("expandedProjects", Array.from(updater(new Set(viewState.expandedProjects))));
    },
    [setViewField, viewState.expandedProjects],
  );
  const setExpandedPhases = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setViewField("expandedPhases", Array.from(updater(new Set(viewState.expandedPhases))));
    },
    [setViewField, viewState.expandedPhases],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoScroll = useRef(false);

  /* ── Hierarchical option derivation (Portfolios → Workspaces → Programs → Projects) ──
     All options derive from the canonical accessible-project rows; nothing is
     fabricated, no second source of truth is introduced. */

  const formatPortfolioLabel = (p: RoadmapProject): string => {
    const name = p.portfolio_name || "Unnamed Portfolio";
    const code = p.portfolio_code || null;
    const label = code ? `${code} — ${name}` : name;
    return p.portfolio_is_archived ? `${label} (archived)` : label;
  };

  // A0. Portfolio options — derived from accessible project rows.
  const portfolioOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>();
    let noneCount = 0;
    for (const p of projects || []) {
      if (p.portfolio_item_id) {
        const entry = map.get(p.portfolio_item_id);
        if (entry) {
          entry.count += 1;
        } else {
          map.set(p.portfolio_item_id, {
            id: p.portfolio_item_id,
            label: formatPortfolioLabel(p),
            count: 1,
          });
        }
      } else {
        noneCount += 1;
      }
    }
    const list = Array.from(map.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((e) => ({ id: e.id, label: e.label, hint: `${e.count} project${e.count === 1 ? "" : "s"}` }));
    if (noneCount > 0) {
      list.push({
        id: "__none__",
        label: "No Portfolio",
        hint: `${noneCount} project${noneCount === 1 ? "" : "s"}`,
      });
    }
    return list;
  }, [projects]);

  // A. Portfolio-filtered projects (empty ⇒ all accessible).
  const portfolioFilteredProjects = useMemo(() => {
    if (portfolioFilterIds.length === 0) return projects || [];
    const set = new Set(portfolioFilterIds);
    const includeNone = set.has("__none__");
    return (projects || []).filter((p) => {
      if (!p.portfolio_item_id) return includeNone;
      return set.has(p.portfolio_item_id);
    });
  }, [projects, portfolioFilterIds]);

  // B. Accessible workspaces (from portfolio-filtered project rows).
  const workspaces = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of portfolioFilteredProjects) map.set(p.workspace_id, p.workspace_name);
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [portfolioFilteredProjects]);

  // C. Workspace-filtered projects (empty selection ⇒ all portfolio-filtered).
  const workspaceFilteredProjects = useMemo(() => {
    if (workspaceFilterIds.length === 0) return portfolioFilteredProjects;
    const set = new Set(workspaceFilterIds);
    return portfolioFilteredProjects.filter((p) => set.has(p.workspace_id));
  }, [portfolioFilteredProjects, workspaceFilterIds]);

  // D. Program options (derived only from workspace-filtered projects).
  const programOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string; hint?: string }>();
    let hasStandalone = false;
    for (const p of workspaceFilteredProjects) {
      if (p.program_id && p.program_name) {
        if (!map.has(p.program_id)) {
          map.set(p.program_id, {
            id: p.program_id,
            label: p.program_name,
            hint: p.workspace_name,
          });
        }
      } else {
        hasStandalone = true;
      }
    }
    const list = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
    if (hasStandalone) {
      list.unshift({ id: "__none__", label: "Standalone (no program)" });
    }
    return list;
  }, [workspaceFilteredProjects]);

  // E. Program-filtered projects (empty ⇒ all workspace-filtered).
  const programFilteredProjects = useMemo(() => {
    if (programFilterIds.length === 0) return workspaceFilteredProjects;
    const set = new Set(programFilterIds);
    const includeStandalone = set.has("__none__");
    return workspaceFilteredProjects.filter((p) => {
      if (!p.program_id) return includeStandalone;
      return set.has(p.program_id);
    });
  }, [workspaceFilteredProjects, programFilterIds]);

  // F. Project options — labels include workspace, program, and portfolio
  //    context to disambiguate duplicate project names across workspaces.
  const projectOptions = useMemo(() => {
    return [...programFilteredProjects]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => {
        const portfolioLabel = p.portfolio_item_id ? formatPortfolioLabel(p) : "No Portfolio";
        return {
          id: p.id,
          label: p.name,
          hint: `${p.workspace_name} · ${p.program_name ?? "Standalone"} · ${portfolioLabel}`,
        };
      });
  }, [programFilteredProjects]);

  // Reconcile child selections when parent options shrink. We never
  // auto-select replacements; we only prune what's no longer available.
  useEffect(() => {
    const valid = new Set(portfolioOptions.map((o) => o.id));
    if (portfolioFilterIds.some((id) => !valid.has(id))) {
      setPortfolioFilterIds(portfolioFilterIds.filter((id) => valid.has(id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioOptions]);
  useEffect(() => {
    const valid = new Set(programOptions.map((o) => o.id));
    if (programFilterIds.some((id) => !valid.has(id))) {
      setProgramFilterIds(programFilterIds.filter((id) => valid.has(id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programOptions]);
  useEffect(() => {
    const valid = new Set(projectOptions.map((o) => o.id));
    if (projectFilterIds.some((id) => !valid.has(id))) {
      setProjectFilterIds(projectFilterIds.filter((id) => valid.has(id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectOptions]);

  /* ── Wave B.4: canonical reporting summaries (B.2 contract) ── */
  const workspaceIdsForReporting = useMemo(
    () => Array.from(new Set((projects || []).map((p) => p.workspace_id))),
    [projects],
  );
  const reporting = useRoadmapReportingSummaries(workspaceIdsForReporting);
  const adoptionReporting = useRoadmapAdoptionReportingSummaries(workspaceIdsForReporting);

  /* ── Final filter ─────────────────────────────────────
     Order: workspace → program → project → (legacy status/priority/health/sched).
     Existing status/priority/health/schedule filters are preserved as-is. */
  const filtered = useMemo(() => {
    let list = programFilteredProjects;
    if (projectFilterIds.length > 0) {
      const set = new Set(projectFilterIds);
      list = list.filter((p) => set.has(p.id));
    }
    if (statusFilter !== "all") list = list.filter((p) => p.status === statusFilter);
    if (priorityFilter !== "all") list = list.filter((p) => p.priority === priorityFilter);
    if (healthFilter !== "all") {
      list = list.filter((p) => {
        const r = reporting.byProjectId.get(p.id);
        return r ? r.health_rag === healthFilter : false;
      });
    }
    if (scheduleFilter !== "all") {
      list = list.filter((p) => {
        const r = reporting.byProjectId.get(p.id);
        return r ? r.schedule_signal === scheduleFilter : false;
      });
    }
    return list;
  }, [
    programFilteredProjects,
    projectFilterIds,
    statusFilter,
    priorityFilter,
    healthFilter,
    scheduleFilter,
    reporting.byProjectId,
  ]);

  const hasAnyFilter =
    portfolioFilterIds.length > 0 ||
    workspaceFilterIds.length > 0 ||
    programFilterIds.length > 0 ||
    projectFilterIds.length > 0;
  const clearAllRoadmapFilters = useCallback(() => {
    setPortfolioFilterIds([]);
    setWorkspaceFilterIds([]);
    setProgramFilterIds([]);
    setProjectFilterIds([]);
  }, [setPortfolioFilterIds, setWorkspaceFilterIds, setProgramFilterIds, setProjectFilterIds]);

  // Build programs list for Calendar (unchanged contract: id+name).
  const programsList = useMemo(
    () =>
      programOptions
        .filter((o) => o.id !== "__none__")
        .map((o) => ({ id: o.id, name: o.label })),
    [programOptions],
  );

  /* ── Saved views (server-backed, per-user, encrypted) ────────────────
     Durable filter/view state only — never project result sets. Pruning
     of unavailable IDs happens at apply time using the current option
     arrays so the snapshot stays a *filter spec*, not reporting truth. */
  const { toast } = useToast();
  const savedViews = useUserSavedViews<RoadmapSavedView>({
    surfaceKey: "roadmap",
    scopeKey: "global",
    validate: isRoadmapSavedView,
  });
  const currentSavedSnapshot: RoadmapSavedView = useMemo(
    () => ({
      activeTab,
      portfolioFilterIds,
      workspaceFilterIds,
      programFilterIds,
      projectFilterIds,
      statusFilter,
      priorityFilter,
      healthFilter,
      scheduleFilter,
    }),
    [activeTab, portfolioFilterIds, workspaceFilterIds, programFilterIds, projectFilterIds, statusFilter, priorityFilter, healthFilter, scheduleFilter],
  );
  const applySavedView = useCallback(
    (snap: RoadmapSavedView) => {
      // Backward-compatible defaults for older snapshots
      const tab = (ROADMAP_TABS as readonly string[]).includes(snap.activeTab)
        ? snap.activeTab
        : "dashboard";
      const portIn = Array.isArray(snap.portfolioFilterIds) ? snap.portfolioFilterIds : [];
      const wsIn = Array.isArray(snap.workspaceFilterIds) ? snap.workspaceFilterIds : [];
      const progIn = Array.isArray(snap.programFilterIds) ? snap.programFilterIds : [];
      const projIn = Array.isArray(snap.projectFilterIds) ? snap.projectFilterIds : [];

      // Prune portfolio IDs against currently available portfolio options
      // (which include "__none__" when applicable).
      const portValid = new Set(portfolioOptions.map((o) => o.id));
      const port = portIn.filter((id) => portValid.has(id));

      // Prune workspace IDs against currently accessible workspaces
      const wsValid = new Set(workspaces.map((w) => w.id));
      const ws = wsIn.filter((id) => wsValid.has(id));

      setViewField("activeTab", tab as RoadmapTab);
      setViewField("portfolioFilterIds", port);
      setViewField("workspaceFilterIds", ws);
      setViewField("programFilterIds", progIn);
      setViewField("projectFilterIds", projIn);
      setViewField("statusFilter", typeof snap.statusFilter === "string" ? snap.statusFilter : "all");
      setViewField("priorityFilter", typeof snap.priorityFilter === "string" ? snap.priorityFilter : "all");
      setViewField("healthFilter", snap.healthFilter ?? "all");
      setViewField("scheduleFilter", snap.scheduleFilter ?? "all");

      if (portIn.length !== port.length || wsIn.length !== ws.length) {
        toast({
          title: "Some saved filters are no longer available",
          description: "Inaccessible Portfolios or workspaces were removed from the applied view.",
        });
      }
    },
    [setViewField, portfolioOptions, workspaces, toast],
  );
  const handleSaveView = useCallback(
    async (name: string, snap: RoadmapSavedView) => {
      const result = await savedViews.saveView(name, snap);
      if (!result) {
        toast({
          title: "Could not save view",
          description: "Please try again.",
          variant: "destructive",
        });
      }
    },
    [savedViews, toast],
  );
  const handleApplySavedView = useCallback(
    (snap: RoadmapSavedView) => applySavedView(snap),
    [applySavedView],
  );
  const handleRenameSavedView = useCallback(
    async (id: string, name: string) => {
      try {
        await savedViews.renameView(id, name);
      } catch {
        toast({
          title: "Could not rename view",
          variant: "destructive",
        });
      }
    },
    [savedViews, toast],
  );
  const handleDeleteSavedView = useCallback(
    async (id: string) => {
      try {
        await savedViews.deleteView(id);
      } catch {
        toast({
          title: "Could not delete view",
          variant: "destructive",
        });
      }
    },
    [savedViews, toast],
  );
  /* ── Dashboard derived data (shares filtered set) ──── */
  const { data: dashboardData, isLoading: dashboardLoading } = useRoadmapDashboardData(filtered);

  /* ── Toggle expand ─────────────────────────────────── */
  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
        // Collapse all phases of this project too
        setExpandedPhases(prevPhases => {
          const nextPhases = new Set(prevPhases);
          // We'll clean up stale phase IDs; for now just leave them
          return nextPhases;
        });
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, [setExpandedProjects, setExpandedPhases]);

  const togglePhase = useCallback((phaseId: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }, [setExpandedPhases]);

  /* ── Navigation helpers ──────────────────────────────
     Pass `from=roadmap` + `returnTo=/roadmap` so destination
     screens send the user back to the roadmap they came from,
     not to the default Planning/Workspace list. */
  const buildReturnSuffix = useCallback(() => {
    const returnTo = `/roadmap?tab=${activeTab}`;
    return { qs: `?from=roadmap&returnTo=${encodeURIComponent(returnTo)}`, state: { from: "roadmap", returnTo } };
  }, [activeTab]);

  const openProject = useCallback((wsId: string, projectId: string) => {
    const { qs, state } = buildReturnSuffix();
    navigate(`/workspace/${wsId}/project/${projectId}${qs}`, { state });
  }, [navigate, buildReturnSuffix]);

  const openPhase = useCallback((wsId: string, projectId: string, phaseId: string) => {
    const { qs, state } = buildReturnSuffix();
    navigate(`/workspace/${wsId}/project/${projectId}/phase/${phaseId}${qs}`, { state });
  }, [navigate, buildReturnSuffix]);

  const openTask = useCallback((wsId: string, projectId: string, taskId: string) => {
    const { qs, state } = buildReturnSuffix();
    navigate(`/workspace/${wsId}/project/${projectId}/task/${taskId}${qs}`, { state });
  }, [navigate, buildReturnSuffix]);

  /* ── Roadmap "Generate PPT" — project-first scope ──
     Reporting/export action: the deck must reflect the *visible* Roadmap
     scope, so the dialog is fed the final `filtered` project set and
     authorisation happens server-side per project. We no longer probe
     workspace PM authority for the button. */
  const [pptDialogOpen, setPptDialogOpen] = useState(false);
  const pptScopeProjects = useMemo(
    () => filtered.map((p) => ({
      id: p.id,
      name: p.name,
      workspaceId: p.workspace_id,
      workspaceName: p.workspace_name,
      programId: p.program_id ?? null,
      programName: p.program_name ?? null,
      // Phase 6D.7B — Portfolio provenance carried into the PPT dialog.
      portfolioItemId: p.portfolio_item_id ?? null,
      portfolioName: p.portfolio_name ?? null,
      portfolioCode: p.portfolio_code ?? null,
      portfolioLifecycleState: p.portfolio_lifecycle_state ?? null,
      portfolioIsArchived: p.portfolio_is_archived ?? null,
    })),
    [filtered],
  );
  // Phase 6D.7B — canonical Portfolio scope. UI sentinel "__none__"
  // is unpacked into `includeNoPortfolio`; never forwarded as an id.
  const pptPortfolioItemIds = useMemo(
    () => portfolioFilterIds.filter((id) => id !== "__none__"),
    [portfolioFilterIds],
  );
  const pptIncludeNoPortfolio = portfolioFilterIds.includes("__none__");
  const canGeneratePpt = pptScopeProjects.length > 0;

  /* ── Loading ───────────────────────────────────────── */
  if (isLoading) {
    return (
      <PageContainer width="wide" className="pt-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }


  /* ── Render ──────────────────────────────────────────
     Shell (title / filters / tabs list) → wide.
     Dashboard tab content → wide. Timeline/Calendar → canvas. */
  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="pt-6 pb-6 space-y-4">
      <PageContainer width="wide" className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            Program Roadmap
            <KnowledgeLink slug="roadmap-and-gantt" variant="icon" label="Roadmap & Gantt — Learn more" />
          </h1>
          <p className="text-sm text-muted-foreground">Operational orientation across active, upcoming, and at-risk work</p>
        </div>

        {/* Hierarchical multi-select filter bar.
            Workspace defaults from the global Active Scope; users can locally
            add/remove accessible workspaces without changing the global scope.
            Programs and Projects are derived hierarchically from the upstream
            selection — empty selection means "All". */}
        <div className="flex flex-wrap items-center gap-3">
          <RoadmapMultiSelectFilter
            label="Portfolios"
            options={portfolioOptions}
            selected={portfolioFilterIds}
            onChange={setPortfolioFilterIds}
            emptyText="No Portfolios"
          />
          <RoadmapMultiSelectFilter
            label="Workspaces"
            options={workspaces.map((w) => ({ id: w.id, label: w.name }))}
            selected={workspaceFilterIds}
            onChange={setWorkspaceFilterIds}
            emptyText="No accessible workspaces"
          />
          <RoadmapMultiSelectFilter
            label="Programs"
            options={programOptions}
            selected={programFilterIds}
            onChange={setProgramFilterIds}
            emptyText="No programs"
          />
          <RoadmapMultiSelectFilter
            label="Projects"
            options={projectOptions}
            selected={projectFilterIds}
            onChange={setProjectFilterIds}
            emptyText="No projects"
          />
          {hasAnyFilter && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={clearAllRoadmapFilters}
            >
              Clear filters
            </Button>
          )}
          <SavedViewsControl<RoadmapSavedView>
            views={savedViews.views}
            currentState={currentSavedSnapshot}
            onSave={handleSaveView}
            onApply={handleApplySavedView}
            onRename={handleRenameSavedView}
            onDelete={handleDeleteSavedView}
            label="My views"
            description="Private to you, saved to your BTPM account."
            disabled={savedViews.isLoading}
            emptyText={savedViews.isLoading ? "Loading…" : "No saved views yet."}
          />
          {canGeneratePpt && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setPptDialogOpen(true)}
              title="Generate Roadmap Status Deck (PowerPoint)"
            >
              <Presentation className="h-3.5 w-3.5" />
              Generate PPT
            </Button>
          )}
          {reporting.isError && (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              title="Reporting summaries could not be loaded. At-risk indicators may be unavailable."
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Reporting unavailable
            </span>
          )}
        </div>

        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5">
            <GanttChart className="h-3.5 w-3.5" />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Calendar
          </TabsTrigger>
          <TabsTrigger value="status-pack" className="gap-1.5">
            <Presentation className="h-3.5 w-3.5" />
            Stories
          </TabsTrigger>
        </TabsList>
      </PageContainer>


      {/* ── Overview tab (UX-1.6) — wide ─────────────────── */}
      <TabsContent value="overview">
        <PageContainer width="wide">
          <RoadmapOverview
            filtered={filtered}
            reportingByProjectId={reporting.byProjectId}
            dashboardData={dashboardData}
            dashboardLoading={dashboardLoading}
            activeTab={activeTab}
          />
        </PageContainer>
      </TabsContent>

      {/* ── Dashboard tab — wide. Filters by selected workspace
           via global Active Scope sync; "All workspaces" shows all. ── */}
      <TabsContent value="dashboard">
        <PageContainer width="wide">
          <ProjectDashboard
            filtered={filtered}
            dashboardData={dashboardData}
            dashboardLoading={dashboardLoading}
            reportingByProjectId={reporting.byProjectId}
            adoptionByProjectId={adoptionReporting.byProjectId}
          />
        </PageContainer>
      </TabsContent>

      {/* ── Timeline tab — canvas ────────────────────────── */}
      <TabsContent value="timeline" className="space-y-3">
        <PageContainer width="canvas" className="space-y-3">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> Workspace</span>
            <span className="flex items-center gap-1"><FolderKanban className="h-3 w-3" /> Program</span>
            <span className="flex items-center gap-1"><ChevronRight className="h-3 w-3" /> Project</span>
            <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> Phase</span>
            <span className="flex items-center gap-1"><ListChecks className="h-3 w-3" /> Task</span>
            <span className="ml-2 border-l pl-2 border-border flex items-center gap-1">
              <span className="inline-block w-6 h-0.5 bg-primary rounded" /> Dependency
            </span>
            <span className="ml-2 border-l pl-2 border-border flex items-center gap-1">
              <span className="inline-block w-1 h-3 bg-[hsl(var(--destructive))] rounded-sm" />
              <span className="inline-block w-1 h-3 bg-[hsl(var(--warning))] rounded-sm" />
              <span className="inline-block w-1 h-3 bg-[hsl(var(--success))] rounded-sm" />
              Health (bar edge)
            </span>
            <span className="border-l pl-2 border-border flex items-center gap-1">
              <CalendarClock className="h-3 w-3 text-[hsl(var(--destructive))]" />
              Behind schedule
            </span>
          </div>

          <TimelineSection
            filtered={filtered}
            projects={projects || []}
            deps={deps}
            reportingByProjectId={reporting.byProjectId}
            expandedProjects={expandedProjects}
            expandedPhases={expandedPhases}
            toggleProject={toggleProject}
            togglePhase={togglePhase}
            openProject={openProject}
            openPhase={openPhase}
            openTask={openTask}
            scrollRef={scrollRef}
            didAutoScroll={didAutoScroll}
          />
        </PageContainer>
      </TabsContent>

      {/* ── Calendar tab — canvas ────────────────────────── */}
      <TabsContent value="calendar" className="space-y-3">
        <PageContainer width="canvas" className="space-y-3">
          <RoadmapCalendarView
            filtered={filtered}
            deps={deps}
            workspaces={workspaces}
            programs={[...programsList, { id: "__none__", name: "Standalone Projects" }]}
          />
        </PageContainer>
      </TabsContent>

      {/* ── Status Pack tab — Configure mode (Phase 6A.16) ─
           Inherits scope from current Roadmap filters via a live
           filter snapshot. No saved views; no PPT export here yet —
           the Roadmap "Generate PPT" action remains the legacy
           export path. ── */}
      <TabsContent value="status-pack">
        <PageContainer width="wide" className="space-y-3">
          <RoadmapStoriesLibrary
            filters={{
              workspace_ids: workspaceFilterIds,
              program_ids: programFilterIds,
              project_ids: projectFilterIds,
              status_filter: statusFilter,
              priority_filter: priorityFilter,
              health_filter: healthFilter,
              schedule_filter: scheduleFilter,
              // Phase 6D.7A — canonical Portfolio scope. The UI sentinel
              // "__none__" is unpacked here into `include_no_portfolio` so
              // it is never persisted into scope contracts.
              portfolio_item_ids: portfolioFilterIds.filter((id) => id !== "__none__"),
              include_no_portfolio: portfolioFilterIds.includes("__none__"),
            }}
          />
        </PageContainer>
      </TabsContent>
      <RoadmapGeneratePptDialog
        open={pptDialogOpen}
        onOpenChange={setPptDialogOpen}
        filteredProjects={pptScopeProjects}
        workspaces={workspaces.map((w) => ({ id: w.id, label: w.name }))}
        selectedWorkspaceIds={workspaceFilterIds}
        selectedProgramIds={programFilterIds}
        programOptions={programOptions.map((p) => ({ id: p.id, label: p.label }))}
        selectedProjectIds={projectFilterIds}
        portfolioItemIds={pptPortfolioItemIds}
        includeNoPortfolio={pptIncludeNoPortfolio}
      />
    </Tabs>
  );
}

/* ═══════════════════════════════════════════════════════
   Timeline section — extracted to manage hierarchy hooks
   ═══════════════════════════════════════════════════════ */

interface TimelineSectionProps {
  filtered: RoadmapProject[];
  projects: RoadmapProject[];
  deps: { id: string; source_id: string; target_id: string; dependency_type: string }[];
  reportingByProjectId: Map<string, ProjectReportingSummary>;
  expandedProjects: Set<string>;
  expandedPhases: Set<string>;
  toggleProject: (id: string) => void;
  togglePhase: (id: string) => void;
  openProject: (wsId: string, projectId: string) => void;
  openPhase: (wsId: string, projectId: string, phaseId: string) => void;
  openTask: (wsId: string, projectId: string, taskId: string) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  didAutoScroll: React.MutableRefObject<boolean>;
}

function TimelineSection({
  filtered,
  projects,
  deps,
  reportingByProjectId,
  expandedProjects,
  expandedPhases,
  toggleProject,
  togglePhase,
  openProject,
  openPhase,
  openTask,
  scrollRef,
  didAutoScroll,
}: TimelineSectionProps) {
  // Fetch hierarchy data for all expanded projects
  // We need stable hooks — use a maximum of expanded project IDs
  const expandedProjectIds = useMemo(() => Array.from(expandedProjects), [expandedProjects]);

  // We'll fetch data using a child component pattern to keep hooks stable
  // For simplicity, fetch ALL phases/tasks for each expanded project at the parent level
  // using a wrapper component that renders per-project data fetchers

  return (
    <TimelineWithData
      filtered={filtered}
      projects={projects}
      deps={deps}
      reportingByProjectId={reportingByProjectId}
      expandedProjects={expandedProjects}
      expandedPhases={expandedPhases}
      expandedProjectIds={expandedProjectIds}
      toggleProject={toggleProject}
      togglePhase={togglePhase}
      openProject={openProject}
      openPhase={openPhase}
      openTask={openTask}
      scrollRef={scrollRef}
      didAutoScroll={didAutoScroll}
    />
  );
}

/* ── Per-project data fetcher component ────────────── */
function useProjectHierarchyData(projectId: string, needPhases: boolean, needTasks: boolean) {
  const { data: phases = [] } = useRoadmapPhases(needPhases ? projectId : undefined);
  const { data: tasks = [] } = useRoadmapTasks(needTasks ? projectId : undefined);
  return { phases, tasks };
}

/**
 * Since React hooks must be called unconditionally, we collect hierarchy data
 * via a callback-based pattern: each expanded project renders a data-fetcher
 * component that reports its data up.
 */
function HierarchyDataCollector({
  projectId,
  needTasks,
  onData,
}: {
  projectId: string;
  needTasks: boolean;
  onData: (projectId: string, phases: RoadmapPhase[], tasks: RoadmapTask[]) => void;
}) {
  const { phases, tasks } = useProjectHierarchyData(projectId, true, needTasks);

  useEffect(() => {
    onData(projectId, phases, tasks);
  }, [projectId, phases, tasks, onData]);

  return null;
}

function TimelineWithData({
  filtered,
  projects,
  deps,
  reportingByProjectId,
  expandedProjects,
  expandedPhases,
  expandedProjectIds,
  toggleProject,
  togglePhase,
  openProject,
  openPhase,
  openTask,
  scrollRef,
  didAutoScroll,
}: TimelineSectionProps & { expandedProjectIds: string[] }) {
  // Collected hierarchy data
  const [hierarchyData, setHierarchyData] = useState<
    Map<string, { phases: RoadmapPhase[]; tasks: RoadmapTask[] }>
  >(new Map());

  const handleData = useCallback(
    (projectId: string, phases: RoadmapPhase[], tasks: RoadmapTask[]) => {
      setHierarchyData(prev => {
        const existing = prev.get(projectId);
        if (existing && existing.phases === phases && existing.tasks === tasks) return prev;
        const next = new Map(prev);
        next.set(projectId, { phases, tasks });
        return next;
      });
    },
    []
  );

  // Determine which expanded projects have expanded phases (need task data)
  const projectsNeedingTasks = useMemo(() => {
    const set = new Set<string>();
    for (const phaseId of expandedPhases) {
      // Find which project this phase belongs to
      for (const [pid, data] of hierarchyData) {
        if (data.phases.some(p => p.id === phaseId)) {
          set.add(pid);
          break;
        }
      }
    }
    return set;
  }, [expandedPhases, hierarchyData]);

  /* ── Build rows: Workspace → Program → Project → Phase → Task ── */
  const rows = useMemo(() => {
    const result: RoadmapRow[] = [];
    const byWs = new Map<string, RoadmapProject[]>();
    for (const p of filtered) {
      if (!byWs.has(p.workspace_id)) byWs.set(p.workspace_id, []);
      byWs.get(p.workspace_id)!.push(p);
    }

    for (const [wsId, wsProjects] of byWs) {
      const wsName = wsProjects[0].workspace_name;
      result.push({ kind: "workspace-header", id: `ws-${wsId}`, label: wsName, depth: 0 });

      const byProgram = new Map<string, RoadmapProject[]>();
      const unlinked: RoadmapProject[] = [];
      for (const p of wsProjects) {
        if (p.program_id) {
          if (!byProgram.has(p.program_id)) byProgram.set(p.program_id, []);
          byProgram.get(p.program_id)!.push(p);
        } else {
          unlinked.push(p);
        }
      }

      const addProjectRows = (projs: RoadmapProject[]) => {
        for (const p of projs) {
          const isExpanded = expandedProjects.has(p.id);
          result.push({
            kind: "project",
            id: p.id,
            label: p.name,
            project: p,
            workspaceId: p.workspace_id,
            depth: 2,
            expandable: true,
            expanded: isExpanded,
          });

          if (isExpanded) {
            const data = hierarchyData.get(p.id);
            const phases = data?.phases || [];
            const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order);

            for (const phase of sortedPhases) {
              const phaseExpanded = expandedPhases.has(phase.id);
              result.push({
                kind: "phase",
                id: phase.id,
                label: phase.name,
                phase,
                workspaceId: p.workspace_id,
                projectId: p.id,
                depth: 3,
                expandable: true,
                expanded: phaseExpanded,
              });

              if (phaseExpanded) {
                const tasks = (data?.tasks || []).filter(t => t.phase_id === phase.id);
                const sortedTasks = [...tasks].sort((a, b) => a.sort_order - b.sort_order);
                for (const task of sortedTasks) {
                  result.push({
                    kind: "task",
                    id: task.id,
                    label: task.name,
                    task,
                    workspaceId: p.workspace_id,
                    projectId: p.id,
                    depth: 4,
                    expandable: false,
                  });
                }
              }
            }
          }
        }
      };

      for (const [progId, progProjects] of byProgram) {
        const progName = progProjects[0].program_name || "Program";
        result.push({ kind: "program-header", id: `prog-${progId}`, label: progName, sublabel: wsName, depth: 1 });
        addProjectRows(progProjects);
      }

      if (unlinked.length > 0) {
        if (byProgram.size > 0) {
          result.push({ kind: "program-header", id: `prog-none-${wsId}`, label: "Standalone Projects", depth: 1 });
        }
        addProjectRows(unlinked);
      }
    }
    return result;
  }, [filtered, expandedProjects, expandedPhases, hierarchyData]);

  /* ── Timeline computation via shared zoom model ── */
  const visibleItems = useMemo(() => {
    const items: { start: string | null; end: string | null }[] = [];
    for (const r of rows) {
      if (r.project) items.push({ start: r.project.start_date, end: r.project.target_end_date });
      if (r.phase) items.push({ start: r.phase.start_date, end: r.phase.target_end_date });
      if (r.task) items.push({ start: r.task.start_date, end: r.task.due_date });
    }
    return items;
  }, [rows]);

  const viewportElRef = useRef<HTMLElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(0);

  const {
    zoom, dayWidth, timelineStart, timelineWidth, axis,
    canZoomIn, canZoomOut, zoomIn, zoomOut, fitToScreen,
  } = useTimelineZoom({
    visibleItems,
    initialZoom: "month",
    viewportWidth,
  });

  const todayOffset = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return daysBetween(timelineStart, today) * dayWidth;
  }, [timelineStart, dayWidth]);

  const chartHeight = rows.length * ROW_HEIGHT;

  /* ── Dependency lines (project-to-project only) ──── */
  const depLines = useMemo(() => {
    const rowIndex: Record<string, number> = {};
    rows.forEach((r, i) => { if (r.kind === "project") rowIndex[r.id] = i; });
    return deps
      .filter(d => rowIndex[d.source_id] !== undefined && rowIndex[d.target_id] !== undefined)
      .map(d => {
        const srcRow = rows[rowIndex[d.source_id]];
        const tgtRow = rows[rowIndex[d.target_id]];
        const srcEnd = parseDate(srcRow.project!.target_end_date || srcRow.project!.start_date);
        const tgtStart = parseDate(tgtRow.project!.start_date || tgtRow.project!.target_end_date);
        if (!srcEnd || !tgtStart) return null;
        const x1 = daysBetween(timelineStart, srcEnd) * dayWidth;
        const y1 = rowIndex[d.source_id] * ROW_HEIGHT + ROW_HEIGHT / 2;
        const x2 = daysBetween(timelineStart, tgtStart) * dayWidth;
        const y2 = rowIndex[d.target_id] * ROW_HEIGHT + ROW_HEIGHT / 2;
        return { key: d.id, x1, y1, x2, y2 };
      })
      .filter(Boolean) as { key: string; x1: number; y1: number; x2: number; y2: number }[];
  }, [deps, rows, timelineStart, dayWidth]);

  /* ── Track viewport width for fit-to-screen ──────── */
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const viewport = root.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    viewportElRef.current = viewport;
    if (!viewport) return;
    const update = () => setViewportWidth(viewport.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [scrollRef]);

  /* ── Auto-scroll to today ──────────────────────────── */
  useEffect(() => {
    if (didAutoScroll.current) return;
    if (todayOffset < 0 || todayOffset > timelineWidth) return;
    const el = viewportElRef.current || scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollLeft = Math.max(0, todayOffset - el.clientWidth / 3); });
    didAutoScroll.current = true;
  }, [todayOffset, timelineWidth, scrollRef, didAutoScroll]);

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        {filtered.length === 0
          ? "No projects found. Create projects in your workspaces to see the roadmap."
          : "No projects match the current filters."}
      </div>
    );
  }

  return (
    <>
      {/* Render data collectors for expanded projects */}
      {expandedProjectIds.map(pid => (
        <HierarchyDataCollector
          key={pid}
          projectId={pid}
          needTasks={projectsNeedingTasks.has(pid)}
          onData={handleData}
        />
      ))}

      {/* Zoom / fit controls */}
      <div className="flex justify-end">
        <TimelineZoomControls
          zoom={zoom}
          canZoomIn={canZoomIn}
          canZoomOut={canZoomOut}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={fitToScreen}
        />
      </div>

      <div className="border border-border rounded-lg overflow-hidden shadow-sm">
        <div className="flex">
          {/* ── Label column ──────────────────────────────── */}
          <div className="flex-shrink-0 border-r border-border bg-card" style={{ width: LABEL_WIDTH }}>
            <div className="flex items-end px-3 pb-2 border-b border-border" style={{ height: HEADER_HEIGHT }}>
              <span className="text-xs font-medium text-muted-foreground">Hierarchy</span>
            </div>
            {rows.map(row => (
              <LabelRow
                key={row.id}
                row={row}
                summary={row.kind === "project" ? reportingByProjectId.get(row.id) ?? null : null}
                onToggle={row.kind === "project" ? toggleProject : row.kind === "phase" ? togglePhase : undefined}
                onOpen={
                  row.kind === "project"
                    ? () => openProject(row.workspaceId!, row.id)
                    : row.kind === "phase"
                    ? () => openPhase(row.workspaceId!, row.projectId!, row.id)
                    : row.kind === "task"
                    ? () => openTask(row.workspaceId!, row.projectId!, row.id)
                    : undefined
                }
              />
            ))}
          </div>

          {/* ── Timeline ──────────────────────────────────── */}
          <ScrollArea className="flex-1" ref={scrollRef}>
            <div style={{ width: timelineWidth, minWidth: "100%" }}>
              {/* Adaptive timeline axis */}
              <TimelineAxis
                axis={axis}
                width={timelineWidth}
                height={HEADER_HEIGHT}
                todayOffset={todayOffset}
              />

              {/* Chart area */}
              <div className="relative" style={{ height: chartHeight }}>
                <svg className="absolute inset-0 pointer-events-none" width={timelineWidth} height={chartHeight}>
                  {/* Row stripes */}
                  {rows.map((r, i) => {
                    let fill = "transparent";
                    if (r.kind === "workspace-header") fill = "hsl(var(--muted) / 0.5)";
                    else if (r.kind === "program-header") fill = "hsl(var(--muted) / 0.25)";
                    else if (r.kind === "phase") fill = "hsl(var(--muted) / 0.08)";
                    else if (r.kind === "task") fill = "hsl(var(--muted) / 0.04)";
                    else if (i % 2 === 0) fill = "hsl(var(--muted) / 0.12)";
                    return <rect key={i} x={0} y={i * ROW_HEIGHT} width={timelineWidth} height={ROW_HEIGHT} fill={fill} />;
                  })}
                  {/* Today highlight */}
                  {todayOffset >= 0 && todayOffset <= timelineWidth && (
                    <>
                      <rect x={todayOffset - dayWidth / 2} y={0} width={dayWidth} height={chartHeight} fill="hsl(var(--destructive) / 0.06)" />
                      <line x1={todayOffset} y1={0} x2={todayOffset} y2={chartHeight} stroke="hsl(var(--destructive))" strokeWidth={1.5} strokeDasharray="6 3" />
                    </>
                  )}
                  {/* Dependency arrows (project-to-project only) */}
                  <defs>
                    <marker id="roadmap-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                      <path d="M0,0 L8,3 L0,6 Z" fill="hsl(var(--primary))" fillOpacity={0.85} />
                    </marker>
                  </defs>
                  {depLines.map(line => {
                    const midX = (line.x1 + line.x2) / 2;
                    return (
                      <path
                        key={line.key}
                        d={`M${line.x1},${line.y1} C${midX},${line.y1} ${midX},${line.y2} ${line.x2},${line.y2}`}
                        fill="none"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        strokeOpacity={0.7}
                        markerEnd="url(#roadmap-arrow)"
                      />
                    );
                  })}
                </svg>

                {/* Entity bars */}
                {rows.map((row, i) => {
                  if (row.kind === "workspace-header" || row.kind === "program-header") return null;

                  let startDate: string | null = null;
                  let endDate: string | null = null;
                  let barH = BAR_HEIGHT;
                  let statusHex = "#9CA3AF";

                  if (row.kind === "project" && row.project) {
                    startDate = row.project.start_date;
                    endDate = row.project.target_end_date;
                    barH = BAR_HEIGHT;
                    statusHex = getPmWorkflowStatusHex(row.project.status);
                  } else if (row.kind === "phase" && row.phase) {
                    startDate = row.phase.start_date;
                    endDate = row.phase.target_end_date;
                    barH = PHASE_BAR_HEIGHT;
                    statusHex = getPmWorkflowStatusHex(row.phase.status);
                  } else if (row.kind === "task" && row.task) {
                    startDate = row.task.start_date;
                    endDate = row.task.due_date;
                    barH = TASK_BAR_HEIGHT;
                    statusHex = getPmWorkflowStatusHex(row.task.status);
                  }

                  const start = parseDate(startDate);
                  const end = parseDate(endDate);
                  if (!start && !end) return null;
                  const barStart = start || end!;
                  const barEnd = end || start!;
                  const x = daysBetween(timelineStart, barStart) * dayWidth;
                  const w = Math.max(dayWidth, (daysBetween(barStart, barEnd) + 1) * dayWidth);
                  const y = i * ROW_HEIGHT + (ROW_HEIGHT - barH) / 2;

                  const labelFits = row.kind === "project" && w > 90;
                  const isProject = row.kind === "project";

                  const projectSummary =
                    isProject && row.project ? reportingByProjectId.get(row.project.id) ?? null : null;
                  const healthBorderClass =
                    isProject && projectSummary
                      ? HEALTH_BAR_BORDER_CLASS[projectSummary.health_rag]
                      : "";
                  const isBehindSchedule =
                    isProject && projectSummary?.schedule_signal === "behind_schedule";

                  return (
                    <div
                      key={row.id}
                      className="absolute"
                      style={{ left: x, top: y, width: w, height: barH }}
                    >
                      <div
                        className={cn(
                          "absolute inset-0 shadow-sm transition-all",
                          isProject
                            ? cn(
                                "rounded-md border border-foreground/20",
                                healthBorderClass && "border-l-4",
                                healthBorderClass,
                              )
                            : row.kind === "phase"
                            ? "rounded border border-foreground/15 opacity-85"
                            : "rounded-sm border border-foreground/10 opacity-75",
                        )}
                        style={{ backgroundColor: statusHex }}
                        title={
                          isProject && projectSummary
                            ? `${row.label}\nHealth: ${projectSummary.health_label}\nSchedule: ${projectSummary.schedule_signal.replace(/_/g, " ")}`
                            : row.label
                        }
                      >
                        {labelFits && (
                          <span className="absolute inset-0 flex items-center px-2 text-[11px] font-semibold truncate pointer-events-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                            {row.label}
                          </span>
                        )}
                        {isBehindSchedule && (
                          <div
                            className="absolute inset-0 rounded-md pointer-events-none opacity-30"
                            style={{
                              backgroundImage:
                                "repeating-linear-gradient(45deg, transparent, transparent 4px, hsl(var(--destructive)) 4px, hsl(var(--destructive)) 6px)",
                            }}
                          />
                        )}
                        {isProject && row.project && (row.project.priority === "critical" || row.project.priority === "high") && (
                          <div
                            className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-background"
                            style={{ backgroundColor: getPmPriorityHex(row.project.priority) }}
                            title={`Priority: ${getPmPriorityLabel(row.project.priority)}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════ */

function FilterSelect({ label, value, onChange, items, extraItems = [] }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { id: string; name: string }[];
  extraItems?: { id: string; name: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {extraItems.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ── Indentation + icon config per row kind ─────────── */
const ROW_CONFIG: Record<string, {
  pl: string;
  Icon: React.ComponentType<any>;
  iconClass: string;
  textClass: string;
  bgClass: string;
}> = {
  "workspace-header": {
    pl: "pl-3",
    Icon: Building2,
    iconClass: "h-4 w-4 text-foreground",
    textClass: "text-xs font-bold text-foreground uppercase tracking-wider",
    bgClass: "bg-muted/70 dark:bg-muted/50",
  },
  "program-header": {
    pl: "pl-7",
    Icon: FolderKanban,
    iconClass: "h-3.5 w-3.5 text-primary",
    textClass: "text-xs font-semibold text-primary",
    bgClass: "bg-muted/30 dark:bg-muted/20",
  },
  project: {
    pl: "pl-10",
    Icon: ChevronRight,
    iconClass: "h-3.5 w-3.5 text-foreground",
    textClass: "text-sm font-medium text-foreground",
    bgClass: "hover:bg-accent/40",
  },
  phase: {
    pl: "pl-16",
    Icon: Layers,
    iconClass: "h-3 w-3 text-muted-foreground",
    textClass: "text-xs text-muted-foreground",
    bgClass: "hover:bg-accent/30",
  },
  task: {
    pl: "pl-[5.5rem]",
    Icon: ListChecks,
    iconClass: "h-2.5 w-2.5 text-muted-foreground/70",
    textClass: "text-[11px] text-muted-foreground/80",
    bgClass: "hover:bg-accent/20",
  },
};

function LabelRow({
  row,
  summary,
  onToggle,
  onOpen,
}: {
  row: RoadmapRow;
  summary?: ProjectReportingSummary | null;
  onToggle?: (id: string) => void;
  onOpen?: () => void;
}) {
  const config = ROW_CONFIG[row.kind];
  if (!config) return null;

  const isHeader = row.kind === "workspace-header" || row.kind === "program-header";
  const isExpandable = row.expandable;
  const isExpanded = row.expanded;

  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 pr-2 border-b border-border/40 transition-colors",
        config.pl,
        config.bgClass,
        isExpandable && "cursor-pointer",
      )}
      style={{ height: ROW_HEIGHT }}
      onClick={isExpandable && onToggle ? () => onToggle(row.id) : undefined}
      role={isExpandable ? "button" : undefined}
      tabIndex={isExpandable ? 0 : undefined}
      onKeyDown={
        isExpandable && onToggle
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle(row.id);
              }
            }
          : undefined
      }
    >
      {/* Expand/collapse chevron or type icon */}
      {isExpandable ? (
        <ChevronIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform" />
      ) : !isHeader ? (
        <config.Icon className={cn(config.iconClass, "shrink-0")} />
      ) : (
        <config.Icon className={cn(config.iconClass, "shrink-0")} />
      )}

      {/* Label */}
      <span className={cn("truncate flex-1", config.textClass)}>
        {row.label}
      </span>

      {/* Health/Schedule dots (project only) */}
      {row.kind === "project" && row.project && (
        <HealthScheduleDots summary={summary} />
      )}

      {/* Priority badge (project only) */}
      {row.kind === "project" && row.project && (
        <Badge className={cn("text-[10px] px-1.5 py-0 h-4 shrink-0", getPmPriorityBadgeClass(row.project.priority))}>
          {getPmPriorityLabel(row.project.priority)}
        </Badge>
      )}

      {/* Status dot for phases/tasks */}
      {(row.kind === "phase" || row.kind === "task") && (
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: getPmWorkflowStatusHex((row.phase?.status || row.task?.status) ?? "planned") }}
          title={getPmWorkflowStatusLabel(row.phase?.status || row.task?.status)}
        />
      )}

      {/* Open-object button */}
      {onOpen && !isHeader && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              aria-label={`Open ${row.label}`}
            >
              <ExternalLink className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            Open {row.kind === "project" ? "project" : row.kind === "phase" ? "phase" : "task"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
