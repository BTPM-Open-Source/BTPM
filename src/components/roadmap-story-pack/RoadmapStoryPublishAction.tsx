/**
 * Phase 6B.8d.1 — Shared Publish Story Presentation action.
 *
 * Extracted from `RoadmapStoryPublishedTab` so both the Preview tab
 * (shortcut) and Published tab (management area) can trigger publish
 * with identical behavior:
 *
 *   - Enable/disable gating from `useCurrentPublishSnapshot`.
 *   - Confirmation dialog with optional title override.
 *   - Publishes the exact reviewed `btpm_published_story_v1` snapshot
 *     produced by the deterministic + optional AI-overlay pipeline
 *     via `buildRenderedPublishedSnapshot`.
 *   - Success surface with "Open published Story" and "Copy link".
 *
 * The request never carries raw AI blueprint JSON or client-provided
 * project access scope; those are derived server-side.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Send,
  ShieldAlert,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCurrentPublishSnapshot } from "@/hooks/useCurrentPublishSnapshot";
import { usePublishRoadmapStoryPresentation } from "@/hooks/usePublishRoadmapStoryPresentation";
import type { PublishStoryPresentationResult } from "@/lib/roadmap-story/roadmapStoryPublishedPresentationTypes";

export interface RoadmapStoryPublishActionProps {
  storyPackId: string;
  isArchived: boolean;
  /** Visual variant of the trigger button. */
  variant?: "default" | "outline";
  /** Optional override for the trigger button label. */
  buttonLabel?: string;
  /** Optional extra hint shown to the left of the button when disabled. */
  showHint?: boolean;
}

export function publishedVersionUrl(versionId: string): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return `${origin}/story-presentations/${versionId}`;
}

export function RoadmapStoryPublishAction({
  storyPackId,
  isArchived,
  variant = "default",
  buttonLabel = "Publish Story Presentation",
  showHint = true,
}: RoadmapStoryPublishActionProps) {
  const snapshotState = useCurrentPublishSnapshot(storyPackId);
  const [open, setOpen] = useState(false);

  const disabled =
    isArchived || snapshotState.loading || !snapshotState.hasPreview;

  return (
    <div className="flex items-center gap-2">
      {showHint && (
        <PublishAvailabilityHint
          isArchived={isArchived}
          snapshotState={snapshotState}
        />
      )}
      <Button
        size="sm"
        variant={variant}
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="gap-1"
      >
        <Send className="h-3.5 w-3.5" />
        {buttonLabel}
      </Button>

      <PublishDialog
        open={open}
        onOpenChange={setOpen}
        storyPackId={storyPackId}
        snapshotState={snapshotState}
      />
    </div>
  );
}

function PublishAvailabilityHint({
  isArchived,
  snapshotState,
}: {
  isArchived: boolean;
  snapshotState: ReturnType<typeof useCurrentPublishSnapshot>;
}) {
  let text: string | null = null;
  if (isArchived) text = "Story is archived.";
  else if (snapshotState.loading) text = "Loading current Preview…";
  else if (!snapshotState.hasDraft)
    text = "Generate a Story Draft first.";
  else if (!snapshotState.hasPreview)
    text = "Preview cannot be rendered.";
  if (!text) return null;
  return <span className="text-[11px] text-muted-foreground">{text}</span>;
}

