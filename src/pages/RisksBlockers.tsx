import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useActiveWorkspace } from "@/context/ActiveWorkspaceContext";
import { useAuth } from "@/hooks/useAuth";
import {
  useRisksBlockersOps,
  bucketRb,
  type RbItem,
} from "@/hooks/useRisksBlockersOps";
import { useProjectAccessMap } from "@/hooks/useProjectAccessMap";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ShieldAlert,
  Clock,
  Inbox,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

const severityClass = (sev: string | null) => {
  switch ((sev ?? "").toLowerCase()) {
    case "critical":
    case "urgent":
      return "bg-destructive/10 text-destructive";
    case "high":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
    default:
      return "bg-muted text-muted-foreground";
  }
};

type QuickChip = "all" | "high" | "stale";
type OwnerToggle = "all" | "mine";

const COLLAPSE_KEY = "btpm.rb.collapsed.v1";
const STALE_DAYS = 14;
const HIGH = new Set(["high", "critical", "urgent"]);

const NO_PORTFOLIO_VALUE = "__none__";

function formatPortfolioFromItem(item: RbItem): string | null {
  if (!item.portfolioItemId) return null;
  const name = item.portfolioName || "Unnamed Portfolio";
  const code = item.portfolioCode || null;
  const base = code ? `${code} — ${name}` : name;
  return item.portfolioIsArchived ? `${base} (archived)` : base;
}

