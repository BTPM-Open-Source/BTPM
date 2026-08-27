// Reusable recovery UX shown when publishing a regenerated Office file
// fails because the existing SharePoint/Office file is open or locked.
// Used by: Project Charter, Project Status Deck, Roadmap Status Deck.

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
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** Optional URL of the latest published SharePoint file (Open existing). */
  existingFileUrl?: string | null;
  /** Called when the user clicks Try again. */
  onRetry: () => void;
  /** Disable actions while a retry is in flight. */
  busy?: boolean;
}

export function GeneratedFilePublishIssueDialog({
  open,
  onOpenChange,
  title = "File is open or locked in SharePoint",
  existingFileUrl,
  onRetry,
  busy,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                BTPM could not replace the existing generated file because it is
                currently open or locked in SharePoint/Office.
              </p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Close the file in PowerPoint, Word, or the browser editor.</li>
                <li>Wait about a minute for Microsoft 365 to release the lock.</li>
                <li>Then try again.</li>
              </ol>
              <p className="text-muted-foreground">
                BTPM data was not changed and the existing file was not replaced.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Close</AlertDialogCancel>
          {existingFileUrl && (
            <Button
              variant="outline"
              onClick={() =>
                window.open(existingFileUrl, "_blank", "noopener,noreferrer")
              }
              disabled={busy}
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              Open existing file
            </Button>
          )}
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onRetry();
            }}
            disabled={busy}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Try again
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
