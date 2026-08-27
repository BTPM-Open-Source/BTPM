import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CalendarToolbar, type ViewMode } from "./CalendarToolbar";
import {
  CalendarFiltersPopover,
  DEFAULT_FILTERS,
  countActiveFilters,
  type CalendarFilters,
  type ObjectScope,
  type PresentationMode,
  type StatusValue,
  ALL_STATUSES,
} from "./CalendarFiltersPopover";
import { ProjectYearCalendar } from "./ProjectYearCalendar";
import { ProjectMonthCalendar } from "./ProjectMonthCalendar";
import { CalendarChainDrawer } from "./CalendarChainDrawer";
import { useProjectCalendarData } from "./useProjectCalendarData";
import {
  addMonths,
  endOfMonth,
  monthLongLabel,
  parseYmd,
  startOfMonth,
  type CalendarItem,
} from "./calendarUtils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isNonStandardType,
  SEMANTIC_TYPE_VALUES,
  type SemanticType,
} from "@/lib/phaseTypes";
import { codecs, usePersistedViewState } from "@/hooks/usePersistedViewState";
import { useSavedViews } from "@/hooks/useSavedViews";
import { SavedViewsControl } from "@/components/views/SavedViewsControl";
import { ProjectCalendarGovernancePanel } from "./ProjectCalendarGovernancePanel";
import {
  useProjectGovernanceCadences,
  useProjectGovernanceRecords,
} from "@/hooks/useProjectGovernance";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { RecordFormDialog } from "@/components/project/governance/RecordFormDialog";
import { RecordDetailDialog } from "@/components/project/governance/RecordDetailDialog";
import {
  buildGovernanceMarkers,
  type GovernanceMarker,
} from "./governanceMarkers";

interface Props {
  projectId: string;
  workspaceId: string;
  basePath: string;
}

const VIEW_MODES: readonly ViewMode[] = ["month", "year"] as const;
const PRESENTATION_MODES: readonly PresentationMode[] = ["timeline", "key_markers"] as const;
const SCOPE_VALUES: readonly ObjectScope[] = ["phase", "task"] as const;

/* ── Saved-view snapshot shape (durable fields only; anchor intentionally excluded) ── */
interface CalendarSavedView {
  viewMode: ViewMode;
  presentationMode: PresentationMode;
  scopes: ObjectScope[];
  semanticTypes: SemanticType[];
  statuses: StatusValue[];
  hideUndated: boolean;
}
const isCalendarSavedView = (raw: unknown): raw is CalendarSavedView => {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.viewMode === "string" &&
    (VIEW_MODES as readonly string[]).includes(r.viewMode) &&
    typeof r.presentationMode === "string" &&
    (PRESENTATION_MODES as readonly string[]).includes(r.presentationMode) &&
    Array.isArray(r.scopes) &&
    Array.isArray(r.semanticTypes) &&
    Array.isArray(r.statuses) &&
    typeof r.hideUndated === "boolean"
  );
};