function ItemRow({ item, showWorkspace }: { item: RbItem; showWorkspace: boolean }) {
  const linkTo = item.projectId
    ? `/workspace/${item.workspaceId}/project/${item.projectId}/risks?from=risks-blockers`
    : `/workspace/${item.workspaceId}`;
  const portfolioLabel = formatPortfolioFromItem(item);

  return (
    <Link to={linkTo}>
      <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
        <CardContent className="py-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              {item.type === "blocker" ? (
                <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-orange-500" />
              )}
              <p className="font-medium text-foreground truncate">{item.title}</p>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span className="truncate">{item.projectName ?? "—"}</span>
              {portfolioLabel && (
                <>
                  <span>·</span>
                  <span className="truncate">Portfolio: {portfolioLabel}</span>
                </>
              )}
              {showWorkspace && item.workspaceName && (
                <>
                  <span>·</span>
                  <span className="truncate">{item.workspaceName}</span>
                </>
              )}
              <span>·</span>
              <span>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {item.severity && (
              <Badge className={severityClass(item.severity)}>{item.severity}</Badge>
            )}
            <Badge variant="outline" className="capitalize">
              {item.status.replace("_", " ")}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Section({
  id,
  title,
  icon: Icon,
  items,
  emptyText,
  showWorkspace,
  open,
  onOpenChange,
}: {
  id: string;
  title: string;
  icon: typeof Clock;
  items: RbItem[];
  emptyText: string;
  showWorkspace: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="space-y-2">
      <CollapsibleTrigger className="flex items-center gap-2 px-1 w-full text-left hover:opacity-80">
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {items.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <ItemRow
                key={`${id}-${it.type}-${it.id}`}
                item={it}
                showWorkspace={showWorkspace}
              />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* noop */
  }
  // Defaults: blockers/risks/attention expanded, recent collapsed
  return { blockers: true, risks: true, attention: true, recent: false };
}

export default function RisksBlockers() {
  const { user } = useAuth();
  const { activeScope, isAllWorkspaces, activeWorkspace, isLoading: scopeLoading } =
    useActiveWorkspace();

  const scope =
    activeScope.type === "workspace"
      ? { type: "workspace" as const, workspaceId: activeScope.workspaceId }
      : { type: "all" as const };

  const { data: rawItems = [], isLoading } = useRisksBlockersOps(scope);
  const access = useProjectAccessMap();
  const items = useMemo(
    () =>
      rawItems.filter((it) =>
        !it.projectId
          ? true
          : access.canSeeProject({ id: it.projectId, workspace_id: it.workspaceId }),
      ),
    [rawItems, access],
  );

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(loadCollapsed);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(openMap));
    } catch {
      /* noop */
    }
  }, [openMap]);

  const [owner, setOwner] = useState<OwnerToggle>("all");
  const [chip, setChip] = useState<QuickChip>("all");
  const [portfolioId, setPortfolioId] = useState<string>("all");
  const [projectId, setProjectId] = useState<string>("all");

  // Portfolio options derived from access-filtered items.
  const portfolioOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string; archived: boolean }>();
    let hasNone = false;
    for (const it of items) {
      if (!it.portfolioItemId) {
        hasNone = true;
        continue;
      }
      if (map.has(it.portfolioItemId)) continue;
      const name = it.portfolioName || "Unnamed Portfolio";
      const code = it.portfolioCode || null;
      const base = code ? `${code} — ${name}` : name;
      const archived = !!it.portfolioIsArchived;
      map.set(it.portfolioItemId, {
        id: it.portfolioItemId,
        label: archived ? `${base} (archived)` : base,
        archived,
      });
    }
    const assigned = Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    return { assigned, hasNone };
  }, [items]);

  // Apply Portfolio filter before project filter.
  const portfolioScopedItems = useMemo(() => {
    return items.filter((it) => {
      if (portfolioId === "all") return true;
      if (portfolioId === NO_PORTFOLIO_VALUE) return !it.portfolioItemId;
      return it.portfolioItemId === portfolioId;
    });
  }, [items, portfolioId]);

  // Project options derived from portfolio-scoped set
  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of portfolioScopedItems) {
      if (it.projectId) map.set(it.projectId, it.projectName ?? "Untitled");
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [portfolioScopedItems]);

  // Reset projectId if selection no longer available
  useEffect(() => {
    if (projectId === "all") return;
    if (!projectOptions.some((p) => p.id === projectId)) setProjectId("all");
  }, [projectOptions, projectId]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const staleCutoff = now - STALE_DAYS * 24 * 60 * 60 * 1000;
    return portfolioScopedItems.filter((it) => {
      if (projectId !== "all" && it.projectId !== projectId) return false;
      if (owner === "mine" && it.reportedBy !== user?.id) return false;
      if (chip === "high" && !(it.severity && HIGH.has(it.severity))) return false;
      if (chip === "stale") {
        const stale = new Date(it.updatedAt).getTime() < staleCutoff;
        const high = it.severity ? HIGH.has(it.severity) : false;
        const noOwner = !it.reportedBy;
        if (!(stale || high || noOwner)) return false;
      }
      return true;
    });
  }, [portfolioScopedItems, projectId, owner, chip, user?.id]);

  const buckets = bucketRb(filtered);
  const showWorkspace = isAllWorkspaces;

  const setOpen = (key: string) => (v: boolean) =>
    setOpenMap((m) => ({ ...m, [key]: v }));

  const ChipBtn = ({ value, label }: { value: QuickChip; label: string }) => (
    <Button
      type="button"
      size="sm"
      variant={chip === value ? "default" : "outline"}
      onClick={() => setChip(value)}
      className="h-7 px-2.5 text-xs"
    >
      {label}
    </Button>
  );

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Risks & Blockers</h1>
        <p className="text-xs text-muted-foreground mt-1">
          {isAllWorkspaces ? "All workspaces" : activeWorkspace?.name ?? "Workspace"}
          {" · "}operational escalation and visibility
        </p>
      </div>

      {/* Lightweight operational controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-input overflow-hidden">
          <Button
            type="button"
            size="sm"
            variant={owner === "all" ? "default" : "ghost"}
            onClick={() => setOwner("all")}
            className="h-7 px-3 text-xs rounded-none"
          >
            All
          </Button>
          <Button
            type="button"
            size="sm"
            variant={owner === "mine" ? "default" : "ghost"}
            onClick={() => setOwner("mine")}
            className="h-7 px-3 text-xs rounded-none"
            title="Items I reported (ownership/assignment data not available)"
          >
            Mine
          </Button>
        </div>

        <Select value={portfolioId} onValueChange={setPortfolioId}>
          <SelectTrigger className="h-8 w-[220px] text-xs">
            <SelectValue placeholder="All Portfolios" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Portfolios</SelectItem>
            {portfolioOptions.assigned.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
            {portfolioOptions.hasNone && (
              <SelectItem value={NO_PORTFOLIO_VALUE}>No Portfolio</SelectItem>
            )}
          </SelectContent>
        </Select>

        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="h-8 w-[220px] text-xs">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projectOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 ml-auto">
          <ChipBtn value="all" label="All active" />
          <ChipBtn value="high" label="Critical/High" />
          <ChipBtn value="stale" label="Stale / Needs attention" />
        </div>
      </div>

      {scopeLoading || isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <Section
            id="blockers"
            title="Active Blockers"
            icon={ShieldAlert}
            items={buckets.blockers}
            emptyText="No active blockers."
            showWorkspace={showWorkspace}
            open={openMap.blockers ?? true}
            onOpenChange={setOpen("blockers")}
          />
          <Section
            id="risks"
            title="Active Risks"
            icon={AlertTriangle}
            items={buckets.risks}
            emptyText="No active risks."
            showWorkspace={showWorkspace}
            open={openMap.risks ?? true}
            onOpenChange={setOpen("risks")}
          />
          <Section
            id="attention"
            title="Needs Attention"
            icon={Inbox}
            items={buckets.needsAttention}
            emptyText="No risks need attention. Everything is moving."
            showWorkspace={showWorkspace}
            open={openMap.attention ?? true}
            onOpenChange={setOpen("attention")}
          />
          <Section
            id="recent"
            title="Recently Updated"
            icon={Clock}
            items={buckets.recentlyUpdated}
            emptyText="No recent updates."
            showWorkspace={showWorkspace}
            open={openMap.recent ?? false}
            onOpenChange={setOpen("recent")}
          />
        </>
      )}
    </div>
  );
}
