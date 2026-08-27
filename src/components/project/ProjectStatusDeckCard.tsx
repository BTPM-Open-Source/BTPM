// PPT-2 — Weekly Project Status Deck UI.
// User-facing entry point for generating and viewing the latest weekly deck.
// Source-of-truth: backend `generate-project-status-deck` Edge Function and
// `generated_operational_documents` history. No local deck data is stored.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CalendarRange,
  ExternalLink,
  FileBarChart2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { generateProjectStatusDeck, type StatusDeckResult } from "@/lib/projectStatusDeckService";
import { useLatestProjectStatusDeck } from "@/hooks/useLatestProjectStatusDeck";
import {
  generatedFileUserMessage,
  isFileLockedCode,
} from "@/lib/generatedFileErrorMessages";
import { GeneratedFilePublishIssueDialog } from "@/components/generated-docs/GeneratedFilePublishIssueDialog";

interface Props {
  projectId: string;
  canGenerate: boolean;
}

/** Previous full calendar week (Mon..Sun) relative to today. */
function previousFullWeek(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  const thisMonday = new Date(now);
  thisMonday.setHours(0, 0, 0, 0);
  thisMonday.setDate(now.getDate() - daysSinceMonday);
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(thisMonday.getDate() - 7);
  const prevSunday = new Date(prevMonday);
  prevSunday.setDate(prevMonday.getDate() + 6);
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  return { start: fmt(prevMonday), end: fmt(prevSunday) };
}

function humanDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function mapErrorMessage(result: StatusDeckResult): string {
  const code = result.error ?? "unknown_error";
  const overrides: Record<string, string> = {
    project_not_found: "Project not found.",
    project_not_accessible: "Project is not accessible.",
    invalid_period: "The reporting period is invalid.",
  };
  if (overrides[code]) return overrides[code];
  return generatedFileUserMessage({ code, note: result.note ?? null });
}

export function ProjectStatusDeckCard({ projectId, canGenerate }: Props) {
  const qc = useQueryClient();
  const defaults = useMemo(previousFullWeek, []);
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);
  const [busy, setBusy] = useState(false);
  const [lockedDialogOpen, setLockedDialogOpen] = useState(false);

  const { data: latest, isLoading } = useLatestProjectStatusDeck(projectId);

  const isDefaultPeriod = periodStart === defaults.start && periodEnd === defaults.end;
  const periodInvalid = !!periodStart && !!periodEnd && periodStart > periodEnd;

  const run = async () => {
    if (periodInvalid) {
      toast({
        title: "Invalid reporting period",
        description: "Period start must be on or before period end.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const result = await generateProjectStatusDeck(projectId, {
        periodStart,
        periodEnd,
      });
      await qc.invalidateQueries({
        queryKey: ["generated-operational-docs", projectId],
      });

      if (result.ok && result.sharepoint_web_url) {
        const desc =
          `${result.filename ?? "Weekly status deck"} · ` +
          `${humanDate(result.period_start ?? periodStart)} – ${humanDate(result.period_end ?? periodEnd)}`;
        toast({
          title: "Weekly status deck generated",
          description: desc,
          action: (
            <button
              type="button"
              onClick={() =>
                window.open(result.sharepoint_web_url!, "_blank", "noopener,noreferrer")
              }
              className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in SharePoint
            </button>
          ),
        });
        if (result.warnings && result.warnings.length > 0) {
          toast({
            title: "Deck generated with warnings",
            description: result.warnings.join("; "),
          });
        }
      } else {
        if (isFileLockedCode(result.error)) {
          setLockedDialogOpen(true);
        } else {
          toast({
            title: "Could not generate weekly status deck",
            description: mapErrorMessage(result),
            variant: "destructive",
          });
        }
      }
    } catch (e) {
      toast({
        title: "Could not generate weekly status deck",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const latestPublished =
    latest && latest.sharepoint_publish_status === "published" && !!latest.sharepoint_web_url;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileBarChart2 className="h-4 w-4" />
          Weekly Project Status Deck
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Latest deck */}
        <div className="rounded-md border bg-muted/30 p-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading latest deck…
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
              No weekly status deck has been generated for this project yet.
            </div>
          )}
        </div>

        {/* Period selector + Generate */}
        {canGenerate ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarRange className="h-3.5 w-3.5" />
              <span>
                Default reporting period: previous full calendar week
                {isDefaultPeriod ? " (currently selected)" : ""}.
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="deck-period-start" className="text-xs">
                  Period start
                </Label>
                <Input
                  id="deck-period-start"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="h-9 w-[160px]"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="deck-period-end" className="text-xs">
                  Period end
                </Label>
                <Input
                  id="deck-period-end"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="h-9 w-[160px]"
                />
              </div>
              {!isDefaultPeriod && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPeriodStart(defaults.start);
                    setPeriodEnd(defaults.end);
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Reset to default week
                </Button>
              )}
              <div className="ml-auto">
                <Button onClick={run} disabled={busy || periodInvalid}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <FileBarChart2 className="h-4 w-4 mr-1.5" />
                  )}
                  Generate weekly status deck
                </Button>
              </div>
            </div>
            {periodInvalid && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Invalid period</AlertTitle>
                <AlertDescription>
                  Period start must be on or before period end.
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Only project managers and workspace/org admins can generate weekly status decks.
          </div>
        )}
      </CardContent>
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
    </Card>
  );
}
