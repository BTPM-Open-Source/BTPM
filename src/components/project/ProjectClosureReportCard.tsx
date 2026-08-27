// Phase 6C.FILE-R1a — Project Closure Report document card.
//
// Mirrors ProjectCharterCard: the generated .docx is published into the
// project's linked SharePoint folder by the Edge Function, and the
// SharePoint URL is stored in generated_operational_documents. The card
// offers Open existing / Regenerate (with confirmation) — no browser
// download primary path.
//
// The card never inserts generated-document history rows directly; the
// Edge Function records history via record_generated_operational_document.
// Generation is a snapshot only: it does NOT close the project, does NOT
// change project status/stage, and does NOT mutate any source data.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExternalLink, FileDown, FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useLatestProjectClosureReport } from "@/hooks/useLatestProjectClosureReport";
import { generateProjectClosureReport } from "@/lib/projectClosureReportService";

interface Props {
  projectId: string;
  canGenerate: boolean;
}

export function ProjectClosureReportCard({ projectId, canGenerate }: Props) {
  const qc = useQueryClient();
  const {
    data: latest,
    isLoading,
    isError,
  } = useLatestProjectClosureReport(projectId);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasExisting =
    !!latest && latest.sharepoint_publish_status === "published";
  const openUrl = latest?.sharepoint_web_url ?? null;

  const runGenerate = async () => {
    setBusy(true);
    try {
      const result = await generateProjectClosureReport(projectId);
      await qc.invalidateQueries({
        queryKey: ["generated-operational-docs", projectId],
      });
      toast({
        title: hasExisting
          ? "Project Closure Report regenerated"
          : "Project Closure Report generated",
        description: `${result.filename} is now in the linked SharePoint folder.`,
        action: result.sharepointWebUrl
          ? (
            <button
              type="button"
              onClick={() =>
                window.open(
                  result.sharepointWebUrl!,
                  "_blank",
                  "noopener,noreferrer",
                )}
              className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in SharePoint
            </button>
          )
          : undefined,
      });
    } catch (e: unknown) {
      const message = e && typeof e === "object" && "message" in e
        ? String((e as { message: unknown }).message)
        : "Could not generate the Project Closure Report.";
      toast({
        title: "Could not generate Project Closure Report",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onPrimaryClick = () => {
    if (hasExisting) setConfirmOpen(true);
    else void runGenerate();
  };

  // Hide the card when the user can neither generate nor see anything useful.
  if (!canGenerate && !hasExisting && !isLoading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Project Closure Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hasExisting ? (
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Available</Badge>
              <span className="text-muted-foreground text-xs">
                {latest!.sharepoint_publish_status ?? "unknown"}
              </span>
            </div>
            <div className="font-medium text-foreground break-all">
              {latest!.output_filename}
            </div>
            <div className="text-muted-foreground text-xs">
              Last generated {new Date(latest!.generated_at).toLocaleString()}
              {latest!.generated_by_name
                ? ` by ${latest!.generated_by_name}`
                : ""}
            </div>
            <p className="text-muted-foreground text-xs pt-1">
              This is a generated snapshot. Regenerating creates a new report
              from current project data and publishes it to the project
              SharePoint folder. Generating this report does not close the
              project.
            </p>
          </div>
        ) : (
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline">Not generated</Badge>
            </div>
            <p className="text-muted-foreground">
              Generate a standardized closure report from current project
              data. The report is a snapshot and does not close the project.
            </p>
            {!canGenerate && (
              <p className="text-muted-foreground text-xs">
                No closure report has been generated yet.
              </p>
            )}
          </div>
        )}

        {isError && (
          <p className="text-xs text-destructive">
            Could not load the latest closure report history.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {hasExisting && openUrl && (
            <Button
              variant="default"
              size="sm"
              onClick={() =>
                window.open(openUrl, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              Open existing
            </Button>
          )}
          {canGenerate && (
            <Button
              variant={hasExisting ? "outline" : "default"}
              size="sm"
              onClick={onPrimaryClick}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : hasExisting ? (
                <RefreshCw className="h-4 w-4 mr-1" />
              ) : (
                <FileDown className="h-4 w-4 mr-1" />
              )}
              {hasExisting ? "Regenerate" : "Generate Closure Report"}
            </Button>
          )}
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate Project Closure Report?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new closure report snapshot using current
              project data and publish it to the project SharePoint folder.
              Existing generated document history will remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            {openUrl && (
              <Button
                variant="outline"
                onClick={() =>
                  window.open(openUrl, "_blank", "noopener,noreferrer")}
                disabled={busy}
              >
                <ExternalLink className="h-4 w-4 mr-1" /> Open existing file
              </Button>
            )}
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConfirmOpen(false);
                void runGenerate();
              }}
              disabled={busy}
            >
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
