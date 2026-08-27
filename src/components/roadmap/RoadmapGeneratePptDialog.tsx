// RM-PPT-2 — Roadmap "Generate PPT" scope confirmation modal.
// Source-of-truth: backend `generate-roadmap-status-deck` Edge Function and
// `generated_operational_documents` history. No screenshots, no deck bytes
// stored in Supabase storage.

import { useMemo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ExternalLink, FileBarChart2, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  generateRoadmapStatusDeck, mapRoadmapDeckError,
} from "@/lib/roadmapStatusDeckService";
import { useLatestRoadmapStatusDeck } from "@/hooks/useLatestRoadmapStatusDeck";
import { isFileLockedCode } from "@/lib/generatedFileErrorMessages";
import { GeneratedFilePublishIssueDialog } from "@/components/generated-docs/GeneratedFilePublishIssueDialog";

interface OptionRef { id: string; label: string }

// Project-first scope passed in from Roadmap.tsx. This is the final
// filtered Roadmap result set — projectIds, plus workspace/program
// labels for display only. Backend authorization is project-scoped.
export interface RoadmapPptScopeProject {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  programId: string | null;
  programName: string | null;
  // Phase 6D.7B — Portfolio provenance for scope display only.
  portfolioItemId: string | null;
  portfolioName: string | null;
  portfolioCode: string | null;
  portfolioLifecycleState: string | null;
  portfolioIsArchived: boolean | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Final filtered Roadmap project set — source of truth for the request.
  filteredProjects: RoadmapPptScopeProject[];
  // The following are display-only labels reflecting the current filter UI.
  selectedWorkspaceIds: string[];
  workspaces: OptionRef[];
  selectedProgramIds: string[];
  programOptions: OptionRef[];
  selectedProjectIds: string[];
  // Phase 6D.7B — canonical Portfolio scope. Never contains "__none__".
  portfolioItemIds: string[];
  includeNoPortfolio: boolean;
}

function formatPortfolioLabelFromProject(p: RoadmapPptScopeProject): string | null {
  if (!p.portfolioItemId) return null;
  const name = p.portfolioName || "Unnamed Portfolio";
  const code = p.portfolioCode || null;
  const base = code ? `${code} — ${name}` : name;
  return p.portfolioIsArchived ? `${base} (archived)` : base;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function humanDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return iso; }
}

