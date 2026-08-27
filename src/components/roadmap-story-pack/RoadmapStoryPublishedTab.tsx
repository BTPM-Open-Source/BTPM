/**
 * Phase 6B.8d — Story Pack Published tab.
 * Phase 6B.8d.1 — publish trigger uses shared `RoadmapStoryPublishAction`;
 * the Preview tab uses the same component so behavior stays identical.
 *
 * Lists frozen Published Story Presentation versions for the current
 * Story Pack and lets the owner:
 *   - Publish the current reviewed Preview into a new immutable version
 *     (shared action; also available from the Preview tab).
 *   - Open an active version at `/story-presentations/:versionId`
 *     (authenticated BTPM route).
 *   - Copy an authenticated link (no public/token/anonymous sharing).
 *   - Archive an active version (disables the link, keeps the frozen
 *     snapshot; no delete).
 *
 * All reads/mutations flow through 6B.8a RPCs and the 6B.8b publish
 * Edge Function. No direct `.from()` access to any of the three
 * published-story tables from the frontend.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  Lock,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { toast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  usePublishedStoryVersions,
  useArchivePublishedStoryPresentationVersion,
} from "@/hooks/usePublishedStoryVersions";
import {
  RoadmapStoryPublishAction,
  publishedVersionUrl,
} from "./RoadmapStoryPublishAction";
import type { PublishedStoryPresentationVersionListItem } from "@/lib/roadmap-story/roadmapStoryPublishedPresentationTypes";

interface Props {
  storyPackId: string;
  isArchived: boolean;
}

export function RoadmapStoryPublishedTab({ storyPackId, isArchived }: Props) {
  const versions = usePublishedStoryVersions(storyPackId);

  return (
    <div className="space-y-5">
      <Alert className="border-[#E1E1DC] bg-white">
        <Info className="h-4 w-4 text-[#ED1C38]" />
        <AlertDescription className="text-[12px] text-[#1C1F3F]/80">
          Published Story Presentations are frozen versions of the reviewed
          Preview. Links require BTPM login, and viewers must have access to
          all source projects included in the Story. Publishing does not
          expose prompts, source packages, or blueprint internals.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#ED1C38]" />
            <span className="text-sm font-medium">Published versions</span>
            <Badge
              variant="outline"
              className="text-[10px] border-[#516490]/40 text-[#516490] bg-white"
            >
              Authenticated only
            </Badge>
          </div>
          <div className="ml-auto">
            <RoadmapStoryPublishAction
              storyPackId={storyPackId}
              isArchived={isArchived}
            />
          </div>
        </CardContent>
      </Card>

      <VersionList
        storyPackId={storyPackId}
        loading={versions.isLoading}
        error={versions.error as Error | null}
        rows={versions.data ?? []}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version list
// ---------------------------------------------------------------------------

function VersionList({
  storyPackId,
  loading,
  error,
  rows,
}: {
  storyPackId: string;
  loading: boolean;
  error: Error | null;
  rows: PublishedStoryPresentationVersionListItem[];
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading published versions…
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          Could not load published versions. {error.message}
        </CardContent>
      </Card>
    );
  }
  if (!rows.length) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No published Story Presentations yet. Publish the current Preview to
          create a frozen authenticated link.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <VersionRow key={row.versionId} storyPackId={storyPackId} row={row} />
      ))}
    </div>
  );
}

function VersionRow({
  storyPackId,
  row,
}: {
  storyPackId: string;
  row: PublishedStoryPresentationVersionListItem;
}) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archive = useArchivePublishedStoryPresentationVersion(storyPackId);

  const active = row.status === "active";
  const canOpen = active && row.viewerCanOpen !== false;

  const handleCopy = async () => {
    const url = publishedVersionUrl(row.versionId);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      toast({ title: "Link copied", description: url });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not copy link",
        description: (err as Error).message,
      });
    }
  };

  const handleArchive = () => {
    archive.mutate(row.versionId, {
      onSuccess: () => {
        toast({ title: `Version v${row.versionNumber} archived` });
        setArchiveOpen(false);
      },
      onError: (err) =>
        toast({
          variant: "destructive",
          title: "Archive failed",
          description: (err as Error).message,
        }),
    });
  };

  return (
    <Card>
      <CardContent className="py-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">v{row.versionNumber}</span>
            <span className="text-sm truncate">{row.title || "Untitled"}</span>
            {active ? (
              <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-700 bg-emerald-50">
                Active
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-[#516490]/40 text-[#516490] bg-muted/40">
                Archived
              </Badge>
            )}
            {active && row.viewerCanOpen === false && (
              <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700 bg-amber-50">
                Access limited
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Published {new Date(row.publishedAt).toLocaleString()} ·{" "}
            {row.sourceProjectCount} source project
            {row.sourceProjectCount === 1 ? "" : "s"}
            {row.archivedAt
              ? ` · archived ${new Date(row.archivedAt).toLocaleString()}`
              : ""}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <OpenAction
            versionId={row.versionId}
            enabled={canOpen}
            viewerCanOpen={row.viewerCanOpen !== false}
            active={active}
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={handleCopy}
            disabled={!active}
            title={active ? "Copy authenticated link" : "Archived versions cannot be shared"}
          >
            <Copy className="h-3.5 w-3.5" /> Copy link
          </Button>
          {active && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setArchiveOpen(true)}
            >
              <Archive className="h-3.5 w-3.5" /> Archive
            </Button>
          )}
        </div>

        <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive v{row.versionNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                Archiving disables this published Story link. The frozen version
                remains stored but cannot be opened.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={archive.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={archive.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  handleArchive();
                }}
              >
                {archive.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Archiving…
                  </>
                ) : (
                  "Archive"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function OpenAction({
  versionId,
  enabled,
  viewerCanOpen,
  active,
}: {
  versionId: string;
  enabled: boolean;
  viewerCanOpen: boolean;
  active: boolean;
}) {
  if (enabled) {
    return (
      <Button asChild size="sm" variant="default" className="gap-1">
        <Link to={`/story-presentations/${versionId}`}>
          <ExternalLink className="h-3.5 w-3.5" /> Open
        </Link>
      </Button>
    );
  }
  const tooltip = !active
    ? "Archived versions cannot be opened."
    : !viewerCanOpen
    ? "You do not currently have access to all source projects for this published Story."
    : "";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button size="sm" variant="outline" className="gap-1" disabled>
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default RoadmapStoryPublishedTab;
