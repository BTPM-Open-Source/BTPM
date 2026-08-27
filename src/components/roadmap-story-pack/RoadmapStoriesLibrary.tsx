/**
 * Phase 6B.8e — Roadmap Stories Library.
 *
 * User-facing "Stories" workspace under Roadmap:
 *   • My Stories: working Story containers the current user owns
 *     (backed by `roadmap_story_packs` via the existing controlled
 *     Story Pack RPCs). Users can Create, Continue, or jump to their
 *     latest active published version.
 *   • Published Stories: immutable Story Presentation versions the
 *     current user is allowed to open (any owner, all-source-projects
 *     access rule enforced server-side).
 *
 * Selecting "Continue" opens the existing four-tab detail interface
 * (Define / Story Draft / Preview / Published) via
 * `RoadmapStoryPackConfigure` — no parallel schema, no duplicate
 * publish/create logic.
 *
 * Access model unchanged:
 *   - No public/anonymous links.
 *   - No manual viewer lists.
 *   - No workspace-level sharing controls.
 *   - No export/PPT/PDF.
 *   - All reads via controlled RPCs; no direct `.from(...)` to Story
 *     Pack or Published Story tables.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  useCreateRoadmapStoryPack,
  useRoadmapStoryPackConfig,
  useRoadmapStoryPacks,
} from "@/hooks/useRoadmapStoryPacks";
import { usePublishedStoryVersions } from "@/hooks/usePublishedStoryVersions";
import { useAccessibleRoadmapStoryPublishedVersions } from "@/hooks/useAccessibleRoadmapStoryPublishedVersions";
import { useLatestAiPresentationBlueprint } from "@/hooks/useRoadmapStoryPresentationBlueprint";
import {
  setRoadmapStoryPackSources,
  type RoadmapStoryPackSummary,
} from "@/lib/roadmapStoryPackService";
import { DEFAULT_DISABLED_ROADMAP_STORY_SOURCE_CATEGORIES } from "@/lib/roadmap-story/roadmapStoryDefaults";
import { RoadmapStoryPackConfigure } from "./RoadmapStoryPackConfigure";
import { publishedVersionUrl } from "./RoadmapStoryPublishAction";

export interface RoadmapStoriesLibraryProps {
  /** Live snapshot of current Roadmap filter state — captured into scope_config on create. */
  filters?: Record<string, unknown>;
}

