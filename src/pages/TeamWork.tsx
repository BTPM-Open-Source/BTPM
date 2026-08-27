/**
 * Phase 4D Step 4D.3 — Team Work overview page.
 *
 * Lightweight operational view of authorized team work. Consumes the protected
 * `useTeamWorkOverview` hook (RPC `public.get_team_work_overview`). No direct
 * table queries, no persistent rollups, no capacity planning.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useActiveWorkspace } from "@/context/ActiveWorkspaceContext";
import {
  useTeamWorkOverview,
  type TeamWorkItem,
  type TeamWorkTimeWindow,
} from "@/hooks/useTeamWorkOverview";
import { useUserSavedViews } from "@/hooks/useUserSavedViews";
import { SavedViewsControl } from "@/components/views/SavedViewsControl";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { AlertCircle, ChevronDown, RotateCcw, X, Mail } from "lucide-react";
import { TeamWorkReminderDialog } from "@/components/work/TeamWorkReminderDialog";
import { TaskAccountabilityInline } from "@/components/planning/TaskAccountabilityInline";
import {
  applyAccountabilityFilter,
  deriveExecutorOptions,
  deriveRequesterOptions,
} from "@/lib/teamWork/teamWorkAccountabilityFilter";

/** Sentinel option id representing "no Requester" / "no Executors" inside the
 * shared MultiSelectFilter control (TAE.9C). Kept out of the option-derivation
 * helpers because those describe real stakeholders only. */
const NO_REQUESTER_SENTINEL = "__no_requester__";
const NO_EXECUTORS_SENTINEL = "__no_executors__";

/* ── Team Work saved-view snapshot (durable filter spec, never report data) ── */
const TEAM_WORK_LENSES = ["attention", "by_person", "by_project"] as const;
type TeamWorkLens = typeof TEAM_WORK_LENSES[number];
const TEAM_WORK_TIME_WINDOWS = [
  "today",
  "this_week",
  "next_2_weeks",
  "next_30_days",
  "all_open",
] as const;

import {
  validateAccountabilitySavedViewFields,
  readAccountabilityFromSnapshot,
  writeAccountabilityToSnapshot,
  accountabilitySnapshotEqual,
  type AccountabilitySavedViewFields,
} from "@/lib/teamWork/teamWorkSavedViewAccountability";

interface TeamWorkSavedView extends AccountabilitySavedViewFields {
  lens: TeamWorkLens;
  all_workspaces: boolean;
  workspace_ids: string[];
  time_window: TeamWorkTimeWindow;
  program_ids: string[];
  project_ids: string[];
  assignee_ids: string[];
  statuses: string[];
  priorities: string[];
  /** Added in Step 6D.6A. Missing on older saved views → defaults to []. */
  portfolio_ids: string[];
  // TAE.9D — optional accountability fields (all default to []/false when
  // absent to preserve older saved-view compatibility).
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

const isTeamWorkSavedView = (raw: unknown): raw is TeamWorkSavedView => {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.lens === "string" &&
    (TEAM_WORK_LENSES as readonly string[]).includes(r.lens) &&
    typeof r.all_workspaces === "boolean" &&
    isStringArray(r.workspace_ids) &&
    typeof r.time_window === "string" &&
    (TEAM_WORK_TIME_WINDOWS as readonly string[]).includes(r.time_window) &&
    isStringArray(r.program_ids) &&
    isStringArray(r.project_ids) &&
    isStringArray(r.assignee_ids) &&
    isStringArray(r.statuses) &&
    isStringArray(r.priorities) &&
    // portfolio_ids is optional for backward compatibility.
    (r.portfolio_ids === undefined || isStringArray(r.portfolio_ids)) &&
    // TAE.9D — accountability fields optional; if present must be well-typed.
    validateAccountabilitySavedViewFields(r)
  );
};

const snapshotsEqual = (a: TeamWorkSavedView, b: TeamWorkSavedView) => {
  const eqArr = (x: string[], y: string[]) => {
    if (x.length !== y.length) return false;
    const xs = [...x].sort();
    const ys = [...y].sort();
    return xs.every((v, i) => v === ys[i]);
  };
  return (
    a.lens === b.lens &&
    a.all_workspaces === b.all_workspaces &&
    a.time_window === b.time_window &&
    eqArr(a.workspace_ids, b.workspace_ids) &&
    eqArr(a.program_ids, b.program_ids) &&
    eqArr(a.project_ids, b.project_ids) &&
    eqArr(a.assignee_ids, b.assignee_ids) &&
    eqArr(a.statuses, b.statuses) &&
    eqArr(a.priorities, b.priorities) &&
    eqArr(a.portfolio_ids ?? [], b.portfolio_ids ?? []) &&
    accountabilitySnapshotEqual(a, b)
  );
};


const TIME_WINDOWS: { value: TeamWorkTimeWindow; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "next_2_weeks", label: "Next 2 weeks" },
  { value: "next_30_days", label: "Next 30 days" },
  { value: "all_open", label: "All open" },
];

const ALL = "__all__";

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fmtHours(n: number | null | undefined) {
  if (n == null) return "—";
  return `${Number(n).toFixed(Number(n) % 1 === 0 ? 0 : 1)}h`;
}

function formatPortfolioFromFields(
  id: string | null | undefined,
  name: string | null | undefined,
  code: string | null | undefined,
  isArchived: boolean | null | undefined,
): string | null {
  if (!id) return null;
  const base = code ? `${code} — ${name ?? "Unnamed Portfolio"}` : name ?? "Unnamed Portfolio";
  return isArchived ? `${base} (archived)` : base;
}


