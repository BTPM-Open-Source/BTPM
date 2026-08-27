// 4D.1 — Project Charter document card.
// Shows the latest generated Project Charter (if any), with Open + Regenerate
// actions. Regeneration when an existing successful charter is present
// requires explicit confirmation; the backend also enforces an overwrite
// guard so the UI cannot be bypassed.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { generateProjectCharter } from "@/lib/generatedDocService";
import { useLatestProjectCharter } from "@/hooks/useLatestProjectCharter";
import { isFileLockedCode } from "@/lib/generatedFileErrorMessages";
import { GeneratedFilePublishIssueDialog } from "@/components/generated-docs/GeneratedFilePublishIssueDialog";

interface Props {
  projectId: string;
  canGenerate: boolean;
}

export function ProjectCharterCard({ projectId, canGenerate }: Props) {
  const qc = useQueryClient();
  const { data: latest, isLoading } = useLatestProjectCharter(projectId);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lockedDialogOpen, setLockedDialogOpen] = useState(false);

  const hasExisting =
    !!latest && latest.sharepoint_publish_status === "published";
  const openUrl = latest?.sharepoint_web_url ?? null;

  const runGenerate = async (overwriteExisting: boolean) => {
    setBusy(true);
    try {
      const result = await generateProjectCharter(projectId, { overwriteExisting });
      await qc.invalidateQueries({
        queryKey: ["generated-operational-docs", projectId],
      });
      toast({
        title: hasExisting ? "Project Charter regenerated" : "Project Charter generated",
        description: `${result.filename} is now in the linked SharePoint folder.`,
        action: result.sharepointWebUrl
          ? (
            <button
              type="button"
              onClick={() =>
                window.open(result.sharepointWebUrl!, "_blank", "noopener,noreferrer")
              }
              className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in SharePoint
            </button>
          )
          : undefined,
      });
    } catch (e: unknown) {
      const code =
        e && typeof e === "object" && "code" in e
          ? String((e as { code: unknown }).code)
          : null;
      if (isFileLockedCode(code)) {
        setLockedDialogOpen(true);
      } else {
        const message =
          e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : "Could not generate the Project Charter.";
        toast({
          title: "Could not generate Project Charter",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const onPrimaryClick = () => {
    if (hasExisting) {
      setConfirmOpen(true);
    } else {
      void runGenerate(false);
    }
  };

  // Card is hidden if user cannot generate AND no existing document exists
  if (!canGenerate && !hasExisting) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Project Charter document
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hasExisting ? (
          <div className="space-y-1 text-sm">
            <div className="font-medium text-foreground break-all">
              {latest!.output_filename}
            </div>
            <div className="text-muted-foreground text-xs">
              Project Overview / Charter · last generated{" "}
              {new Date(latest!.generated_at).toLocaleString()}
              {latest!.generated_by_name ? ` by ${latest!.generated_by_name}` : ""}
            </div>
            <div className="text-muted-foreground text-xs">
              Status: {latest!.sharepoint_publish_status ?? "unknown"}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Project Charter has been generated yet.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {hasExisting && openUrl && (
            <Button
              variant="default"
              size="sm"
              onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}
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
              {hasExisting ? "Regenerate" : "Generate Project Overview / Charter"}
            </Button>
          )}
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate Project Charter?</AlertDialogTitle>
            <AlertDialogDescription>
              A Project Charter has already been generated for this project.
              Regenerating will overwrite the current generated file with a new
              version based on current BTPM data. You can open the existing
              file for review instead. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            {openUrl && (
              <Button
                variant="outline"
                onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}
                disabled={busy}
              >
                <ExternalLink className="h-4 w-4 mr-1" /> Open existing file
              </Button>
            )}
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConfirmOpen(false);
                void runGenerate(true);
              }}
              disabled={busy}
            >
              Regenerate and overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <GeneratedFilePublishIssueDialog
        open={lockedDialogOpen}
        onOpenChange={setLockedDialogOpen}
        existingFileUrl={openUrl}
        busy={busy}
        onRetry={() => {
          setLockedDialogOpen(false);
          void runGenerate(hasExisting);
        }}
      />
    </Card>
  );
}
