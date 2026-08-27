/**
 * Phase 6B.5 — Source package preview panel.
 *
 * Read-only review of the bounded source snapshot that the future AI
 * generation step will see. No AI is called; nothing is persisted.
 */

import { useMemo, useState } from "react";
import { Loader2, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, Info, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRoadmapStorySourceSnapshot } from "@/hooks/useRoadmapStorySourceSnapshot";
import {
  STORY_SNAPSHOT_LIMITS,
  type RoadmapStorySourceSnapshot,
  type StorySourceBlock,
  type StorySourceBlockStatus,
} from "@/lib/roadmap-story/roadmapStorySourceSnapshot";
import type { RoadmapStorySourceCategory } from "@/lib/roadmapStoryPackService";

const CATEGORY_TITLES: Record<RoadmapStorySourceCategory, string> = {
  program_project_overview: "Program & project overview",
  planning_phases_tasks: "Planning, phases & tasks",
  progress_updates: "Progress updates",
  activity_history: "Activity history",
  discussions_comments: "Discussions & comments",
  risks: "Risks",
  blockers: "Blockers",
  dependencies: "Dependencies",
  kpis_snapshots: "KPIs & snapshots",
  governance_decisions: "Governance & decisions",
  team_work: "Team work",
  documents_metadata: "Linked document metadata",
  external_context: "Extra user context",
};