const MONTH_LABELS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export function RoadmapGeneratePptDialog({
  open, onOpenChange, filteredProjects, workspaces, selectedWorkspaceIds,
  selectedProgramIds, programOptions, selectedProjectIds,
  portfolioItemIds, includeNoPortfolio,
}: Props) {
  const qc = useQueryClient();
  const now = useMemo(() => new Date(), []);
  const [calendarMode, setCalendarMode] = useState<"year" | "month">("year");
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth()); // 0..11
  const [busy, setBusy] = useState(false);
  const [lockedDialogOpen, setLockedDialogOpen] = useState(false);

  // Authoritative project scope = filtered Roadmap result set.
  const projectIds = useMemo(
    () => Array.from(new Set(filteredProjects.map((p) => p.id))),
    [filteredProjects],
  );

  // Derive workspace ids from the filtered project set — display only.
  const derivedWorkspaceIds = useMemo(
    () => Array.from(new Set(filteredProjects.map((p) => p.workspaceId))),
    [filteredProjects],
  );
  const isSingleWorkspace = derivedWorkspaceIds.length === 1;
  const singleWorkspaceId = isSingleWorkspace ? derivedWorkspaceIds[0] : undefined;
  const { data: latest, isLoading: latestLoading } =
    useLatestRoadmapStatusDeck(singleWorkspaceId);

  const workspaceLabels = useMemo(() => {
    const byId = new Map(workspaces.map((w) => [w.id, w.label]));
    const fromProjects = new Map<string, string>();
    for (const p of filteredProjects) {
      if (!fromProjects.has(p.workspaceId)) fromProjects.set(p.workspaceId, p.workspaceName);
    }
    return derivedWorkspaceIds.map((id) => byId.get(id) ?? fromProjects.get(id) ?? id);
  }, [derivedWorkspaceIds, workspaces, filteredProjects]);

  const programLabels = useMemo(() => {
    // Derive program labels from the filtered project set so the dialog
    // always reflects the final visible scope, regardless of how the
    // user reached it (program filter, project filter, or no filter).
    const set = new Map<string, string>();
    let hasStandalone = false;
    for (const p of filteredProjects) {
      if (p.programId) set.set(p.programId, p.programName || "(unnamed program)");
      else hasStandalone = true;
    }
    const labels = Array.from(set.values());
    if (hasStandalone) labels.push("Standalone");
    return labels.length > 0 ? labels : ["All programs"];
  }, [filteredProjects]);

  const projectLabels = useMemo(
    () => filteredProjects.map((p) => p.name),
    [filteredProjects],
  );

  // Phase 6D.7B — Portfolio badges derived from filteredProjects.
  const portfolioBadges = useMemo(() => {
    const explicit = portfolioItemIds.length > 0 || includeNoPortfolio;
    const labels = new Set<string>();
    let hasNoPortfolio = false;
    for (const p of filteredProjects) {
      const l = formatPortfolioLabelFromProject(p);
      if (l) labels.add(l);
      else hasNoPortfolio = true;
    }
    const labelList = Array.from(labels);
    return { explicit, labels: labelList, hasNoPortfolio };
  }, [filteredProjects, portfolioItemIds, includeNoPortfolio]);
  // Silence unused-prop lints — these are accepted for forward
  // compatibility / debugging context but not used in the project-first
  // payload construction.
  void selectedWorkspaceIds; void selectedProgramIds; void selectedProjectIds; void programOptions;

  // Calendar range (derived from mode + year/month)
  const { calendarStart, calendarEnd, calendarRangeLabel } = useMemo(() => {
    if (calendarMode === "year") {
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31);
      return {
        calendarStart: fmtDate(start),
        calendarEnd: fmtDate(end),
        calendarRangeLabel: `${year}`,
      };
    }
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return {
      calendarStart: fmtDate(start),
      calendarEnd: fmtDate(end),
      calendarRangeLabel: `${MONTH_LABELS[month]} ${year}`,
    };
  }, [calendarMode, year, month]);

  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 1, y, y + 1, y + 2];
  }, [now]);

  const latestPublished =
    latest && latest.sharepoint_publish_status === "published" && !!latest.sharepoint_web_url;

  const run = async () => {
    if (projectIds.length === 0) return;
    setBusy(true);
    try {
      const result = await generateRoadmapStatusDeck({
        projectIds,
        calendarMode,
        calendarStart,
        calendarEnd,
        roadmapFilters: {
          portfolio_item_ids: portfolioItemIds,
          include_no_portfolio: includeNoPortfolio,
        },
      });
      await qc.invalidateQueries({
        queryKey: ["generated-operational-docs", "roadmap_status_deck"],
      });

      if (result.ok && result.sharepoint_web_url) {
        const url = result.sharepoint_web_url;
        toast({
          title: "Roadmap status deck generated",
          description: (
            <span className="block">
              <span className="block">{result.filename ?? "Roadmap deck"}</span>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in SharePoint
              </a>
            </span>
          ) as unknown as string,
        });
        // Filter out informational notices (e.g. multi-workspace publish
        // fallback to the BTPM site root is expected behavior, not a warning).
        const meaningfulWarnings = (result.warnings ?? []).filter(
          (w) => !w.startsWith("publish_fallback:btpm_site_root"),
        );
        if (meaningfulWarnings.length > 0) {
          toast({
            title: "Deck generated with warnings",
            description: meaningfulWarnings.join("; "),
          });
        }
        onOpenChange(false);
      } else {
        if (isFileLockedCode(result.error)) {
          setLockedDialogOpen(true);
        } else {
          toast({
            title: "Could not generate roadmap status deck",
            description: mapRoadmapDeckError(result),
            variant: "destructive",
          });
        }
      }
    } catch (e) {
      toast({
        title: "Could not generate roadmap status deck",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBarChart2 className="h-4 w-4" />
            Generate Roadmap Status Deck
          </DialogTitle>
          <DialogDescription>
            The deck will include Roadmap dashboard, attention list, current/upcoming
            projects, program timeline, and calendar based on the selected filters.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scope summary */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground w-28">
                Workspace
              </span>
              <div className="flex flex-wrap gap-1">
                {workspaceLabels.length === 0 ? (
                  <Badge variant="outline">None</Badge>
                ) : workspaceLabels.map((l, i) => (
                  <Badge key={i} variant="secondary">{l}</Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground w-28">
                Portfolios
              </span>
              <div className="flex flex-wrap gap-1">
                {(() => {
                  const shown = portfolioBadges.labels.slice(0, 6);
                  const extra = portfolioBadges.labels.length - shown.length;
                  const nodes: JSX.Element[] = [];
                  if (!portfolioBadges.explicit && portfolioBadges.labels.length === 0 && portfolioBadges.hasNoPortfolio) {
                    nodes.push(<Badge key="all" variant="outline">All Portfolios</Badge>);
                  } else if (!portfolioBadges.explicit && portfolioBadges.labels.length > 0 && portfolioBadges.hasNoPortfolio) {
                    nodes.push(<Badge key="all" variant="outline">All Portfolios</Badge>);
                  }
                  shown.forEach((l, i) => nodes.push(<Badge key={`p${i}`} variant="secondary">{l}</Badge>));
                  if (extra > 0) nodes.push(<Badge key="more" variant="outline">+{extra} more</Badge>);
                  if (portfolioBadges.hasNoPortfolio && (portfolioBadges.explicit || portfolioBadges.labels.length > 0)) {
                    nodes.push(<Badge key="none" variant="outline">No Portfolio</Badge>);
                  }
                  if (nodes.length === 0) nodes.push(<Badge key="all2" variant="outline">All Portfolios</Badge>);
                  return nodes;
                })()}
              </div>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground w-28">
                Programs
              </span>
              <div className="flex flex-wrap gap-1">
                {programLabels.map((l, i) => (
                  <Badge key={i} variant="outline">{l}</Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground w-28">
                Projects
              </span>
              <div className="flex flex-wrap gap-1">
                {projectLabels.slice(0, 8).map((l, i) => (
                  <Badge key={i} variant="outline">{l}</Badge>
                ))}
                {projectLabels.length > 8 && (
                  <Badge variant="outline">+{projectLabels.length - 8} more</Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground w-28">
                Output
              </span>
              <span className="text-xs text-muted-foreground">
                PowerPoint deck saved to the workspace SharePoint library.
              </span>
            </div>
          </div>

          {/* Multi-workspace info — purely informational, no longer a block */}
          {!isSingleWorkspace && derivedWorkspaceIds.length > 1 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Multiple workspaces in scope</AlertTitle>
              <AlertDescription>
                The deck will include all selected workspaces and be published to the
                BTPM SharePoint site (default document library).
              </AlertDescription>
            </Alert>
          )}

          {/* Calendar selector */}
          {derivedWorkspaceIds.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Calendar slide
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Mode</Label>
                  <Select
                    value={calendarMode}
                    onValueChange={(v) => setCalendarMode(v as "year" | "month")}
                  >
                    <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="year">Year</SelectItem>
                      <SelectItem value="month">Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Year</Label>
                  <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                    <SelectTrigger className="h-9 w-[100px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {yearOptions.map((y) => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {calendarMode === "month" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Month</Label>
                    <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                      <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTH_LABELS.map((m, i) => (
                          <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="text-xs text-muted-foreground self-center">
                  Range: <span className="font-medium">{calendarRangeLabel}</span>
                </div>
              </div>
            </div>
          )}

          {/* Latest deck */}
          {isSingleWorkspace && (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Latest roadmap deck
              </div>
              {latestLoading ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              ) : latest ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{latest.output_filename}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>Generated {humanDate(latest.generated_at)}</span>
                      <Badge
                        variant={latestPublished ? "default" : "secondary"}
                        className="text-[10px] py-0 px-1.5"
                      >
                        {latest.sharepoint_publish_status ?? "unknown"}
                      </Badge>
                    </div>
                  </div>
                  {latestPublished && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(latest.sharepoint_web_url!, "_blank", "noopener,noreferrer")
                      }
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Open in SharePoint
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No roadmap deck has been generated for this workspace yet.
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || projectIds.length === 0}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <FileBarChart2 className="h-4 w-4 mr-1.5" />
            )}
            Generate PPT
          </Button>
        </DialogFooter>
      </DialogContent>
      <GeneratedFilePublishIssueDialog
        open={lockedDialogOpen}
        onOpenChange={setLockedDialogOpen}
        existingFileUrl={latest?.sharepoint_web_url ?? null}
        busy={busy}
        onRetry={() => {
          setLockedDialogOpen(false);
          void run();
        }}
      />
    </Dialog>
  );
}