export function RoadmapStoriesLibrary({ filters }: RoadmapStoriesLibraryProps) {
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);

  if (selectedStoryId) {
    return (
      <StoryDetailView
        storyPackId={selectedStoryId}
        onBack={() => setSelectedStoryId(null)}
        filters={filters}
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#ED1C38]" /> Stories
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Create and manage roadmap Stories, from source definition through
          published presentations.
        </p>
      </header>

      <Tabs defaultValue="mine" className="w-full">
        <TabsList>
          <TabsTrigger value="mine">My Stories</TabsTrigger>
          <TabsTrigger value="published">Published Stories</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          <MyStoriesLens
            filters={filters}
            onOpen={(id) => setSelectedStoryId(id)}
          />
        </TabsContent>

        <TabsContent value="published" className="mt-4">
          <PublishedStoriesLens />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view — reuses the existing Story Pack Configure interface
// ---------------------------------------------------------------------------

function StoryDetailView({
  storyPackId,
  onBack,
  filters,
}: {
  storyPackId: string;
  onBack: () => void;
  filters?: Record<string, unknown>;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Stories
        </Button>
      </div>
      {/*
        RoadmapStoryPackConfigure hosts the full Define / Story Draft /
        Preview / Published four-tab detail interface. It seeds itself
        with the selected Story Pack via its internal state; we pass the
        initial selection down via the `initialStoryPackId` prop.
      */}
      <RoadmapStoryPackConfigure
        filters={filters}
        initialStoryPackId={storyPackId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Stories lens
// ---------------------------------------------------------------------------

function MyStoriesLens({
  filters,
  onOpen,
}: {
  filters?: Record<string, unknown>;
  onOpen: (id: string) => void;
}) {
  const list = useRoadmapStoryPacks(true);
  const create = useCreateRoadmapStoryPack();
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = list.data ?? [];
    if (!q) return items;
    return items.filter((p) =>
      (p.title ?? "Untitled Story").toLowerCase().includes(q),
    );
  }, [list.data, query]);

  const handleCreate = async () => {
    try {
      const id = await create.mutateAsync({
        title: newTitle.trim() || null,
        scopeConfig: {
          roadmap_filters: filters ?? null,
          captured_at: new Date().toISOString(),
        },
      });
      // Phase 6B.8e.1 — apply the same default-disabled source categories
      // as the Configure create path. Non-fatal on failure.
      try {
        await setRoadmapStoryPackSources(
          id,
          DEFAULT_DISABLED_ROADMAP_STORY_SOURCE_CATEGORIES.map((c) => ({
            source_category: c,
            is_enabled: false,
          })),
        );
      } catch {
        /* non-fatal */
      }
      setNewTitle("");
      toast({ title: "Story created" });
      onOpen(id);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Could not create Story",
        description: e?.message,
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px] space-y-1">
            <label className="text-xs text-muted-foreground">
              Create a new Story
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Story title (optional)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                disabled={create.isPending}
              />
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={create.isPending}
                className="gap-1.5"
              >
                {create.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Create Story
              </Button>
            </div>
          </div>
          <div className="flex-1 min-w-[220px] space-y-1">
            <label className="text-xs text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search your Stories"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {list.isLoading ? (
        <Card>
          <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your Stories…
          </CardContent>
        </Card>
      ) : list.error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Could not load Stories. {(list.error as Error).message}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground text-center">
            No Stories yet. Create a Story to define sources, generate a
            narrative, preview it, and publish a frozen presentation.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <MyStoryRow key={row.id} pack={row} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function MyStoryRow({
  pack,
  onOpen,
}: {
  pack: RoadmapStoryPackSummary;
  onOpen: (id: string) => void;
}) {
  // Per-pack lookups — bounded by the user's own Story list. Each row uses
  // safe RPC-backed hooks; no raw table reads, no _encrypted fields, no
  // debug/prompt payloads. Blueprint + config are lazily fetched by React
  // Query and stay cached across rerenders.
  const versions = usePublishedStoryVersions(pack.id);
  const config = useRoadmapStoryPackConfig(pack.id);
  const blueprint = useLatestAiPresentationBlueprint(pack.id);

  const activeVersion = useMemo(
    () => (versions.data ?? []).find((v) => v.status === "active") ?? null,
    [versions.data],
  );

  const stage: StoryStage = useMemo(() => {
    if (pack.status === "archived") return "Archived";
    if (activeVersion) return "Published";
    if (blueprint.data?.blueprint) return "Preview ready";
    const versionCount = config.data?.versions?.length ?? 0;
    if (versionCount > 0) return "Draft generated";
    const enabledSources = (config.data?.sources ?? []).some((s) => s.is_enabled);
    const hasNotes = (config.data?.notes ?? []).length > 0;
    const hasFiles = (config.data?.external_files ?? []).length > 0;
    const hasScope =
      !!pack.audience || !!pack.focus ||
      !!(config.data?.pack?.guidance ?? null);
    if (enabledSources || hasNotes || hasFiles || hasScope) return "Defining";
    return "New";
  }, [pack.status, pack.audience, pack.focus, activeVersion, blueprint.data, config.data]);

  return (
    <Card>
      <CardContent className="py-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">
              {pack.title || "Untitled Story"}
            </span>
            <StageBadge stage={stage} />
            {pack.audience && (
              <Badge
                variant="outline"
                className="text-[10px] border-[#516490]/40 text-[#516490] bg-white"
              >
                {pack.audience}
              </Badge>
            )}
            {pack.focus && (
              <Badge
                variant="outline"
                className="text-[10px] border-[#516490]/40 text-[#516490] bg-white"
              >
                {pack.focus}
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Updated {new Date(pack.updated_at).toLocaleString()}</span>
            {activeVersion && (
              <span>
                Latest published: v{activeVersion.versionNumber} ·{" "}
                {new Date(activeVersion.publishedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {activeVersion && (
            <Button asChild size="sm" variant="outline" className="gap-1">
              <Link to={`/story-presentations/${activeVersion.versionId}`}>
                <ExternalLink className="h-3.5 w-3.5" /> Latest published
              </Link>
            </Button>
          )}
          <Button size="sm" onClick={() => onOpen(pack.id)} className="gap-1">
            Continue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type StoryStage =
  | "New"
  | "Defining"
  | "Draft generated"
  | "Preview ready"
  | "Published"
  | "Archived";

function StageBadge({ stage }: { stage: StoryStage }) {
  const tone: Record<StoryStage, string> = {
    New: "border-[#516490]/40 text-[#516490] bg-white",
    Defining: "border-[#516490]/40 text-[#516490] bg-white",
    "Draft generated": "border-sky-500 text-sky-700 bg-sky-50",
    "Preview ready": "border-[#1C1F3F]/40 text-[#1C1F3F] bg-[#EDEEF6]",
    Published: "border-emerald-500 text-emerald-700 bg-emerald-50",
    Archived: "border-amber-500 text-amber-700 bg-amber-50",
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${tone[stage]}`}>
      {stage}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Published Stories lens
// ---------------------------------------------------------------------------

function PublishedStoriesLens() {
  const [query, setQuery] = useState("");
  const list = useAccessibleRoadmapStoryPublishedVersions(query || null);

  return (
    <div className="space-y-4">
      <Alert className="border-[#E1E1DC] bg-white">
        <Lock className="h-4 w-4 text-[#ED1C38]" />
        <AlertDescription className="text-[12px] text-[#1C1F3F]/80">
          These are frozen published Story Presentations. Links require BTPM
          login, and you must have access to every source project included in
          a Story to open it.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="py-3 flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search published Stories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 shadow-none focus-visible:ring-0 h-8"
          />
        </CardContent>
      </Card>

      {list.isLoading ? (
        <Card>
          <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading published Stories…
          </CardContent>
        </Card>
      ) : list.error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Could not load published Stories. {(list.error as Error).message}
          </CardContent>
        </Card>
      ) : !list.data?.length ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground text-center">
            No published Stories are available to you yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.data.map((row) => (
            <PublishedStoryRow key={row.versionId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function PublishedStoryRow({
  row,
}: {
  row: ReturnType<typeof useAccessibleRoadmapStoryPublishedVersions>["data"] extends
    | (infer R)[]
    | undefined
    ? R
    : never;
}) {
  const handleCopy = async () => {
    const url = publishedVersionUrl(row.versionId);
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
    <Card>
      <CardContent className="py-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">v{row.versionNumber}</span>
            <span className="text-sm truncate">
              {row.title || "Untitled Story"}
            </span>
            <Badge
              variant="outline"
              className="text-[10px] border-emerald-500 text-emerald-700 bg-emerald-50"
            >
              Active
            </Badge>
            {row.isOwner && (
              <Badge
                variant="outline"
                className="text-[10px] border-[#516490]/40 text-[#516490] bg-white"
              >
                You published
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Published {new Date(row.publishedAt).toLocaleString()} ·{" "}
            {row.sourceProjectCount} source project
            {row.sourceProjectCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild size="sm" className="gap-1">
            <Link to={`/story-presentations/${row.versionId}`}>
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </Link>
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5" /> Copy link
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default RoadmapStoriesLibrary;
