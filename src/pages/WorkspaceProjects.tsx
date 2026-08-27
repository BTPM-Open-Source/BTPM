import { useParams, Link, useNavigate } from "react-router-dom";
import { useWorkspaceProjects } from "@/hooks/useProjectOverview";
import { useWorkspacePrograms } from "@/hooks/usePrograms";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, X, Archive } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistedViewState, codecs } from "@/hooks/usePersistedViewState";
import { useSavedViews } from "@/hooks/useSavedViews";
import { SavedViewsControl } from "@/components/views/SavedViewsControl";
import { usePlanningAuthority } from "@/hooks/usePlanningAuthority";
import { useProjectAccessMap } from "@/hooks/useProjectAccessMap";
import { NewProjectDialog } from "@/components/project/NewProjectDialog";
import {
  useWorkspaceProjectDeepSearch,
  type WorkspaceProjectDeepMatch,
} from "@/hooks/useWorkspaceProjectDeepSearch";

import {
  getPmWorkflowStatusBadgeClass,
  getPmWorkflowStatusLabel,
  PM_WORKFLOW_STATUS_VALUES,
} from "@/lib/btpmVisualSemantics";

const STATUS_OPTIONS = PM_WORKFLOW_STATUS_VALUES.map((v) => ({
  value: v,
  label: getPmWorkflowStatusLabel(v),
}));

const NO_PROGRAM_VALUE = "__none__";
const NO_PORTFOLIO_VALUE = "__none__";

const STATUS_GROUP_ORDER = ["active", "planned", "on_hold", "completed", "cancelled"];
const NO_PROGRAM_LABEL = "No program";

function formatPortfolioLabel(project: any): string | null {
  if (!project?.portfolio_item_id) return null;
  const name = project.portfolio_name || "Unnamed Portfolio";
  const code = project.portfolio_code || null;
  const label = code ? `${code} — ${name}` : name;
  return project.portfolio_is_archived ? `${label} (archived)` : label;
}

type GroupByMode = "none" | "program" | "status";
type SortByMode = "name_asc" | "name_desc" | "status" | "program";

const GROUP_BY_VALUES = ["none", "program", "status"] as const;
const SORT_BY_VALUES = ["name_asc", "name_desc", "status", "program"] as const;

