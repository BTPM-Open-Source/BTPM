import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useActiveWorkspace } from "@/context/ActiveWorkspaceContext";
import { useMyWork, bucketMyWork, type MyWorkItem } from "@/hooks/useMyWork";
import { getPmWorkflowStatusLabel } from "@/lib/btpmVisualSemantics";
import { useProjectAccessMap } from "@/hooks/useProjectAccessMap";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MyWorkCalendar } from "@/components/myWork/MyWorkCalendar";
import {
  CalendarClock,
  AlertCircle,
  Clock,
  RefreshCw,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";


function formatDue(date: string | null) {
  if (!date) return "No due date";
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ItemCard({
  item,
  showWorkspace,
}: {
  item: MyWorkItem;
  showWorkspace: boolean;
}) {
  const href = `/workspace/${item.workspaceId}/project/${item.projectId}/task/${item.taskId}?from=my-work`;
  return (
    <Link to={href} className="block group">
      <Card className="transition-colors hover:bg-accent/30">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {item.title}
              </p>
              {item.hasOpenBlocker && (
                <Badge variant="destructive" className="shrink-0 text-[10px] px-1.5 py-0">
                  Blocked
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground mt-0.5">
              {item.projectName}
              {showWorkspace && item.workspaceName && (
                <> · {item.workspaceName}</>
              )}
              <> · {getPmWorkflowStatusLabel(item.status)}</>
              <> · Due {formatDue(item.dueDate)}</>
            </p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </CardContent>
      </Card>
    </Link>
  );
}

function Section({
  title,
  icon: Icon,
  items,
  emptyText,
  showWorkspace,
  tone = "default",
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: MyWorkItem[];
  emptyText: string;
  showWorkspace: boolean;
  tone?: "default" | "danger" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-500"
        : "text-foreground";
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${toneClass}`} />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">
          {items.length > 0 ? items.length : ""}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-6">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <ItemCard key={it.taskId} item={it} showWorkspace={showWorkspace} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function MyWork() {
  const { activeScope, activeWorkspace, isAllWorkspaces } = useActiveWorkspace();
  const [mode, setMode] = useState<"list" | "calendar">("list");

  const scopeForQuery =
    activeScope.type === "workspace"
      ? { type: "workspace" as const, workspaceId: activeScope.workspaceId }
      : { type: "all" as const };

  const { data: rawData, isLoading, error } = useMyWork(scopeForQuery);
  const access = useProjectAccessMap();
  const data = useMemo(
    () =>
      (rawData ?? []).filter((it) =>
        access.canSeeProject({ id: it.projectId, workspace_id: it.workspaceId }),
      ),
    [rawData, access],
  );
  const buckets = bucketMyWork(data);
  const showWorkspace = isAllWorkspaces;

  const scopeLabel = isAllWorkspaces
    ? "All workspaces"
    : activeWorkspace?.name ?? "Workspace";

  const containerWidth = mode === "calendar" ? "max-w-7xl" : "max-w-3xl";

  return (
    <div className={`p-6 ${containerWidth} mx-auto space-y-6`}>
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            My Work <span className="text-muted-foreground font-normal">· {scopeLabel}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            What requires your attention right now.
          </p>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(v) => v && setMode(v as "list" | "calendar")}
        >
          <ToggleGroupItem value="list">List</ToggleGroupItem>
          <ToggleGroupItem value="calendar">Calendar</ToggleGroupItem>
        </ToggleGroup>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Unable to load your work right now.
          </CardContent>
        </Card>
      ) : (data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You're clear. Nothing assigned to you in this scope.
          </CardContent>
        </Card>
      ) : mode === "calendar" ? (
        <MyWorkCalendar items={data ?? []} showWorkspace={showWorkspace} />
      ) : (
        <div className="space-y-6">
          <Section
            title="Due Today"
            icon={CalendarClock}
            items={buckets.dueToday}
            emptyText="Nothing due today."
            showWorkspace={showWorkspace}
          />
          <Section
            title="Overdue"
            icon={AlertCircle}
            items={buckets.overdue}
            emptyText="No overdue items."
            showWorkspace={showWorkspace}
            tone="danger"
          />
          <Section
            title="Upcoming"
            icon={Clock}
            items={buckets.upcoming}
            emptyText="Nothing in the next 7 days."
            showWorkspace={showWorkspace}
          />
          <Section
            title="Needs Update"
            icon={RefreshCw}
            items={buckets.needsUpdate}
            emptyText="All your items have recent activity."
            showWorkspace={showWorkspace}
            tone="warning"
          />
          <Section
            title="Blocked"
            icon={ShieldAlert}
            items={buckets.blocked}
            emptyText="Nothing blocked."
            showWorkspace={showWorkspace}
            tone="danger"
          />
        </div>
      )}
    </div>
  );
}
