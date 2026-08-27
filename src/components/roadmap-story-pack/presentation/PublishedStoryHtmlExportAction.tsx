/**
 * Phase 6B.8g — Published Story HTML export action.
 *
 * Renders a header button on the authenticated Published Story viewer
 * that lets the user download a standalone offline `.html` copy of the
 * frozen presentation. Shows an explicit warning dialog first so the
 * user understands the export is NOT access-controlled by BTPM.
 *
 * All work happens in the browser against the already-authorized DOM;
 * no server call, no secrets, no source-package / prompt / raw-AI /
 * debug payload is ever included in the export.
 */

import { useState } from "react";
import { Download } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  HTML_EXPORT_ROOT_ATTR,
  buildExportFilename,
  buildStandaloneHtml,
  downloadHtmlFile,
} from "@/lib/roadmap-story/roadmapStoryHtmlExport";

export interface PublishedStoryHtmlExportActionProps {
  title: string;
  subtitle?: string | null;
  versionId: string;
  versionNumber?: number | null;
  publishedAtLabel?: string | null;
}

export function PublishedStoryHtmlExportAction({
  title,
  subtitle,
  versionId,
  versionNumber,
  publishedAtLabel,
}: PublishedStoryHtmlExportActionProps) {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleExport = () => {
    setBusy(true);
    try {
      const root = document.querySelector<HTMLElement>(`[${HTML_EXPORT_ROOT_ATTR}]`);
      if (!root) {
        toast({
          title: "Export failed",
          description: "Story content is not ready yet. Try again in a moment.",
          variant: "destructive",
        });
        return;
      }
      const html = buildStandaloneHtml({
        title,
        subtitle: subtitle ?? null,
        versionNumber: versionNumber ?? null,
        publishedAtLabel: publishedAtLabel ?? null,
        exportRoot: root,
      });
      const filename = buildExportFilename({
        versionId,
        versionNumber: versionNumber ?? null,
        title,
      });
      downloadHtmlFile(filename, html);
      toast({
        title: "Export ready",
        description: "Standalone HTML copy downloaded.",
      });
      setOpen(false);
      setAcknowledged(false);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-8 gap-1.5 border-[#1C1F3F]/25 bg-white text-[12px] text-[#1C1F3F] hover:bg-[#F1F1EC]"
        title="Download a standalone offline HTML copy of this published Story."
        aria-label="Export standalone HTML copy of this published Story"
      >
        <Download className="h-3.5 w-3.5" />
        Export HTML
      </Button>
      <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setAcknowledged(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Export standalone HTML</AlertDialogTitle>
            <AlertDialogDescription>
              This downloads an offline copy of the published Story. The file
              can be opened without BTPM login, and anyone who receives the
              file can view the Story content. Links back to BTPM objects may
              still require normal BTPM access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 text-[12px] text-[#1C1F3F] cursor-pointer">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              className="mt-0.5"
            />
            <span>I understand this exported file is not access-controlled by BTPM.</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleExport(); }}
              disabled={!acknowledged || busy}
            >
              {busy ? "Exporting…" : "Export HTML"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