export default function WorkspaceProjects({ workspaceId: workspaceIdProp }: { workspaceId?: string } = {}) {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = workspaceIdProp ?? params.workspaceId;
  const navigate = useNavigate();

  const { data: workspace } = useQuery({
    queryKey: ["workspace-decrypted", workspaceId],
    queryFn: async () => {
      if (!workspaceId) throw new Error("No workspace ID");
      const { data, error } = await supabase.rpc("get_decrypted_workspace", { _workspace_id: workspaceId });
      if (error) throw error;
      return data as any;
    },
    enabled: !!workspaceId,
  });

  const { data: projectsRaw, isLoading } = useWorkspaceProjects(workspaceId, {
    includeArchived: true,
  });
  const { data: programs } = useWorkspacePrograms(workspaceId);
  const { canEdit } = usePlanningAuthority(workspaceId);
  const access = useProjectAccessMap();
  const allProjects = useMemo(
    () =>
      (projectsRaw ?? []).filter((p: any) =>
        access.canSeeProject({ id: p.id, workspace_id: workspaceId }),
      ),
    [projectsRaw, access, workspaceId],
  );
  const archivedCount = useMemo(
    () => allProjects.filter((p: any) => p.is_archived).length,
    [allProjects],
  );
  const [createOpen, setCreateOpen] = useState(false);

  const { state, setField, setState } = usePersistedViewState({
    viewId: "workspace-projects",
    scopeKey: workspaceId ?? "global",
    schema: {
      searchQuery: { mode: "local", default: "", codec: codecs.string },
      statusFilter: { mode: "local", default: "all", codec: codecs.string },
      programFilter: { mode: "local", default: "all", codec: codecs.string },
      portfolioFilter: { mode: "local", default: "all", codec: codecs.string },
      groupBy: { mode: "local", default: "none" as GroupByMode, codec: codecs.stringEnum(GROUP_BY_VALUES) },
      sortBy: { mode: "local", default: "name_asc" as SortByMode, codec: codecs.stringEnum(SORT_BY_VALUES) },
      showArchived: { mode: "local", default: false, codec: codecs.boolean },
    },
  });

  type SavedViewSnapshot = {
    searchQuery: string;
    statusFilter: string;
    programFilter: string;
    portfolioFilter: string;
    groupBy: GroupByMode;
    sortBy: SortByMode;
  };

  const savedViews = useSavedViews<SavedViewSnapshot>({
    viewId: "workspace-projects",
    scopeKey: workspaceId ?? "global",
    validate: (raw): raw is SavedViewSnapshot => {
      if (!raw || typeof raw !== "object") return false;
      const r = raw as any;
      return (
        typeof r.searchQuery === "string" &&
        typeof r.statusFilter === "string" &&
        typeof r.programFilter === "string" &&
        (r.portfolioFilter === undefined || typeof r.portfolioFilter === "string") &&
        GROUP_BY_VALUES.includes(r.groupBy) &&
        SORT_BY_VALUES.includes(r.sortBy)
      );
    },
  });
  const search = state.searchQuery;
  const statusFilter = state.statusFilter;
  const programFilter = state.programFilter;
  const portfolioFilter = state.portfolioFilter;
  const groupBy = state.groupBy;
  const sortBy = state.sortBy;
  const showArchived = state.showArchived;
  const setSearch = (v: string) => setField("searchQuery", v);
  const setStatusFilter = (v: string) => setField("statusFilter", v);
  const setProgramFilter = (v: string) => setField("programFilter", v);
  const setPortfolioFilter = (v: string) => setField("portfolioFilter", v);
  const setGroupBy = (v: GroupByMode) => setField("groupBy", v);
  const setSortBy = (v: SortByMode) => setField("sortBy", v);
  const setShowArchived = (v: boolean) => setField("showArchived", v);

  const projects = useMemo(
    () => (showArchived ? allProjects : allProjects.filter((p: any) => !p.is_archived)),
    [allProjects, showArchived],
  );

  const hasUnlinked = useMemo(
    () => (projects || []).some((p: any) => !p.programs?.name),
    [projects],
  );

  // Portfolio options derived from the same base project set as other filters.
  const portfolioOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    let hasNone = false;
    for (const p of projects || []) {
      if (p.portfolio_item_id) {
        if (!map.has(p.portfolio_item_id)) {
          map.set(p.portfolio_item_id, {
            value: p.portfolio_item_id,
            label: formatPortfolioLabel(p) ?? p.portfolio_name ?? "Unnamed Portfolio",
          });
        }
      } else {
        hasNone = true;
      }
    }
    const list = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
    if (hasNone) list.push({ value: NO_PORTFOLIO_VALUE, label: "No Portfolio" });
    return list;
  }, [projects]);

  // --- Project finder / autocomplete state ---
  const [finderOpen, setFinderOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const finderRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!finderOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!finderRef.current) return;
      if (!finderRef.current.contains(e.target as Node)) setFinderOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [finderOpen]);

  const {
    data: deepMatches,
    isError: deepSearchError,
  } = useWorkspaceProjectDeepSearch(workspaceId, search, showArchived);

  const deepMatchMap = useMemo(() => {
    const map = new Map<string, WorkspaceProjectDeepMatch>();
    for (const m of deepMatches ?? []) map.set(m.project_id, m);
    return map;
  }, [deepMatches]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (projects || []).filter((p: any) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (programFilter !== "all") {
        const progName = p.programs?.name || null;
        if (programFilter === NO_PROGRAM_VALUE) {
          if (progName) return false;
        } else {
          if (progName !== programFilter) return false;
        }
      }
      if (portfolioFilter !== "all") {
        if (portfolioFilter === NO_PORTFOLIO_VALUE) {
          if (p.portfolio_item_id) return false;
        } else {
          if (p.portfolio_item_id !== portfolioFilter) return false;
        }
      }
      if (q) {
        const name = (p.name || "").toLowerCase();
        const prog = (p.programs?.name || "").toLowerCase();
        const portName = (p.portfolio_name || "").toLowerCase();
        const portCode = (p.portfolio_code || "").toLowerCase();
        const localHit = name.includes(q) || prog.includes(q) || portName.includes(q) || portCode.includes(q);
        const deepHit = deepMatchMap.has(p.id);
        if (!localHit && !deepHit) return false;
      }
      return true;
    });
  }, [projects, search, statusFilter, programFilter, portfolioFilter, deepMatchMap]);

  const filtersActive =
    search.trim() !== "" ||
    statusFilter !== "all" ||
    programFilter !== "all" ||
    portfolioFilter !== "all";

  // Autocomplete candidates: authorized projects matched by the search query only
  // (not constrained by status/program filters so finder always finds anything visible).
  const workspaceName = (workspace as any)?.name || "";
  const finderCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as any[];
    const matches = (projects || []).filter((p: any) => {
      const name = (p.name || "").toLowerCase();
      const prog = (p.programs?.name || "").toLowerCase();
      const ws = (workspaceName || "").toLowerCase();
      const portName = (p.portfolio_name || "").toLowerCase();
      const portCode = (p.portfolio_code || "").toLowerCase();
      return (
        name.includes(q) ||
        prog.includes(q) ||
        ws.includes(q) ||
        portName.includes(q) ||
        portCode.includes(q) ||
        deepMatchMap.has(p.id)
      );
    });
    matches.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
    return matches.slice(0, 8);
  }, [projects, search, workspaceName, deepMatchMap]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const cmpName = (a: any, b: any) => (a.name || "").localeCompare(b.name || "");
    if (sortBy === "name_asc") {
      arr.sort(cmpName);
    } else if (sortBy === "name_desc") {
      arr.sort((a, b) => cmpName(b, a));
    } else if (sortBy === "status") {
      arr.sort((a, b) => {
        const ai = STATUS_GROUP_ORDER.indexOf(a.status);
        const bi = STATUS_GROUP_ORDER.indexOf(b.status);
        const da = ai === -1 ? 999 : ai;
        const db = bi === -1 ? 999 : bi;
        return da - db || cmpName(a, b);
      });
    } else if (sortBy === "program") {
      arr.sort((a, b) => {
        const ap = a.programs?.name || null;
        const bp = b.programs?.name || null;
        if (ap === bp) return cmpName(a, b);
        if (ap === null) return 1;
        if (bp === null) return -1;
        return ap.localeCompare(bp) || cmpName(a, b);
      });
    }
    return arr;
  }, [filtered, sortBy]);

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, any[]>();
    for (const p of sorted) {
      let key: string;
      if (groupBy === "program") {
        key = (p as any).programs?.name || NO_PROGRAM_LABEL;
      } else {
        key = p.status;
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    const entries = Array.from(map.entries());
    if (groupBy === "program") {
      entries.sort(([a], [b]) => {
        if (a === NO_PROGRAM_LABEL) return 1;
        if (b === NO_PROGRAM_LABEL) return -1;
        return a.localeCompare(b);
      });
    } else {
      entries.sort(([a], [b]) => {
        const ai = STATUS_GROUP_ORDER.indexOf(a);
        const bi = STATUS_GROUP_ORDER.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
    }
    return entries;
  }, [sorted, groupBy]);

  const fromQs = workspaceIdProp ? "?from=projects" : "?from=workspace";

  const formatMatchSnippet = (m: WorkspaceProjectDeepMatch["matches"][number]) => {
    const typeLabel =
      m.type === "phase" ? "Matched phase" :
      m.type === "task" ? "Matched task" :
      m.type === "program" ? "Matched program" : "Matched project";
    const main = m.context_label ? `${m.context_label} — ${m.label}` : m.label;
    return `${typeLabel}: ${main}`;
  };

  const getNonNameMatches = (projectId: string, projectName: string, programName: string | null) => {
    const dm = deepMatchMap.get(projectId);
    if (!dm) return [] as WorkspaceProjectDeepMatch["matches"];
    const q = search.trim().toLowerCase();
    const localHit = q && (projectName.toLowerCase().includes(q) || (programName || "").toLowerCase().includes(q));
    // If the project name itself matched the local query, no need to explain matches.
    if (localHit) return [];
    return dm.matches.filter((m) => m.type === "phase" || m.type === "task");
  };

  const renderProjectCard = (p: any) => {
    const nonNameMatches = getNonNameMatches(p.id, p.name || "", p.programs?.name || null);
    const visible = nonNameMatches.slice(0, 2);
    const extra = nonNameMatches.length - visible.length;
    const portfolioLabel = formatPortfolioLabel(p);
    const progName = p.programs?.name || null;
    const contextParts: string[] = [];
    if (progName) contextParts.push(progName);
    if (portfolioLabel) contextParts.push(`Portfolio: ${portfolioLabel}`);
    const contextLine = contextParts.join(" · ");
    return (
      <Link key={p.id} to={`/workspace/${workspaceId}/project/${p.id}${fromQs}`}>
        <Card className={`hover:bg-accent/50 transition-colors cursor-pointer ${p.is_archived ? "opacity-60" : ""}`}>
          <CardContent className="py-4 flex items-center justify-between">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{p.name}</p>
              {p.is_archived ? (
                <p className="text-xs text-muted-foreground truncate">
                  Archived{contextLine ? ` · ${contextLine}` : ""}
                </p>
              ) : contextLine ? (
                <p className="text-xs text-muted-foreground truncate">{contextLine}</p>
              ) : null}
              {visible.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {visible.map((m, i) => (
                    <p key={i} className="text-xs text-muted-foreground truncate">
                      {formatMatchSnippet(m)}
                    </p>
                  ))}
                  {extra > 0 && (
                    <p className="text-xs text-muted-foreground">+{extra} more match{extra === 1 ? "" : "es"}</p>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {p.is_archived && <Badge variant="outline">Archived</Badge>}
              <Badge className={getPmWorkflowStatusBadgeClass(p.status)}>{getPmWorkflowStatusLabel(p.status)}</Badge>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Projects</p>
        <div className="flex gap-2">
          {archivedCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>
              <Archive className="h-4 w-4 mr-1" />
              {showArchived ? "Hide archived" : `Archived (${archivedCount})`}
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New project
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 items-stretch sm:items-center">
        <div
          className="relative w-full sm:w-[320px] sm:min-w-[260px] sm:flex-[0_0_320px]"
          ref={finderRef}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setFinderOpen(true);
            }}
            onFocus={() => setFinderOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFinderOpen(false);
                return;
              }
              if (!finderOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                setFinderOpen(true);
              }
              if (!finderCandidates.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightIdx((i) => (i + 1) % finderCandidates.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightIdx((i) => (i - 1 + finderCandidates.length) % finderCandidates.length);
              } else if (e.key === "Enter") {
                const target = finderCandidates[highlightIdx];
                if (target && workspaceId) {
                  e.preventDefault();
                  setFinderOpen(false);
                  navigate(`/workspace/${workspaceId}/project/${target.id}${fromQs}`);
                }
              }
            }}
            placeholder="Search projects, portfolio, phases, tasks..."
            className={search ? "pl-10 pr-10" : "pl-10 pr-3"}
            role="combobox"
            aria-expanded={finderOpen}
            aria-autocomplete="list"
            aria-controls="project-finder-listbox"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
                setFinderOpen(false);
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {finderOpen && search.trim() && (
            <div
              id="project-finder-listbox"
              role="listbox"
              className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover text-popover-foreground shadow-md max-h-80 overflow-auto"
            >
              {finderCandidates.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">No matching projects</div>
              ) : (
                finderCandidates.map((p: any, idx: number) => {
                  const progLabel = p.programs?.name || "No program";
                  const statusLabel = (p.status || "").replace("_", " ");
                  const isActive = idx === highlightIdx;
                  const nonNameMatches = getNonNameMatches(p.id, p.name || "", p.programs?.name || null);
                  const snippet = nonNameMatches[0];
                  const secondLine = snippet
                    ? formatMatchSnippet(snippet)
                    : [progLabel, statusLabel].filter(Boolean).join(" · ");
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      onMouseDown={(e) => {
                        // mousedown to fire before input blur
                        e.preventDefault();
                        if (!workspaceId) return;
                        setFinderOpen(false);
                        navigate(`/workspace/${workspaceId}/project/${p.id}${fromQs}`);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5 ${
                        isActive ? "bg-accent text-accent-foreground" : ""
                      }`}
                    >
                      <span className="font-medium truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground truncate">{secondLine}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
          {deepSearchError && search.trim().length >= 2 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Phase/task search is unavailable. Project search still works.
            </p>
          )}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={programFilter} onValueChange={setProgramFilter}>
          <SelectTrigger className="sm:w-[200px]">
            <SelectValue placeholder="Program" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All programs</SelectItem>
            {hasUnlinked && (
              <SelectItem value={NO_PROGRAM_VALUE}>No program</SelectItem>
            )}
            {(programs || []).map((p: any) => (
              <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={portfolioFilter} onValueChange={setPortfolioFilter}>
          <SelectTrigger className="sm:w-[200px]">
            <SelectValue placeholder="Portfolio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Portfolios</SelectItem>
            {portfolioOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupByMode)}>
          <SelectTrigger className="sm:w-[170px]">
            <SelectValue placeholder="Group by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Group by: None</SelectItem>
            <SelectItem value="program">Group by: Program</SelectItem>
            <SelectItem value="status">Group by: Status</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortByMode)}>
          <SelectTrigger className="sm:w-[170px]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name_asc">Name (A–Z)</SelectItem>
            <SelectItem value="name_desc">Name (Z–A)</SelectItem>
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="program">Program</SelectItem>
          </SelectContent>
        </Select>
        <SavedViewsControl<SavedViewSnapshot>
          views={savedViews.views}
          currentState={{
            searchQuery: search,
            statusFilter,
            programFilter,
            portfolioFilter,
            groupBy,
            sortBy,
          }}
          onSave={(name, snap) => savedViews.saveView(name, snap)}
          onApply={(snap) => setState({ ...snap, portfolioFilter: snap.portfolioFilter ?? "all" })}
          onRename={(id, name) => savedViews.renameView(id, name)}
          onDelete={(id) => savedViews.deleteView(id)}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !projects?.length ? (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground">No projects in this workspace yet.</p>
            {canEdit ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create first project
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">You do not have permission to create projects in this workspace.</p>
            )}
          </CardContent>
        </Card>
      ) : !filtered.length ? (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No projects match your search or filters.</p>
            {filtersActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setProgramFilter("all");
                  setPortfolioFilter("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : groups ? (
        <div className="space-y-6">
          {groups.map(([label, items]) => (
            <div key={label} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {groupBy === "status" ? label.replace("_", " ") : label}
                </h3>
                <span className="text-xs text-muted-foreground">({items.length})</span>
              </div>
              <div className="space-y-2">{items.map(renderProjectCard)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">{sorted.map(renderProjectCard)}</div>
      )}

      {canEdit && workspace && workspaceId && (
        <NewProjectDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          workspaceId={workspaceId}
          organizationId={workspace.organization_id}
        />
      )}
    </div>
  );
}