const STATUS_STYLE: Record<StorySourceBlockStatus, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" },
  partial: { label: "Partial", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" },
  empty: { label: "Empty", cls: "bg-muted text-muted-foreground border-border" },
  unavailable: { label: "Not connected yet", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20" },
  disabled: { label: "Off", cls: "bg-muted text-muted-foreground/70 border-border" },
};

export function RoadmapStorySourcePackagePreview({ storyPackId }: { storyPackId: string }) {
  const { snapshot, sourcesLoading, sourcesError, refresh } =
    useRoadmapStorySourceSnapshot(storyPackId);
  const [showJson, setShowJson] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <CardTitle className="text-sm flex items-center gap-2">
              Review source package
              <Badge variant="outline" className="text-[10px]">Preview only</Badge>
            </CardTitle>
            <p className="text-[12px] text-muted-foreground max-w-2xl">
              This is the material the future Story generation will use. AI is not called yet, and
              nothing here is persisted as a Story version.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={refresh}
            disabled={sourcesLoading}
          >
            {sourcesLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh source package
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sourcesError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[12px] text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
            <span>
              Roadmap source data failed to load. The snapshot will only show Story Pack
              configuration.
            </span>
          </div>
        )}
        {!snapshot ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Composing source package…
          </div>
        ) : (
          <SnapshotBody snapshot={snapshot} sourcesLoading={sourcesLoading} />
        )}

        {snapshot && (
          <div className="pt-1">
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              onClick={() => setShowJson((v) => !v)}
            >
              {showJson ? "Hide technical snapshot JSON" : "Show technical snapshot JSON (debug)"}
            </button>
            {showJson && (
              <pre className="mt-1 max-h-72 overflow-auto rounded-md border bg-muted/30 p-2 text-[10px] leading-snug">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-2 text-[11px] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 mt-0.5" />
          <span>
            Source package is ready for the future AI generation step. Generation, Story versions,
            sharing, and exports are not implemented yet.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function SnapshotBody({
  snapshot,
  sourcesLoading,
}: {
  snapshot: RoadmapStorySourceSnapshot;
  sourcesLoading: boolean;
}) {
  const categories = useMemo(
    () =>
      (Object.keys(snapshot.sources) as RoadmapStorySourceCategory[]).filter(
        (k) => !!snapshot.sources[k],
      ),
    [snapshot.sources],
  );

  return (
    <div className="space-y-3">
      {sourcesLoading && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Some source fetches are still in flight —
          counts will refine as they resolve.
        </div>
      )}

      {/* Scope + intent header */}
      <div className="grid sm:grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-md border bg-card p-2 space-y-0.5">
          <div className="font-medium text-foreground">Scope</div>
          <div className="text-muted-foreground">
            Effective source scope: {snapshot.scope.effective.workspaceCount} workspace
            {snapshot.scope.effective.workspaceCount === 1 ? "" : "s"} ·{" "}
            {snapshot.scope.effective.programCountAvailable
              ? `${snapshot.scope.effective.programCount} program${snapshot.scope.effective.programCount === 1 ? "" : "s"}`
              : "programs not available from source rows"}{" "}
            · {snapshot.scope.effective.projectCount} project
            {snapshot.scope.effective.projectCount === 1 ? "" : "s"}
            {" · "}
            {snapshot.scope.effective.portfolioCount} Portfolio
            {snapshot.scope.effective.portfolioCount === 1 ? "" : "s"}
            {snapshot.scope.effective.noPortfolioProjectCount > 0 && (
              <>
                {" · "}
                {snapshot.scope.effective.noPortfolioProjectCount} project
                {snapshot.scope.effective.noPortfolioProjectCount === 1 ? "" : "s"} with No Portfolio
              </>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Captured filters:{" "}
            {snapshot.scope.captured.workspaceIds.length} workspace filter
            {snapshot.scope.captured.workspaceIds.length === 1 ? "" : "s"} ·{" "}
            {snapshot.scope.captured.programIds.length === 0
              ? "no program filter"
              : `${snapshot.scope.captured.programIds.length} program filter${snapshot.scope.captured.programIds.length === 1 ? "" : "s"}`}{" "}
            ·{" "}
            {snapshot.scope.captured.projectIds.length === 0
              ? "no explicit project filter"
              : `${snapshot.scope.captured.projectIds.length} explicit project filter${snapshot.scope.captured.projectIds.length === 1 ? "" : "s"}`}
            {" · "}
            {snapshot.scope.captured.portfolioItemIds.length === 0
              ? "no Portfolio filter"
              : `${snapshot.scope.captured.portfolioItemIds.length} Portfolio filter${snapshot.scope.captured.portfolioItemIds.length === 1 ? "" : "s"}`}
            {snapshot.scope.captured.includeNoPortfolio && " + No Portfolio"}
          </div>
          <div className="text-[11px] text-muted-foreground italic">
            Project count reflects resolved authorized projects included by the source package,
            not only explicit Roadmap filter selections.
          </div>
          <div className="text-[11px] text-muted-foreground">
            Source: {snapshot.scope.source === "roadmap_filters" ? "Captured Roadmap filters" : "Story Pack scope"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Last composed: {formatComposedAt(snapshot.generatedAt)}
          </div>
        </div>
        <div className="rounded-md border bg-card p-2">
          <div className="font-medium text-foreground">Intent</div>
          <div className="text-muted-foreground truncate">
            {snapshot.intent.title || "Untitled"} · {snapshot.intent.audience || "—"} ·{" "}
            {snapshot.intent.focus || "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Guidance: {snapshot.intent.guidance ? "included" : "none"}
          </div>
        </div>
      </div>


      {snapshot.warnings.length > 0 && (
        <ul className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] space-y-0.5">
          {snapshot.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Category blocks */}
      <div className="space-y-1.5">
        {categories.map((cat) => {
          const block = snapshot.sources[cat] as StorySourceBlock | undefined;
          if (!block) return null;
          return <CategoryRow key={cat} block={block} />;
        })}
      </div>

      <div className="text-[10px] text-muted-foreground">
        Bounded snapshot — limits: projects {STORY_SNAPSHOT_LIMITS.projects}, phases{" "}
        {STORY_SNAPSHOT_LIMITS.phases}, tasks {STORY_SNAPSHOT_LIMITS.tasks}, risks{" "}
        {STORY_SNAPSHOT_LIMITS.risks}, blockers {STORY_SNAPSHOT_LIMITS.blockers}, dependencies{" "}
        {STORY_SNAPSHOT_LIMITS.dependencies}, KPIs {STORY_SNAPSHOT_LIMITS.kpis}, governance{" "}
        {STORY_SNAPSHOT_LIMITS.governance}, activity {STORY_SNAPSHOT_LIMITS.activity}, team work{" "}
        {STORY_SNAPSHOT_LIMITS.teamWork}, notes {STORY_SNAPSHOT_LIMITS.notes}, files{" "}
        {STORY_SNAPSHOT_LIMITS.files}. Long text truncated at {STORY_SNAPSHOT_LIMITS.textChars}{" "}
        chars.
      </div>
    </div>
  );
}

function CategoryRow({ block }: { block: StorySourceBlock }) {
  const [open, setOpen] = useState(false);
  const style = STATUS_STYLE[block.status];
  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/30 rounded-md"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium flex-1 truncate">
          {CATEGORY_TITLES[block.category]}
        </span>
        <Badge variant="outline" className={`text-[10px] ${style.cls}`}>
          {style.label}
        </Badge>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {block.items.length} / {block.count}
        </span>
      </button>
      {open && (
        <div className="border-t bg-muted/10 px-3 py-2 space-y-2">
          {block.coverageNotes.length > 0 && (
            <ul className="text-[11px] text-muted-foreground space-y-0.5">
              {block.coverageNotes.map((n, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}
          {block.items.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">No items.</p>
          ) : (
            <ul className="text-[11px] divide-y">
              {block.items.slice(0, 10).map((it, i) => (
                <li key={i} className="py-1.5">
                  <ItemPreviewRow item={it} />
                </li>
              ))}
              {block.items.length > 10 && (
                <li className="py-1 text-muted-foreground italic">
                  …and {block.items.length - 10} more in the snapshot.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 6B.6a — Item preview renders the headline on the first line and the
 * bounded semantic detail (description / mitigation / summary) on a
 * second line so reviewers can confirm meaningful context is included.
 */
function ItemPreviewRow({ item }: { item: unknown }) {
  if (!item || typeof item !== "object") {
    return <span className="font-mono">{String(item)}</span>;
  }
  const o = item as Record<string, unknown>;
  const headline = renderItemHeadline(o);
  const detail = (o.detail as { text?: string | null; available?: boolean; truncated?: boolean } | undefined) ?? undefined;
  const mitigation = (o.mitigation as { text?: string | null; available?: boolean; truncated?: boolean } | undefined) ?? undefined;
  const decisionQuestion = (o.decisionQuestion as { text?: string | null; available?: boolean; truncated?: boolean } | undefined) ?? undefined;
  // Some categories carry only `body` (notes) — surface that as detail too.
  const noteBody = typeof o.body === "string" ? String(o.body) : null;

  const detailText =
    (detail && detail.available && detail.text) ||
    (decisionQuestion && decisionQuestion.available && decisionQuestion.text) ||
    noteBody ||
    null;
  const detailTruncated =
    (!!detail && detail.truncated) ||
    (!!decisionQuestion && decisionQuestion.truncated) ||
    (!!mitigation && mitigation.truncated);
  const detailMissing =
    detail !== undefined &&
    !detail.available &&
    !(decisionQuestion && decisionQuestion.available) &&
    !noteBody;

  return (
    <div className="space-y-0.5">
      <div className="font-mono truncate">{headline}</div>
      {detailText && (
        <div className="text-muted-foreground line-clamp-2 pl-1">
          {detailText.length > 220 ? detailText.slice(0, 220) + "…" : detailText}
        </div>
      )}
      {mitigation && mitigation.available && mitigation.text && (
        <div className="text-muted-foreground line-clamp-2 pl-1">
          <span className="text-foreground/70">Mitigation:</span>{" "}
          {mitigation.text.length > 220 ? mitigation.text.slice(0, 220) + "…" : mitigation.text}
        </div>
      )}
      <div className="flex flex-wrap gap-1 pl-1">
        {detailMissing && (
          <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
            No detail text available
          </Badge>
        )}
        {detailTruncated && (
          <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-700 dark:text-amber-400">
            Detail truncated
          </Badge>
        )}
      </div>
    </div>
  );
}

function renderItemHeadline(o: Record<string, unknown>): string {
  const label =
    (o.title as string) ||
    (o.name as string) ||
    (o.taskName as string) ||
    (o.projectName as string) ||
    (o.displayName as string) ||
    (o.label as string) ||
    (o.eventType as string) ||
    (o.id as string) ||
    "(item)";
  const project = (o.projectName as string) || "";
  const status = (o.status as string) || (o.decisionStatus as string) || "";
  const itemType = (o.itemType as string) || "";
  const parentPhase = (o.parentPhaseName as string) || "";
  const endDate = (o.endDate as string) || "";
  const sourceType = (o.sourceType as string) || "";
  const flags: string[] = [];
  if (o.isOverdue) flags.push("overdue");
  if (o.isCompleted) flags.push("done");
  else if (o.isInProgress) flags.push("in progress");
  if (o.isCompletion) flags.push("completion");
  if (o.isDelivery) flags.push("delivery");
  if (o.isScheduleMovement) flags.push("schedule");
  if (o.isStatusChange) flags.push("status change");
  const typeTag = itemType ? `[${itemType}]` : sourceType ? `[${sourceType}]` : "";
  const phaseTag = parentPhase ? `← ${parentPhase}` : "";
  return [
    typeTag,
    String(label).slice(0, 80),
    project && project !== label ? project : "",
    phaseTag,
    status,
    endDate,
    flags.length ? `(${flags.join(", ")})` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}


function formatComposedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
