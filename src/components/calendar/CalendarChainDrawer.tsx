import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertTriangle, ExternalLink, ArrowDown, GitBranch } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { semanticTypeLabel, isNonStandardType } from "@/lib/phaseTypes";
import { type CalendarItem, buildUpstreamTree, countUpstreamPredecessors, type UpstreamNode } from "./calendarUtils";
import type { DepEdge } from "@/lib/dependencyConflictEngine";

interface Props {
  open: boolean;
  onClose: () => void;
  rootItem: CalendarItem | null;
  itemsById: Record<string, CalendarItem>;
  dependencies: DepEdge[];
  dependenciesLoading: boolean;
  basePath: string;
  calendarReturnTo: string;
}

function detailHref(basePath: string, item: CalendarItem, calendarReturnTo: string): string {
  const seg = item.kind === "phase" ? "phase" : "task";
  const ret = encodeURIComponent(calendarReturnTo);
  return `${basePath}/${seg}/${item.id}?from=calendar&returnTo=${ret}`;
}

function NodeCard({
  node, basePath, calendarReturnTo, isRoot,
}: {
  node: UpstreamNode;
  basePath: string;
  calendarReturnTo: string;
  isRoot: boolean;
}) {
  const { item, downstream, validToNext } = node;
  const typed = isNonStandardType(item.semanticType);
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant={isRoot ? "default" : "outline"} className="text-[10px]">
              {isRoot ? "Selected" : "Predecessor"}
            </Badge>
            <Badge variant="outline" className="text-[10px] capitalize">{item.kind}</Badge>
            {typed && (
              <Badge variant="secondary" className="text-[10px]">{semanticTypeLabel(item.semanticType)}</Badge>
            )}
          </div>
          <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="capitalize">{item.status.replace(/_/g, " ")}</span>
            {item.start && <> · {item.start}</>}
            {item.end && <> → {item.end}</>}
          </p>
          {downstream && (
            <p className="text-[11px] text-muted-foreground mt-1.5 inline-flex items-center gap-1">
              <ArrowDown className="h-3 w-3" />
              feeds into <span className="font-medium text-foreground">{downstream.name}</span>
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" asChild className="h-7 w-7 shrink-0">
          <Link to={detailHref(basePath, item, calendarReturnTo)} aria-label="Open detail">
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      {validToNext !== null && (
        <div className={cn(
          "mt-2 inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5",
          validToNext
            ? "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30"
            : "text-destructive bg-destructive/10",
        )}>
          {validToNext
            ? <><CheckCircle2 className="h-3 w-3" /> Hand-off OK to {downstream?.name}</>
            : <><AlertTriangle className="h-3 w-3" /> Date conflict with {downstream?.name}</>}
        </div>
      )}
    </div>
  );
}

function TreeBranch({
  node, basePath, calendarReturnTo, isRoot,
}: {
  node: UpstreamNode;
  basePath: string;
  calendarReturnTo: string;
  isRoot: boolean;
}) {
  return (
    <div className="space-y-2">
      <NodeCard node={node} basePath={basePath} calendarReturnTo={calendarReturnTo} isRoot={isRoot} />
      {node.children.length > 0 && (
        <div className="ml-4 pl-3 border-l-2 border-border space-y-2">
          {node.children.map((c) => (
            <TreeBranch
              key={`${c.item.id}|${c.depth}`}
              node={c}
              basePath={basePath}
              calendarReturnTo={calendarReturnTo}
              isRoot={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CalendarChainDrawer({
  open, onClose, rootItem, itemsById, dependencies, dependenciesLoading, basePath, calendarReturnTo,
}: Props) {
  const tree = rootItem && !dependenciesLoading
    ? buildUpstreamTree({
        rootId: rootItem.id,
        rootType: rootItem.kind,
        dependencies: dependencies as DepEdge[],
        itemsById,
      })
    : null;

  const predCount = tree ? countUpstreamPredecessors(tree) : 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Dependency chain</SheetTitle>
          <SheetDescription>
            Full upstream same-level finish-to-start predecessors of the selected key-date item.
          </SheetDescription>
        </SheetHeader>

        {!rootItem ? null : dependenciesLoading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-24 w-full" />
            <p className="text-xs text-muted-foreground italic">Loading dependencies…</p>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full ml-4" />
          </div>
        ) : !tree ? (
          <p className="mt-4 text-sm text-muted-foreground italic">Item no longer available.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {predCount === 0 ? (
              <>
                <NodeCard node={tree} basePath={basePath} calendarReturnTo={calendarReturnTo} isRoot />
                <p className="text-sm text-muted-foreground italic">
                  Standalone key-date item — no upstream dependencies.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <GitBranch className="h-3 w-3" />
                  {predCount} upstream predecessor{predCount === 1 ? "" : "s"} (full graph)
                </div>
                <TreeBranch node={tree} basePath={basePath} calendarReturnTo={calendarReturnTo} isRoot />
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