function PublishDialog({
  open,
  onOpenChange,
  storyPackId,
  snapshotState,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  storyPackId: string;
  snapshotState: ReturnType<typeof useCurrentPublishSnapshot>;
}) {
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<PublishStoryPresentationResult | null>(null);
  const publish = usePublishRoadmapStoryPresentation();

  const effectiveTitle = useMemo(
    () => (title.trim() ? title.trim() : snapshotState.defaultTitle),
    [title, snapshotState.defaultTitle],
  );

  const handleClose = (v: boolean) => {
    if (publish.isPending) return;
    onOpenChange(v);
    if (!v) {
      setTitle("");
      setResult(null);
      publish.reset();
    }
  };

  const handlePublish = () => {
    const snapshot = snapshotState.buildSnapshot(title.trim() || null);
    if (!snapshot) {
      toast({
        variant: "destructive",
        title: "Cannot publish",
        description: "The current Preview could not be rendered.",
      });
      return;
    }
    publish.mutate(
      {
        storyPackId,
        storyPackVersionId: snapshotState.storyPackVersionId,
        presentationBlueprintRunId: snapshotState.presentationBlueprintRunId,
        titleOverride: title.trim() || null,
        renderedPresentationSnapshot: snapshot,
      },
      {
        onSuccess: (r) => {
          setResult(r);
          toast({
            title: `Published Story v${r.versionNumber} created`,
            description: r.title,
          });
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Publish failed",
            description: (err as Error).message,
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish Story Presentation</DialogTitle>
          <DialogDescription>
            This creates a frozen published version of the current Story
            Preview. The link requires BTPM login. Viewers must have access
            to all source projects included in this Story. Published pages
            do not show prompts, source packages, raw AI responses, or
            blueprint/debug details.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="publish-title" className="text-xs">
                Title (optional)
              </Label>
              <Input
                id="publish-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={snapshotState.defaultTitle}
                maxLength={300}
                disabled={publish.isPending}
              />
              <p className="text-[11px] text-muted-foreground">
                Will publish as:{" "}
                <span className="font-medium">{effectiveTitle}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Badge
                variant="outline"
                className="text-[10px] border-[#516490]/40 text-[#516490] bg-white"
              >
                {snapshotState.sourceMode === "ai_blueprint"
                  ? "AI blueprint active"
                  : "Deterministic preview"}
              </Badge>
              <span>Server derives access scope from captured source projects.</span>
            </div>
          </div>
        ) : (
          <PublishSuccessBody result={result} />
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={publish.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handlePublish}
                disabled={publish.isPending || !snapshotState.hasPreview}
                className="gap-1"
              >
                {publish.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Publishing…
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" /> Publish
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button onClick={() => handleClose(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublishSuccessBody({ result }: { result: PublishStoryPresentationResult }) {
  const url = publishedVersionUrl(result.versionId);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not copy link",
        description: (err as Error).message,
      });
    }
  };
  return (
    <div className="space-y-3">
      <Alert className="border-emerald-500/40 bg-emerald-50">
        <CheckCircle2 className="h-4 w-4 text-emerald-700" />
        <AlertDescription className="text-[12px] text-emerald-900">
          Published as <strong>v{result.versionNumber}</strong> ·{" "}
          {result.sourceProjectCount} source project
          {result.sourceProjectCount === 1 ? "" : "s"}.
        </AlertDescription>
      </Alert>
      {result.warnings.length > 0 && (
        <Alert className="border-amber-500/50 bg-amber-50">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-[11px] text-amber-900 space-y-0.5">
            <div className="font-medium">Publish warnings</div>
            <ul className="list-disc list-inside">
              {result.warnings.map((w, i) => (
                <li key={i}>{friendlyWarning(w)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="default" className="gap-1">
          <Link to={`/story-presentations/${result.versionId}`}>
            <ExternalLink className="h-3.5 w-3.5" /> Open published Story
          </Link>
        </Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" /> Copy link
        </Button>
      </div>
    </div>
  );
}

function friendlyWarning(code: string): string {
  const map: Record<string, string> = {
    scope_config_fallback: "Source-project scope used fallback filters.",
    no_source_projects:
      "No source projects could be derived. This version is owner-only.",
    publisher_missing_project_access:
      "Some captured source projects were skipped because the publisher lacks access.",
  };
  return map[code] ?? code.replace(/_/g, " ");
}

/** Small helper for callsites that want a stand-alone tooltip-wrapped Open link. */
export function OpenPublishedVersionButton({ versionId }: { versionId: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild size="sm" variant="default" className="gap-1">
            <Link to={`/story-presentations/${versionId}`}>
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Open the published Story</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default RoadmapStoryPublishAction;