export function ProjectCalendarView({ projectId, workspaceId, basePath }: Props) {
  const { items, itemsById, dependencies, isLoading, dependenciesLoading } = useProjectCalendarData(projectId);
  const location = useLocation();

  const { state: vs, setField } = usePersistedViewState({
    viewId: "project-calendar",
    scopeKey: projectId,
    schema: {
      viewMode: {
        mode: "url",
        urlKey: "view",
        default: "month" as ViewMode,
        codec: codecs.stringEnum(VIEW_MODES),
      },
      anchor: {
        mode: "url",
        urlKey: "anchor",
        default: startOfMonth(new Date()),
        codec: codecs.month,
        equals: (a, b) =>
          a instanceof Date &&
          b instanceof Date &&
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth(),
      },
      presentationMode: {
        mode: "url",
        urlKey: "pm",
        default: DEFAULT_FILTERS.presentationMode,
        codec: codecs.stringEnum(PRESENTATION_MODES),
      },
      scopes: {
        mode: "url",
        urlKey: "scope",
        default: DEFAULT_FILTERS.scopes,
        codec: codecs.stringArray(","),
      },
      semanticTypes: {
        mode: "url",
        urlKey: "type",
        default: DEFAULT_FILTERS.semanticTypes,
        codec: codecs.stringArray(","),
      },
      statuses: {
        mode: "url",
        urlKey: "status",
        default: DEFAULT_FILTERS.statuses,
        codec: codecs.stringArray(","),
      },
      hideUndated: {
        mode: "url",
        urlKey: "hideUndated",
        default: DEFAULT_FILTERS.hideUndated,
        codec: codecs.boolean,
      },
    },
  });

  const viewMode = vs.viewMode;
  const anchor = vs.anchor;

  const filters: CalendarFilters = useMemo(
    () => ({
      presentationMode: vs.presentationMode,
      scopes: (vs.scopes as ObjectScope[]).filter((s) => SCOPE_VALUES.includes(s)),
      semanticTypes: (vs.semanticTypes as SemanticType[]).filter((t) =>
        SEMANTIC_TYPE_VALUES.includes(t),
      ),
      statuses: (vs.statuses as StatusValue[]).filter((s) => ALL_STATUSES.includes(s)),
      hideUndated: vs.hideUndated,
    }),
    [vs.presentationMode, vs.scopes, vs.semanticTypes, vs.statuses, vs.hideUndated],
  );

  const setFilters = (next: CalendarFilters) => {
    setField("presentationMode", next.presentationMode);
    setField("scopes", next.scopes);
    setField("semanticTypes", next.semanticTypes);
    setField("statuses", next.statuses);
    setField("hideUndated", next.hideUndated);
  };

  const [drawerItem, setDrawerItem] = useState<CalendarItem | null>(null);
  const navigate = useNavigate();

  /* ── GT.6a — Governance markers in day cells (read-only). Reuses GT.1/GT.2 RPCs. ── */
  const { canEdit } = useProjectPlanningAuthority(projectId);
  const cadencesQ = useProjectGovernanceCadences(projectId, false);
  const recordsQ = useProjectGovernanceRecords(projectId, false);
  const [govFormOpen, setGovFormOpen] = useState(false);
  const [govPreselectedCadenceId, setGovPreselectedCadenceId] = useState<string | null>(null);
  const [govDetailRecordId, setGovDetailRecordId] = useState<string | null>(null);

  const allGovernanceMarkers = useMemo(
    () => buildGovernanceMarkers(cadencesQ.data ?? [], recordsQ.data ?? []),
    [cadencesQ.data, recordsQ.data],
  );

  /* ── Saved views (Phase 4E.6) — durable fields only; anchor + drawer intentionally excluded ── */
  const savedViews = useSavedViews<CalendarSavedView>({
    viewId: "project-calendar",
    scopeKey: projectId,
    validate: isCalendarSavedView,
  });
  const currentSavedSnapshot: CalendarSavedView = useMemo(
    () => ({
      viewMode: vs.viewMode,
      presentationMode: vs.presentationMode,
      scopes: vs.scopes as ObjectScope[],
      semanticTypes: vs.semanticTypes as SemanticType[],
      statuses: vs.statuses as StatusValue[],
      hideUndated: vs.hideUndated,
    }),
    [vs.viewMode, vs.presentationMode, vs.scopes, vs.semanticTypes, vs.statuses, vs.hideUndated],
  );
  const applySavedView = (snap: CalendarSavedView) => {
    setField("viewMode", snap.viewMode);
    setField("presentationMode", snap.presentationMode);
    setField("scopes", snap.scopes);
    setField("semanticTypes", snap.semanticTypes);
    setField("statuses", snap.statuses);
    setField("hideUndated", snap.hideUndated);
  };

  const calendarReturnTo = location.pathname + location.search;
  const presentationMode = filters.presentationMode;
  const displayMode = presentationMode === "timeline" ? "schedule" : "milestones";

  const filteredItems = useMemo(() => {
    const semanticSet = new Set<SemanticType>(filters.semanticTypes);
    const statusSet = new Set<StatusValue>(filters.statuses);
    return items.filter((i) => {
      if (!filters.scopes.includes(i.kind)) return false;
      if (!semanticSet.has((i.semanticType as SemanticType) ?? "work_item")) return false;
      if (!statusSet.has(i.status as StatusValue)) return false;
      if (filters.hideUndated) {
        const hasAnyDate = !!(i.start || i.end || i.keyDate);
        if (!hasAnyDate) return false;
      }
      return true;
    });
  }, [items, filters]);

  const activeFilterCount = countActiveFilters(filters, DEFAULT_FILTERS);

  const periodLabel = viewMode === "month"
    ? monthLongLabel(anchor)
    : `${monthLongLabel(anchor)} → ${monthLongLabel(addMonths(anchor, 11))}`;

  const handlePrev = () => setField("anchor", addMonths(anchor, viewMode === "month" ? -1 : -12));
  const handleNext = () => setField("anchor", addMonths(anchor, viewMode === "month" ? 1 : 12));
  const handleToday = () => setField("anchor", startOfMonth(new Date()));

  const handleMonthClick = (m: Date) => {
    setField("anchor", startOfMonth(m));
    setField("viewMode", "month");
  };

  const handleItemClick = (item: CalendarItem) => {
    if (presentationMode === "key_markers" && isNonStandardType(item.semanticType)) {
      setDrawerItem(item);
      return;
    }
    const ret = encodeURIComponent(calendarReturnTo);
    const seg = item.kind === "phase" ? "phase" : "task";
    window.location.assign(`${basePath}/${seg}/${item.id}?from=calendar&returnTo=${ret}`);
  };

  /* GT.6a — visible-window governance markers + click handler */
  const governanceTabPath = `/workspace/${workspaceId}/project/${projectId}/governance`;

  const visibleGovernanceMarkers = useMemo<GovernanceMarker[]>(() => {
    const winStart = startOfMonth(anchor);
    const winEnd =
      viewMode === "month" ? endOfMonth(anchor) : endOfMonth(addMonths(winStart, 11));
    return allGovernanceMarkers.filter((m) => {
      const d = parseYmd(m.date);
      return !!d && d >= winStart && d <= winEnd;
    });
  }, [allGovernanceMarkers, anchor, viewMode]);

  const handleGovernanceMarkerClick = (m: GovernanceMarker) => {
    if (m.kind === "completed" && m.record) {
      setGovDetailRecordId(m.record.id);
      return;
    }
    if (!m.cadence) return;
    if (!canEdit) {
      navigate(governanceTabPath);
      return;
    }
    setGovPreselectedCadenceId(m.cadence.id);
    setGovFormOpen(true);
  };

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  const helperText = presentationMode === "timeline"
    ? "Showing full scheduled spans for the selected phases and tasks."
    : "Showing only typed end-date markers (Milestone, Deliverable, Decision, Review). Click a marker to inspect upstream dependencies.";


  return (
    <div className="space-y-4">
      <CalendarToolbar
        viewMode={viewMode}
        filters={filters}
        defaultFilters={DEFAULT_FILTERS}
        periodLabel={periodLabel}
        activeFilterCount={activeFilterCount}
        onViewMode={(v) => setField("viewMode", v)}
        onFiltersChange={setFilters}
        onClearFilters={() => setFilters(DEFAULT_FILTERS)}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{helperText}</p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm border border-primary/40 bg-primary/15" /> Phase span
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm border border-border bg-secondary" /> Task span
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm border border-primary/40 bg-primary/10 ring-1 ring-primary/20" /> Key marker
            </span>
            {/* GT.6a — Governance marker legend (read-only) */}
            <span className="inline-flex items-center gap-1" title="Read-only governance markers, not scheduled meetings">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Expected governance
            </span>
            <span className="inline-flex items-center gap-1" title="Read-only governance markers, not scheduled meetings">
              <span className="inline-block h-2 w-2 rounded-full bg-destructive" /> Overdue governance
            </span>
            <span className="inline-flex items-center gap-1" title="Read-only governance markers, not scheduled meetings">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Completed governance
            </span>
          </div>
          <SavedViewsControl<CalendarSavedView>
            views={savedViews.views}
            currentState={currentSavedSnapshot}
            onSave={(name, state) => savedViews.saveView(name, state)}
            onApply={applySavedView}
            onRename={savedViews.renameView}
            onDelete={savedViews.deleteView}
          />
        </div>
      </div>

      {viewMode === "year" ? (
        <ProjectYearCalendar
          anchor={anchor}
          items={filteredItems}
          displayMode={displayMode}
          onMonthClick={handleMonthClick}
          onItemClick={handleItemClick}
          governanceMarkers={visibleGovernanceMarkers}
        />
      ) : (
        <ProjectMonthCalendar
          anchor={anchor}
          items={filteredItems}
          displayMode={displayMode}
          onItemClick={handleItemClick}
          governanceMarkers={visibleGovernanceMarkers}
          onGovernanceMarkerClick={handleGovernanceMarkerClick}
        />
      )}

      <CalendarChainDrawer
        open={!!drawerItem}
        onClose={() => setDrawerItem(null)}
        rootItem={drawerItem}
        itemsById={itemsById}
        dependencies={dependencies as any}
        dependenciesLoading={dependenciesLoading}
        basePath={basePath}
        calendarReturnTo={calendarReturnTo}
      />

      {/* GT.6 — Governance visibility layer (summary list, kept as supporting view) */}
      <ProjectCalendarGovernancePanel
        projectId={projectId}
        workspaceId={workspaceId}
        anchor={anchor}
        viewMode={viewMode}
      />

      {/* GT.6a — Reused governance dialogs for in-cell marker clicks */}
      <RecordFormDialog
        open={govFormOpen}
        onOpenChange={(v) => {
          setGovFormOpen(v);
          if (!v) setGovPreselectedCadenceId(null);
        }}
        projectId={projectId}
        preselectedCadenceId={govPreselectedCadenceId}
      />
      <RecordDetailDialog
        open={!!govDetailRecordId}
        onOpenChange={(v) => {
          if (!v) setGovDetailRecordId(null);
        }}
        recordId={govDetailRecordId}
      />
    </div>
  );
}

// Re-export so external imports (if any) stay working — but the popover is
// rendered inside the toolbar.
export { CalendarFiltersPopover };
