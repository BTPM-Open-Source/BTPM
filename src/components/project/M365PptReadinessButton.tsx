// Diagnostic-only entry point for the M365 PPT readiness check.
// Visible only to users with project planning authority. NOT the final
// Generate PPT feature — this only proves the Graph + SharePoint pipeline.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2, Wand2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { runM365PptReadinessCheck, PPT_READINESS_UNAVAILABLE_MESSAGE } from "@/lib/m365PptReadinessService";
import { generatedFileUserMessage } from "@/lib/generatedFileErrorMessages";


interface Props {
  projectId: string;
  canRun: boolean;
}

export function M365PptReadinessButton({ projectId, canRun }: Props) {
  const [busy, setBusy] = useState(false);
  if (!canRun) return null;

  const run = async () => {
    setBusy(true);
    try {
      const result = await runM365PptReadinessCheck(projectId);
      if (result.ok && result.sharepoint_web_url) {
        toast({
          title: "PPT readiness check passed",
          description: `${result.filename} uploaded to the linked SharePoint folder.`,
          action: (
            <button
              type="button"
              onClick={() => window.open(result.sharepoint_web_url!, "_blank", "noopener,noreferrer")}
              className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in SharePoint
            </button>
          ),
        });
      } else {
        const stages = result.stages
          ? Object.entries(result.stages)
              .filter(([, v]) => !v)
              .map(([k]) => k)
              .join(", ") || "none"
          : "unknown";
        const safeMessage = generatedFileUserMessage({
          code: result.error ?? null,
          note: result.note ?? null,
        });
        toast({
          title: "PPT readiness check failed",
          description: `${safeMessage} (failed stages: ${stages})`,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "PPT readiness check error",
        description: PPT_READINESS_UNAVAILABLE_MESSAGE,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
      Run PPT readiness check
    </Button>
  );
}