function reasonChips(item: TeamWorkItem) {
  const chips: { label: string; variant: "destructive" | "secondary" | "outline" | "default" }[] = [];
  if (item.is_overdue) chips.push({ label: "Overdue", variant: "destructive" });
  if (item.is_due_today) chips.push({ label: "Due today", variant: "default" });
  if (item.is_blocked) chips.push({ label: "Blocked", variant: "destructive" });
  if (item.is_unassigned) chips.push({ label: "Unassigned", variant: "outline" });
  if (item.is_high_priority) chips.push({ label: "High priority", variant: "secondary" });
  if (item.is_unestimated) chips.push({ label: "No estimate", variant: "outline" });
  if (item.is_upcoming && !item.is_due_today && !item.is_overdue)
    chips.push({ label: "Upcoming", variant: "secondary" });
  if (item.is_stale) chips.push({ label: "Stale", variant: "outline" });
  return chips;
}

function sortKey(item: TeamWorkItem): [number, number] {
  // Lower = higher priority
  let bucket = 6;
  if (item.is_overdue) bucket = 0;
  else if (item.is_due_today) bucket = 1;
  else if (item.is_blocked) bucket = 2;
  else if (item.is_high_priority) bucket = 3;
  else if (item.is_upcoming) bucket = 4;
  else if (item.due_date) bucket = 5;
  const due = item.due_date ? new Date(item.due_date).getTime() : Number.MAX_SAFE_INTEGER;
  return [bucket, due];
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold text-foreground mt-0.5">{value}</div>
      </CardContent>
    </Card>
  );
}


interface MultiSelectFilterProps {
  label: string;            // e.g. "programs"
  singularNoun: string;     // e.g. "program"
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  width?: string;
}

function MultiSelectFilter({
  label,
  singularNoun,
  options,
  selected,
  onChange,
  width = "w-[180px]",
}: MultiSelectFilterProps) {
  const [query, setQuery] = useState("");
  const triggerLabel =
    selected.length === 0
      ? `All ${label}`
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.name ?? `1 ${singularNoun}`
        : `${selected.length} ${label}`;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const showSearch = options.length > 8;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`${width} justify-between font-normal`}
        >
          <span className="truncate text-left">{triggerLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-2" align="start">
        {showSearch && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label}…`}
            className="w-full text-xs px-2 py-1.5 rounded border border-input bg-background mb-1 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}
        <div className="flex gap-1 px-1 pb-1">
          <button
            type="button"
            onClick={() => onChange(options.map((o) => o.id))}
            className="flex-1 text-left text-xs px-2 py-1 rounded hover:bg-accent text-muted-foreground"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex-1 text-left text-xs px-2 py-1 rounded hover:bg-accent text-muted-foreground"
          >
            Clear
          </button>
        </div>
        <div className="my-1 h-px bg-border" />
        <div className="max-h-[260px] overflow-y-auto pr-1">
          {options.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-1.5">
              No {label} in current data
            </div>
          ) : visible.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-1.5">
              No matches
            </div>
          ) : (
            visible.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={selected.includes(o.id)}
                  onCheckedChange={() => toggle(o.id)}
                />
                <span className="truncate">{o.name}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}



export default function TeamWork() {
  const { activeScope, workspaces } = useActiveWorkspace();

  // Local Team Work report scope: a set of selected workspace IDs.
  // Empty set means "All accessible workspaces" (RPC: no workspace restriction).
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>(
    activeScope.type === "workspace" ? [activeScope.workspaceId] : [],
  );

  // Adopt the active workspace as the default once workspaces have loaded.
  const [didInit, setDidInit] = useState(false);
  if (!didInit && workspaces.length > 0) {
    setDidInit(true);
    if (
      activeScope.type === "workspace" &&
      workspaces.some((w) => w.id === activeScope.workspaceId)
    ) {
      setSelectedWorkspaceIds([activeScope.workspaceId]);
    }
  }

  const showScopeSelector = workspaces.length > 1;
  const allAccessible =
    selectedWorkspaceIds.length === 0 ||
    selectedWorkspaceIds.length === workspaces.length;

  const [wsQuery, setWsQuery] = useState("");
  const visibleWorkspaces = useMemo(() => {
    const q = wsQuery.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter((w) => w.name.toLowerCase().includes(q));
  }, [workspaces, wsQuery]);


  const scopeLabel = allAccessible
    ? "All accessible workspaces"
    : selectedWorkspaceIds.length === 1
      ? workspaces.find((w) => w.id === selectedWorkspaceIds[0])?.name ?? "Workspace"
      : `${selectedWorkspaceIds.length} workspaces`;

  const [timeWindow, setTimeWindow] = useState<TeamWorkTimeWindow>("this_week");
  const [portfolios, setPortfolios] = useState<string[]>([]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  // TAE.9C — accountability filter values (client-side only).
  const [requesterIds, setRequesterIds] = useState<string[]>([]);
  const [executorIds, setExecutorIds] = useState<string[]>([]);
  const [includeNoRequester, setIncludeNoRequester] = useState(false);
  const [includeNoExecutors, setIncludeNoExecutors] = useState(false);

  const resetDependentFilters = () => {
    setPortfolios([]);
    setPrograms([]);
    setProjects([]);
    setAssignees([]);
    setStatuses([]);
    setPriorities([]);
    setRequesterIds([]);
    setExecutorIds([]);
    setIncludeNoRequester(false);
    setIncludeNoExecutors(false);
  };


  const toggleWorkspace = (id: string) => {
    setSelectedWorkspaceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    resetDependentFilters();
  };

  const selectAllWorkspaces = () => {
    setSelectedWorkspaceIds([]);
    resetDependentFilters();
  };

  const { data, isLoading, error } = useTeamWorkOverview({
    workspaceIds: allAccessible ? null : selectedWorkspaceIds,
    timeWindow,
    includeCompleted: false,
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);


  const portfolioOpts = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((i) => {
      if (!i.portfolio_item_id) return;
      const label = formatPortfolioFromFields(
        i.portfolio_item_id,
        i.portfolio_name,
        i.portfolio_code,
        i.portfolio_is_archived,
      );
      if (label) m.set(i.portfolio_item_id, label);
    });
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [items]);

  const programOpts = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((i) => {
      if (i.program_id) m.set(i.program_id, i.program_name ?? "(Unnamed program)");
    });
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [items]);

  const projectOpts = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((i) => m.set(i.project_id, i.project_name ?? "(Unnamed project)"));
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [items]);


  const assigneeOpts = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((i) => {
      const id = i.assignee_id ?? "__unassigned__";
      const name = i.assignee_id
        ? i.assignee_name ?? i.assignee_email ?? "(Unknown)"
        : "Unassigned";
      m.set(id, name);
    });
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [items]);

  const statusOpts = useMemo(
    () =>
      Array.from(new Set(items.map((i) => i.task_status).filter(Boolean))).map(
        (s) => ({ id: s, name: s }),
      ),
    [items],
  );
  const priorityOpts = useMemo(
    () =>
      Array.from(
        new Set(items.map((i) => i.task_priority).filter(Boolean) as string[]),
      ).map((p) => ({ id: p, name: p })),
    [items],
  );

  // Self-correct: when the option set changes (workspace/time-window/data),
  // prune any selected filter values that are no longer valid.
  useEffect(() => {
    const ids = new Set(programOpts.map((o) => o.id));
    setPrograms((prev) => prev.filter((x) => ids.has(x)));
  }, [programOpts]);
  useEffect(() => {
    const ids = new Set(projectOpts.map((o) => o.id));
    setProjects((prev) => prev.filter((x) => ids.has(x)));
  }, [projectOpts]);
  useEffect(() => {
    const ids = new Set(assigneeOpts.map((o) => o.id));
    setAssignees((prev) => prev.filter((x) => ids.has(x)));
  }, [assigneeOpts]);
  useEffect(() => {
    const ids = new Set(statusOpts.map((o) => o.id));
    setStatuses((prev) => prev.filter((x) => ids.has(x)));
  }, [statusOpts]);
  useEffect(() => {
    const ids = new Set(priorityOpts.map((o) => o.id));
    setPriorities((prev) => prev.filter((x) => ids.has(x)));
  }, [priorityOpts]);
  useEffect(() => {
    const ids = new Set(portfolioOpts.map((o) => o.id));
    setPortfolios((prev) => prev.filter((x) => ids.has(x)));
  }, [portfolioOpts]);

  // TAE.9C — Requester/Executor option lists derived from already-loaded items.
  const requesterStakeholderOpts = useMemo(() => deriveRequesterOptions(items), [items]);
  const executorStakeholderOpts = useMemo(() => deriveExecutorOptions(items), [items]);

  // Prepend sentinel "No Requester" / "No Executors" entries into the shared
  // MultiSelectFilter option lists so the UI stays consistent while state
  // remains split into IDs + boolean per the TAE.9C contract.
  const requesterFilterOpts = useMemo(
    () => [
      { id: NO_REQUESTER_SENTINEL, name: "No Requester" },
      ...requesterStakeholderOpts,
    ],
    [requesterStakeholderOpts],
  );
  const executorFilterOpts = useMemo(
    () => [
      { id: NO_EXECUTORS_SENTINEL, name: "No Executors" },
      ...executorStakeholderOpts,
    ],
    [executorStakeholderOpts],
  );

  const requesterSelectionForControl = useMemo(
    () => (includeNoRequester ? [NO_REQUESTER_SENTINEL, ...requesterIds] : requesterIds),
    [includeNoRequester, requesterIds],
  );
  const executorSelectionForControl = useMemo(
    () => (includeNoExecutors ? [NO_EXECUTORS_SENTINEL, ...executorIds] : executorIds),
    [includeNoExecutors, executorIds],
  );

  const onRequesterSelectionChange = useCallback((next: string[]) => {
    setIncludeNoRequester(next.includes(NO_REQUESTER_SENTINEL));
    setRequesterIds(next.filter((x) => x !== NO_REQUESTER_SENTINEL));
  }, []);
  const onExecutorSelectionChange = useCallback((next: string[]) => {
    setIncludeNoExecutors(next.includes(NO_EXECUTORS_SENTINEL));
    setExecutorIds(next.filter((x) => x !== NO_EXECUTORS_SENTINEL));
  }, []);

  // Prune Requester/Executor selections when the underlying option set changes.
  useEffect(() => {
    const ids = new Set(requesterStakeholderOpts.map((o) => o.id));
    setRequesterIds((prev) => prev.filter((x) => ids.has(x)));
  }, [requesterStakeholderOpts]);
  useEffect(() => {
    const ids = new Set(executorStakeholderOpts.map((o) => o.id));
    setExecutorIds((prev) => prev.filter((x) => ids.has(x)));
  }, [executorStakeholderOpts]);

  // Standard-filtered collection. Feeds summary cards, By Person, and
  // By Project — Requester/Executor filters must NOT affect those lenses
  // (TAE.9C.1 correction).
  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (portfolios.length > 0) {
        if (!i.portfolio_item_id || !portfolios.includes(i.portfolio_item_id)) return false;
      }
      if (programs.length > 0) {
        if (!i.program_id || !programs.includes(i.program_id)) return false;
      }
      if (projects.length > 0 && !projects.includes(i.project_id)) return false;
      if (assignees.length > 0) {
        const id = i.assignee_id ?? "__unassigned__";

        if (!assignees.includes(id)) return false;
      }
      if (statuses.length > 0 && !statuses.includes(i.task_status)) return false;
      if (priorities.length > 0) {
        if (!i.task_priority || !priorities.includes(i.task_priority)) return false;
      }
      return true;
    });
  }, [items, portfolios, programs, projects, assignees, statuses, priorities]);

  // Attention/task-list collection: standard filters + accountability filters.
  // Only the Attention list (sorting, rows, bulk selection, bulk reminders,
  // empty state) consumes this collection.
  const attentionFiltered = useMemo(
    () =>
      applyAccountabilityFilter(filtered, {
        requesterIds,
        executorIds,
        includeNoRequester,
        includeNoExecutors,
      }),
    [filtered, requesterIds, executorIds, includeNoRequester, includeNoExecutors],
  );

  const sorted = useMemo(() => {
    return [...attentionFiltered].sort((a, b) => {
      const [ab, ad] = sortKey(a);
      const [bb, bd] = sortKey(b);
      if (ab !== bb) return ab - bb;
      return ad - bd;
    });
  }, [attentionFiltered]);

  // Prune bulk-reminder selection when the visible Attention rows change
  // (filters/scope/time-window/data update).
  useEffect(() => {
    const visible = new Set(sorted.map((s) => s.task_id));
    setSelectedTaskIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sorted]);


  // Derive filtered summary so cards match the visible table.
  const summary = useMemo(() => {
    let overdue = 0,
      dueToday = 0,
      upcoming = 0,
      blocked = 0,
      unassigned = 0,
      highPriority = 0,
      noEstimate = 0,
      estHours = 0;
    for (const i of filtered) {
      if (i.is_overdue) overdue++;
      if (i.is_due_today) dueToday++;
      if (i.is_upcoming) upcoming++;
      if (i.is_blocked) blocked++;
      if (i.is_unassigned) unassigned++;
      if (i.is_high_priority) highPriority++;
      if (i.is_unestimated) noEstimate++;
      if (i.estimated_hours) estHours += Number(i.estimated_hours);
    }
    return {
      overdue,
      dueToday,
      upcoming,
      blocked,
      unassigned,
      highPriority,
      noEstimate,
      estHours,
    };
  }, [filtered]);

  // ---- Lens (Attention list / By person / By project) ----
  type Lens = "attention" | "by_person" | "by_project";
  const [lens, setLens] = useState<Lens>("attention");

  // ---- Bulk reminder selection (Attention list only) ----
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [reminderOpen, setReminderOpen] = useState(false);


  type PersonRow = {
    key: string;            // assignee_id or "__unassigned__"
    name: string;
    open: number;
    overdue: number;
    dueThisWeek: number;
    blocked: number;
    highPriority: number;
    noEstimate: number;
    estHours: number;
    isUnassigned: boolean;
  };

  const byPerson = useMemo<PersonRow[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const map = new Map<string, PersonRow>();
    for (const i of filtered) {
      const key = i.assignee_id ?? "__unassigned__";
      const name = i.assignee_id
        ? i.assignee_name ?? i.assignee_email ?? "(Unknown)"
        : "Unassigned";
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          name,
          open: 0,
          overdue: 0,
          dueThisWeek: 0,
          blocked: 0,
          highPriority: 0,
          noEstimate: 0,
          estHours: 0,
          isUnassigned: !i.assignee_id,
        };
        map.set(key, row);
      }
      const isOpen =
        i.task_status !== "completed" && i.task_status !== "cancelled";
      if (isOpen) row.open++;
      if (i.is_overdue) row.overdue++;
      if (i.due_date) {
        const d = new Date(i.due_date);
        d.setHours(0, 0, 0, 0);
        if (isOpen && d >= today && d <= weekEnd) row.dueThisWeek++;
      }
      if (i.is_blocked) row.blocked++;
      if (i.is_high_priority && isOpen) row.highPriority++;
      if (i.is_unestimated && isOpen) row.noEstimate++;
      if (i.estimated_hours && isOpen) row.estHours += Number(i.estimated_hours);
    }
    const rows = Array.from(map.values());
    rows.sort((a, b) => {
      // Unassigned last; otherwise overdue desc, then open desc, then name.
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      if (b.overdue !== a.overdue) return b.overdue - a.overdue;
      if (b.open !== a.open) return b.open - a.open;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [filtered]);

  const viewPersonWork = (personKey: string) => {
    setAssignees([personKey]);
    setLens("attention");
  };

  type ProjectRow = {
    projectId: string;
    projectName: string;
    workspaceId: string;
    workspaceName: string;
    portfolioLabel: string | null;
    open: number;
    overdue: number;
    dueNext7: number;
    blocked: number;
    highPriority: number;
    unassigned: number;
    noEstimate: number;
    estHours: number;
  };

  const byProject = useMemo<ProjectRow[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const map = new Map<string, ProjectRow>();
    for (const i of filtered) {
      let row = map.get(i.project_id);
      if (!row) {
        row = {
          projectId: i.project_id,
          projectName: i.project_name ?? "(Unnamed project)",
          workspaceId: i.workspace_id,
          workspaceName: i.workspace_name ?? "—",
          portfolioLabel: formatPortfolioFromFields(
            i.portfolio_item_id,
            i.portfolio_name,
            i.portfolio_code,
            i.portfolio_is_archived,
          ),
          open: 0,
          overdue: 0,
          dueNext7: 0,
          blocked: 0,
          highPriority: 0,
          unassigned: 0,
          noEstimate: 0,
          estHours: 0,

        };
        map.set(i.project_id, row);
      }
      const isOpen =
        i.task_status !== "completed" && i.task_status !== "cancelled";
      if (isOpen) row.open++;
      if (i.is_overdue) row.overdue++;
      if (i.due_date) {
        const d = new Date(i.due_date);
        d.setHours(0, 0, 0, 0);
        if (isOpen && d >= today && d <= weekEnd) row.dueNext7++;
      }
      if (i.is_blocked) row.blocked++;
      if (i.is_high_priority && isOpen) row.highPriority++;
      if (i.is_unassigned && isOpen) row.unassigned++;
      if (i.is_unestimated && isOpen) row.noEstimate++;
      if (i.estimated_hours && isOpen) row.estHours += Number(i.estimated_hours);
    }
    const rows = Array.from(map.values());
    rows.sort((a, b) => {
      if (b.overdue !== a.overdue) return b.overdue - a.overdue;
      if (b.blocked !== a.blocked) return b.blocked - a.blocked;
      if (b.open !== a.open) return b.open - a.open;
      if (b.dueNext7 !== a.dueNext7) return b.dueNext7 - a.dueNext7;
      return a.projectName.localeCompare(b.projectName);
    });
    return rows;
  }, [filtered]);

  const viewProjectWork = (projectId: string) => {
    setProjects([projectId]);
    setLens("attention");
  };

  /* ── Saved views (server-backed, per-user, encrypted state payload) ─────
     Stores only filter/scope/lens configuration — never report results,
     decrypted labels, task rows, or summary totals. Inaccessible IDs are
     pruned by the existing reconciliation effects after apply. */
  const { toast } = useToast();
  const savedViews = useUserSavedViews<TeamWorkSavedView>({
    surfaceKey: "team-work",
    scopeKey: "global",
    validate: isTeamWorkSavedView,
  });

  const currentSavedSnapshot: TeamWorkSavedView = useMemo(
    () => ({
      lens,
      all_workspaces: allAccessible,
      workspace_ids: allAccessible ? [] : selectedWorkspaceIds,
      time_window: timeWindow,
      program_ids: programs,
      project_ids: projects,
      assignee_ids: assignees,
      statuses,
      priorities,
      portfolio_ids: portfolios,
      ...writeAccountabilityToSnapshot({
        requesterIds,
        executorIds,
        includeNoRequester,
        includeNoExecutors,
      }),
    }),
    [
      lens,
      allAccessible,
      selectedWorkspaceIds,
      timeWindow,
      programs,
      projects,
      assignees,
      statuses,
      priorities,
      portfolios,
      requesterIds,
      executorIds,
      includeNoRequester,
      includeNoExecutors,
    ],
  );

  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const activeView = useMemo(
    () => savedViews.views.find((v) => v.id === activeViewId) ?? null,
    [savedViews.views, activeViewId],
  );
  const hasUnsavedChanges = useMemo(
    () => (activeView ? !snapshotsEqual(activeView.state, currentSavedSnapshot) : false),
    [activeView, currentSavedSnapshot],
  );

  const applySnapshot = useCallback(
    (snap: TeamWorkSavedView) => {
      const lensValue = (TEAM_WORK_LENSES as readonly string[]).includes(snap.lens)
        ? snap.lens
        : "attention";
      const tw = (TEAM_WORK_TIME_WINDOWS as readonly string[]).includes(snap.time_window)
        ? snap.time_window
        : "this_week";

      // Prune workspace IDs against currently accessible workspaces.
      const wsValid = new Set(workspaces.map((w) => w.id));
      const wsIn = Array.isArray(snap.workspace_ids) ? snap.workspace_ids : [];
      const wsPruned = wsIn.filter((id) => wsValid.has(id));
      const droppedWs = wsIn.length !== wsPruned.length;

      setLens(lensValue as TeamWorkLens);
      setTimeWindow(tw);
      setSelectedWorkspaceIds(snap.all_workspaces ? [] : wsPruned);
      // Programs/projects/assignees/statuses/priorities are option-pruned
      // by the existing reconciliation effects once items reload.
      setPrograms(Array.isArray(snap.program_ids) ? snap.program_ids : []);
      setProjects(Array.isArray(snap.project_ids) ? snap.project_ids : []);
      setAssignees(Array.isArray(snap.assignee_ids) ? snap.assignee_ids : []);
      setStatuses(Array.isArray(snap.statuses) ? snap.statuses : []);
      setPriorities(Array.isArray(snap.priorities) ? snap.priorities : []);
      setPortfolios(Array.isArray(snap.portfolio_ids) ? snap.portfolio_ids : []);

      // TAE.9D — restore accountability fields with safe defaults. Applying
      // an older saved view (fields absent) explicitly clears any currently
      // active Requester/Executor filters rather than leaving stale state.
      const acc = readAccountabilityFromSnapshot(snap);
      setRequesterIds(acc.requesterIds);
      setExecutorIds(acc.executorIds);
      setIncludeNoRequester(acc.includeNoRequester);
      setIncludeNoExecutors(acc.includeNoExecutors);


      if (droppedWs) {
        toast({
          title: "Some saved filters are no longer available",
          description: "Inaccessible workspaces were removed from the applied view.",
        });
      }
    },
    [workspaces, toast],
  );

  const handleSaveView = useCallback(
    async (name: string, snap: TeamWorkSavedView) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const duplicate = savedViews.views.some(
        (v) => v.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (duplicate) {
        toast({
          title: "A view with that name already exists",
          description: "Pick a different name or update the existing view.",
          variant: "destructive",
        });
        return;
      }
      const result = await savedViews.saveView(trimmed, snap);
      if (!result) {
        toast({
          title: "Could not save view",
          description: "Please try again.",
          variant: "destructive",
        });
        return;
      }
      setActiveViewId(result.id);
    },
    [savedViews, toast],
  );

  const handleApplySavedView = useCallback(
    (snap: TeamWorkSavedView) => {
      applySnapshot(snap);
      const match = savedViews.views.find((v) => snapshotsEqual(v.state, snap));
      setActiveViewId(match?.id ?? null);
    },
    [applySnapshot, savedViews.views],
  );

  const handleRenameSavedView = useCallback(
    async (id: string, name: string) => {
      try {
        await savedViews.renameView(id, name);
      } catch {
        toast({ title: "Could not rename view", variant: "destructive" });
      }
    },
    [savedViews, toast],
  );

  const handleDeleteSavedView = useCallback(
    async (id: string) => {
      try {
        await savedViews.deleteView(id);
        if (activeViewId === id) setActiveViewId(null);
      } catch {
        toast({ title: "Could not delete view", variant: "destructive" });
      }
    },
    [savedViews, toast, activeViewId],
  );

  const handleUpdateActiveView = useCallback(async () => {
    if (!activeView) return;
    try {
      // Reuse the upsert path by saving with the same name; the hook's
      // renameView writes the existing state, so we go via saveView semantics
      // by deleting + recreating is wrong (it'd lose id). Instead we call the
      // RPC directly through renameView semantics extended to state below.
      // Simpler: call upsert via the same hook by mutating through renameView.
      // We rely on the SECURITY DEFINER upsert RPC which accepts (_id, ...).
      // Since useUserSavedViews only exposes saveView (id=null) and renameView
      // (keeps state), we implement update by saving a new view then deleting
      // the old one would change the id. Use a direct call instead:
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.rpc("upsert_user_saved_view", {
        _id: activeView.id,
        _surface_key: "team-work",
        _scope_key: "global",
        _name: activeView.name,
        _state: currentSavedSnapshot as never,
      });
      if (error) throw error;
      await savedViews.refetch();
      toast({ title: "View updated" });
    } catch {
      toast({ title: "Could not update view", variant: "destructive" });
    }
  }, [activeView, currentSavedSnapshot, savedViews, toast]);

  const handleResetView = useCallback(() => {
    setActiveViewId(null);
    setLens("attention");
    setTimeWindow("this_week");
    setSelectedWorkspaceIds(
      activeScope.type === "workspace" ? [activeScope.workspaceId] : [],
    );
    resetDependentFilters();
  }, [activeScope]);










  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          Team Work{" "}
          <span className="text-muted-foreground font-normal">· {scopeLabel}</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          A cross-project view of authorized team work, due dates, blockers, and ownership.
        </p>
      </header>

      {/* Filters — two rows: scope/window on top, refinement filters below */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {showScopeSelector && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-[260px] justify-between font-normal"
                >
                  <span className="truncate text-left">Scope: {scopeLabel}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-2" align="start">
                {workspaces.length > 8 && (
                  <input
                    type="text"
                    value={wsQuery}
                    onChange={(e) => setWsQuery(e.target.value)}
                    placeholder="Search workspaces…"
                    className="w-full text-xs px-2 py-1.5 rounded border border-input bg-background mb-1 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                )}
                <button
                  type="button"
                  onClick={selectAllWorkspaces}
                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent text-muted-foreground"
                >
                  Select all accessible workspaces
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWorkspaceIds([]);
                    resetDependentFilters();
                  }}
                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent text-muted-foreground"
                >
                  Clear selection
                </button>
                <div className="my-1 h-px bg-border" />
                <div className="max-h-[280px] overflow-y-auto pr-1">
                  {visibleWorkspaces.length === 0 ? (
                    <div className="text-xs text-muted-foreground px-2 py-1.5">
                      No matches
                    </div>
                  ) : (
                    visibleWorkspaces.map((w) => {
                      const checked = selectedWorkspaceIds.includes(w.id);
                      return (
                        <label
                          key={w.id}
                          className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleWorkspace(w.id)}
                          />
                          <span className="truncate">{w.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {!showScopeSelector && workspaces.length === 1 && (
            <div className="text-xs text-muted-foreground px-2 py-1.5 border rounded-md bg-muted/40">
              {workspaces[0].name}
            </div>
          )}

          <Select value={timeWindow} onValueChange={(v) => setTimeWindow(v as TeamWorkTimeWindow)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIME_WINDOWS.map((w) => (
                <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            {activeView && (
              <span className="text-xs text-muted-foreground truncate max-w-[180px]" title={activeView.name}>
                View: <span className="text-foreground">{activeView.name}</span>
                {hasUnsavedChanges && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">· Unsaved changes</span>
                )}
              </span>
            )}
            {activeView && hasUnsavedChanges && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={handleUpdateActiveView}
              >
                Update view
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={handleResetView}
              title="Reset to default Team Work view"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            <SavedViewsControl<TeamWorkSavedView>
              views={savedViews.views}
              currentState={currentSavedSnapshot}
              onSave={handleSaveView}
              onApply={handleApplySavedView}
              onRename={handleRenameSavedView}
              onDelete={handleDeleteSavedView}
              label="Views"
              description="Private to you, saved to your BTPM account."
              disabled={savedViews.isLoading}
              emptyText={savedViews.isLoading ? "Loading…" : "No saved views yet."}
            />
          </div>
        </div>


        {showScopeSelector && !allAccessible && selectedWorkspaceIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedWorkspaceIds.map((id) => {
              const ws = workspaces.find((w) => w.id === id);
              if (!ws) return null;
              return (
                <Badge
                  key={id}
                  variant="secondary"
                  className="gap-1 pr-1"
                >
                  <span className="text-xs">{ws.name}</span>
                  <button
                    type="button"
                    onClick={() => toggleWorkspace(id)}
                    className="hover:bg-background/60 rounded p-0.5"
                    aria-label={`Remove ${ws.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <MultiSelectFilter
            label="portfolios"
            singularNoun="portfolio"
            options={portfolioOpts}
            selected={portfolios}
            onChange={setPortfolios}
            width="w-[200px]"
          />
          <MultiSelectFilter
            label="programs"

            singularNoun="program"
            options={programOpts}
            selected={programs}
            onChange={setPrograms}
            width="w-[170px]"
          />
          <MultiSelectFilter
            label="projects"
            singularNoun="project"
            options={projectOpts}
            selected={projects}
            onChange={setProjects}
            width="w-[190px]"
          />
          <MultiSelectFilter
            label="assignees"
            singularNoun="assignee"
            options={assigneeOpts}
            selected={assignees}
            onChange={setAssignees}
            width="w-[190px]"
          />
          <MultiSelectFilter
            label="statuses"
            singularNoun="status"
            options={statusOpts}
            selected={statuses}
            onChange={setStatuses}
            width="w-[160px]"
          />
          <MultiSelectFilter
            label="priorities"
            singularNoun="priority"
            options={priorityOpts}
            selected={priorities}
            onChange={setPriorities}
            width="w-[160px]"
          />
          <MultiSelectFilter
            label="requesters"
            singularNoun="requester"
            options={requesterFilterOpts}
            selected={requesterSelectionForControl}
            onChange={onRequesterSelectionChange}
            width="w-[200px]"
          />
          <MultiSelectFilter
            label="executors"
            singularNoun="executor"
            options={executorFilterOpts}
            selected={executorSelectionForControl}
            onChange={onExecutorSelectionChange}
            width="w-[200px]"
          />
        </div>
      </div>


      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Overdue" value={summary.overdue} />
        <StatCard label="Due today" value={summary.dueToday} />
        <StatCard label="Upcoming" value={summary.upcoming} />
        <StatCard label="Blocked" value={summary.blocked} />
        <StatCard label="Unassigned" value={summary.unassigned} />
        <StatCard label="High priority" value={summary.highPriority} />
        <StatCard label="No estimate" value={summary.noEstimate} />
        <StatCard label="Est. open hours" value={fmtHours(summary.estHours)} />
      </div>

      {/* Lens-driven section */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-foreground">
            {lens === "attention"
              ? "Attention list"
              : lens === "by_person"
                ? "By person"
                : "By project"}
          </h2>
          <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/30">
            <button
              type="button"
              onClick={() => setLens("attention")}
              className={`px-3 py-1 text-xs rounded ${
                lens === "attention"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Attention list
            </button>
            <button
              type="button"
              onClick={() => setLens("by_person")}
              className={`px-3 py-1 text-xs rounded ${
                lens === "by_person"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              By person
            </button>
            <button
              type="button"
              onClick={() => setLens("by_project")}
              className={`px-3 py-1 text-xs rounded ${
                lens === "by_project"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              By project
            </button>
          </div>
        </div>

        {lens === "by_project" ? (
          isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4 text-destructive" />
                Unable to load team work right now.
              </CardContent>
            </Card>
          ) : byProject.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No matching work items. Adjust filters to widen the view.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead className="text-right">Open tasks</TableHead>
                      <TableHead className="text-right">Overdue</TableHead>
                      <TableHead className="text-right">Due next 7 days</TableHead>
                      <TableHead className="text-right">Blocked</TableHead>
                      <TableHead className="text-right">High priority</TableHead>
                      <TableHead className="text-right">Unassigned</TableHead>
                      <TableHead className="text-right">No estimate</TableHead>
                      <TableHead className="text-right">Est. open hrs</TableHead>
                      <TableHead className="w-[110px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byProject.map((row) => {
                      const projectHref = `/workspace/${row.workspaceId}/project/${row.projectId}?from=team-work`;
                      return (
                        <TableRow key={row.projectId}>
                          <TableCell className="text-sm">
                            <Link
                              to={projectHref}
                              className="font-medium text-foreground hover:underline"
                            >
                              {row.projectName}
                            </Link>
                            {row.portfolioLabel && (
                              <div className="text-[11px] text-muted-foreground">
                                Portfolio: {row.portfolioLabel}
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="text-sm text-muted-foreground">
                            {row.workspaceName}
                          </TableCell>
                          <TableCell className="text-sm text-right">{row.open}</TableCell>
                          <TableCell
                            className={`text-sm text-right ${
                              row.overdue > 0 ? "text-destructive font-medium" : ""
                            }`}
                          >
                            {row.overdue}
                          </TableCell>
                          <TableCell className="text-sm text-right">{row.dueNext7}</TableCell>
                          <TableCell className="text-sm text-right">{row.blocked}</TableCell>
                          <TableCell className="text-sm text-right">{row.highPriority}</TableCell>
                          <TableCell className="text-sm text-right">{row.unassigned}</TableCell>
                          <TableCell className="text-sm text-right">{row.noEstimate}</TableCell>
                          <TableCell className="text-sm text-right">
                            {fmtHours(row.estHours)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => viewProjectWork(row.projectId)}
                            >
                              View work
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )
        ) : lens === "by_person" ? (

          isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4 text-destructive" />
                Unable to load team work right now.
              </CardContent>
            </Card>
          ) : byPerson.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No matching work items. Adjust filters to widen the view.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead className="text-right">Open tasks</TableHead>
                      <TableHead className="text-right">Overdue</TableHead>
                      <TableHead className="text-right">Due next 7 days</TableHead>
                      <TableHead className="text-right">Blocked</TableHead>
                      <TableHead className="text-right">High priority</TableHead>
                      <TableHead className="text-right">No estimate</TableHead>
                      <TableHead className="text-right">Est. open hrs</TableHead>
                      <TableHead className="w-[110px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byPerson.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="text-sm">
                          {row.isUnassigned ? (
                            <span className="text-muted-foreground italic">Unassigned</span>
                          ) : (
                            <span className="font-medium text-foreground">{row.name}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-right">{row.open}</TableCell>
                        <TableCell
                          className={`text-sm text-right ${
                            row.overdue > 0 ? "text-destructive font-medium" : ""
                          }`}
                        >
                          {row.overdue}
                        </TableCell>
                        <TableCell className="text-sm text-right">{row.dueThisWeek}</TableCell>
                        <TableCell className="text-sm text-right">{row.blocked}</TableCell>
                        <TableCell className="text-sm text-right">{row.highPriority}</TableCell>
                        <TableCell className="text-sm text-right">{row.noEstimate}</TableCell>
                        <TableCell className="text-sm text-right">
                          {fmtHours(row.estHours)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => viewPersonWork(row.key)}
                          >
                            View work
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )
        ) : (
          <>


        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 text-destructive" />
              Unable to load team work right now.
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No team work found for the selected window.
            </CardContent>
          </Card>
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No matching work items. Adjust filters to widen the view.
            </CardContent>
          </Card>
        ) : (
          <>
            {selectedTaskIds.size > 0 && (() => {
              const selectedItems = sorted.filter((s) => selectedTaskIds.has(s.task_id));
              const skippedUnassigned = selectedItems.filter((i) => i.is_unassigned).length;
              const recipientCount = new Set(
                selectedItems
                  .filter((i) => i.assignee_email && !i.is_unassigned)
                  .map((i) => i.assignee_email!.toLowerCase()),
              ).size;
              return (
                <div className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  <span className="font-medium text-foreground">
                    {selectedTaskIds.size} task{selectedTaskIds.size === 1 ? "" : "s"} selected
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
                    {skippedUnassigned > 0 && (
                      <> · <span className="text-amber-700 dark:text-amber-400">{skippedUnassigned} unassigned (skipped)</span></>
                    )}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" className="h-8" onClick={() => setReminderOpen(true)}>
                      <Mail className="h-4 w-4 mr-1.5" />
                      Send reminder
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setSelectedTaskIds(new Set())}
                    >
                      Clear selection
                    </Button>
                  </div>
                </div>
              );
            })()}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          aria-label="Select all visible tasks"
                          checked={
                            sorted.length > 0 &&
                            sorted.every((s) => selectedTaskIds.has(s.task_id))
                          }
                          onCheckedChange={(v) => {
                            if (v) setSelectedTaskIds(new Set(sorted.map((s) => s.task_id)));
                            else setSelectedTaskIds(new Set());
                          }}
                        />
                      </TableHead>
                      <TableHead className="w-[180px]">Reason</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Phase</TableHead>
                      <TableHead>Assignee</TableHead>
                      <TableHead>People</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Est. hrs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((item) => {
                      const chips = reasonChips(item);
                      const taskHref = `/workspace/${item.workspace_id}/project/${item.project_id}/task/${item.task_id}?from=team-work`;
                      const projectHref = `/workspace/${item.workspace_id}/project/${item.project_id}?from=team-work`;
                      const isSelected = selectedTaskIds.has(item.task_id);
                      return (
                        <TableRow
                          key={item.task_id}
                          data-state={isSelected ? "selected" : undefined}
                        >
                          <TableCell>
                            <Checkbox
                              aria-label={`Select ${item.task_name ?? "task"}`}
                              checked={isSelected}
                              onCheckedChange={(v) => {
                                setSelectedTaskIds((prev) => {
                                  const next = new Set(prev);
                                  if (v) next.add(item.task_id);
                                  else next.delete(item.task_id);
                                  return next;
                                });
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {chips.length === 0 ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                chips.map((c) => (
                                  <Badge
                                    key={c.label}
                                    variant={c.variant}
                                    className="text-[10px] px-1.5 py-0"
                                  >
                                    {c.label}
                                  </Badge>
                                ))
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Link
                              to={taskHref}
                              className="text-sm font-medium text-foreground hover:underline"
                            >
                              {item.task_name ?? "(Untitled task)"}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Link
                              to={projectHref}
                              className="text-sm text-foreground hover:underline"
                            >
                              {item.project_name ?? "—"}
                            </Link>
                            {item.program_name && (
                              <div className="text-[11px] text-muted-foreground">
                                {item.program_name}
                              </div>
                            )}
                            {(() => {
                              const pf = formatPortfolioFromFields(
                                item.portfolio_item_id,
                                item.portfolio_name,
                                item.portfolio_code,
                                item.portfolio_is_archived,
                              );
                              return pf ? (
                                <div className="text-[11px] text-muted-foreground">
                                  Portfolio: {pf}
                                </div>
                              ) : null;
                            })()}

                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.phase_name ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {item.is_unassigned ? (
                              <span className="text-muted-foreground italic">Unassigned</span>
                            ) : (
                              item.assignee_name ?? item.assignee_email ?? "—"
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {item.requested_by_stakeholder || (item.executed_by_stakeholders?.length ?? 0) > 0 ? (
                              <TaskAccountabilityInline
                                requester={item.requested_by_stakeholder}
                                executors={item.executed_by_stakeholders}
                              />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{item.task_status}</TableCell>
                          <TableCell className="text-sm">{item.task_priority ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {fmtDate(item.start_date)}
                          </TableCell>
                          <TableCell
                            className={
                              item.is_overdue
                                ? "text-sm text-destructive font-medium"
                                : "text-sm"
                            }
                          >
                            {fmtDate(item.due_date)}
                          </TableCell>
                          <TableCell className="text-sm text-right">
                            {fmtHours(item.estimated_hours)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
          </>
        )}
      </section>

      <TeamWorkReminderDialog
        open={reminderOpen}
        onOpenChange={setReminderOpen}
        selectedItems={sorted.filter((s) => selectedTaskIds.has(s.task_id))}
        onSent={() => setSelectedTaskIds(new Set())}
      />
    </div>
  );
}
