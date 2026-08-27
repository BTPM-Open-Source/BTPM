/**
 * Phase 6B.4 / 6B.4a — Roadmap Story Pack Configure UI.
 *
 * 6B.4a polishes the Configure UI into a guided story-building flow:
 *   1. Define the story    2. Choose source material    3. Add extra context
 *   4. Review readiness    5. Generate Story Draft (active)
 *
 * All reads/writes still go through the controlled Story Pack RPC layer in
 * `roadmapStoryPackService` / `useRoadmapStoryPacks`. No AI generation,
 * Story renderer, sharing, SharePoint content ingestion, or exports.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  useAddRoadmapStoryPackExternalFile,
  useAddRoadmapStoryPackNote,
  useArchiveRoadmapStoryPack,
  useCreateRoadmapStoryPack,
  useDeleteRoadmapStoryPackNote,
  useRemoveRoadmapStoryPackExternalFile,
  useRoadmapStoryPackConfig,
  useRoadmapStoryPacks,
  useSetRoadmapStoryPackSources,
  useUnarchiveRoadmapStoryPack,
  useUpdateRoadmapStoryPackConfig,
  useUpdateRoadmapStoryPackExternalFile,
  useUpdateRoadmapStoryPackNote,
} from "@/hooks/useRoadmapStoryPacks";
import {
  setRoadmapStoryPackSources,
  type RoadmapStorySourceCategory,
} from "@/lib/roadmapStoryPackService";
import { RoadmapStoryPackSharePointFilePickerDialog } from "@/components/roadmap-story-pack/RoadmapStoryPackSharePointFilePickerDialog";
import { RoadmapStorySourcePackagePreview } from "@/components/roadmap-story-pack/RoadmapStorySourcePackagePreview";
import { RoadmapStoryDraftSection } from "@/components/roadmap-story-pack/RoadmapStoryDraftSection";
import { RoadmapStoryPreviewTab } from "@/components/roadmap-story-pack/RoadmapStoryPreviewTab";
import { RoadmapStoryPublishedTab } from "@/components/roadmap-story-pack/RoadmapStoryPublishedTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoadmapStoryLatestVersion } from "@/hooks/useRoadmapStoryGeneration";

// ---- Vocabulary ----------------------------------------------------------

const AUDIENCE_OPTIONS = [
  "Steering Committee",
  "Executive",
  "PMO",
  "Project Team",
  "General",
] as const;

const FOCUS_OPTIONS = [
  "General update",
  "Risks & blockers",
  "Timeline movement",
  "Progress since last period",
  "Decisions / asks",
  "Executive narrative",
] as const;

interface SourceMeta {
  label: string;
  description: string;
  futureSource: boolean;
}

const SOURCE_LABELS: Record<RoadmapStorySourceCategory, SourceMeta> = {
  program_project_overview: { label: "Program and project context", description: "Workspace, program, and project headers in scope.", futureSource: false },
  planning_phases_tasks:    { label: "Planning, phases, and tasks", description: "Phase and task structure, status, dates, and overdue indicators from selected projects.", futureSource: false },
  progress_updates:         { label: "Progress updates",            description: "Dated execution updates for in-scope projects.",    futureSource: false },
  activity_history:         { label: "Activity history",            description: "Recent activity events across scope.",              futureSource: false },
  discussions_comments:     { label: "Discussions and comments",    description: "Not connected yet — BTPM exposes comments only per object; a roadmap-scope authorized aggregator is needed before discussions can feed the Story source package.", futureSource: true  },
  risks:                    { label: "Risks",                       description: "Open risks in scope.",                              futureSource: false },
  blockers:                 { label: "Blockers",                    description: "Open blockers in scope.",                           futureSource: false },
  dependencies:             { label: "Dependencies",                description: "Cross-object dependency relationships.",            futureSource: false },
  kpis_snapshots:           { label: "KPIs and snapshots",          description: "KPI definitions, latest snapshots, updates.",      futureSource: false },
  governance_decisions:     { label: "Governance and decisions",    description: "Governance records, decisions, asks, evidence.",   futureSource: false },
  team_work:                { label: "Team work",                   description: "Team Work / My Work assignments and load.",        futureSource: false },
  documents_metadata:       { label: "Linked document metadata",    description: "Linked SharePoint file metadata is included in the source package; files marked included may also be read server-side during generation, subject to type/size limits.", futureSource: false },
  external_context:         { label: "Extra user context",          description: "Your linked files and additional context notes.", futureSource: false },
};

interface SourceGroup {
  id: string;
  title: string;
  description: string;
  categories: RoadmapStorySourceCategory[];
}

const SOURCE_GROUPS: SourceGroup[] = [
  {
    id: "core",
    title: "A · Core story context",
    description: "Foundational program, project, and plan structure.",
    categories: ["program_project_overview", "planning_phases_tasks"],
  },
  {
    id: "changes",
    title: "B · What changed",
    description: "Recent movement and progress signals.",
    categories: ["progress_updates", "activity_history"],
  },
  {
    id: "attention",
    title: "C · Attention and decisions",
    description: "Issues, dependencies, performance, and governance.",
    categories: ["risks", "blockers", "dependencies", "kpis_snapshots", "governance_decisions"],
  },
  {
    id: "execution",
    title: "D · Work execution",
    description: "How the team is currently delivering.",
    categories: ["team_work"],
  },
  {
    id: "extra",
    title: "E · Extra context",
    description: "Optional supporting material and your own context.",
    categories: ["discussions_comments", "documents_metadata", "external_context"],
  },
];

// Default-disabled categories at creation — shared with Stories Library.
import { DEFAULT_DISABLED_ROADMAP_STORY_SOURCE_CATEGORIES } from "@/lib/roadmap-story/roadmapStoryDefaults";
const DEFAULT_DISABLED_ON_CREATE: RoadmapStorySourceCategory[] =
  DEFAULT_DISABLED_ROADMAP_STORY_SOURCE_CATEGORIES;

// ---- Top-level -----------------------------------------------------------

export interface RoadmapStoryPackConfigureProps {
  /** Live snapshot of current Roadmap filter state — captured into scope_config on create. */
  filters?: Record<string, unknown>;
  /** Optional preselected Story Pack id (Phase 6B.8e — Stories Library entry point). */
  initialStoryPackId?: string | null;
}

export function RoadmapStoryPackConfigure({
  filters,
  initialStoryPackId = null,
}: RoadmapStoryPackConfigureProps) {
  const list = useRoadmapStoryPacks(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialStoryPackId);

  useEffect(() => {
    if (initialStoryPackId) {
      setSelectedId(initialStoryPackId);
      return;
    }
    if (selectedId || !list.data) return;
    const firstDraft = list.data.find((p) => p.status === "draft") ?? list.data[0];
    if (firstDraft) setSelectedId(firstDraft.id);
  }, [list.data, selectedId, initialStoryPackId]);

  const createPack = useCreateRoadmapStoryPack();
  const [newTitle, setNewTitle] = useState("");

  const handleCreate = async () => {
    try {
      const id = await createPack.mutateAsync({
        title: newTitle.trim() || null,
        scopeConfig: { roadmap_filters: filters ?? null, captured_at: new Date().toISOString() },
      });
      // Best-effort default: disable future-only source categories on a new pack.
      // Failure here is non-fatal — user can always toggle later.
      try {
        await setRoadmapStoryPackSources(
          id,
          DEFAULT_DISABLED_ON_CREATE.map((c) => ({ source_category: c, is_enabled: false })),
        );
      } catch {
        /* non-fatal */
      }
      setSelectedId(id);
      setNewTitle("");
      toast({ title: "Story Pack created" });
    } catch (e: any) {
      toast({ title: "Could not create Story Pack", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="font-medium text-foreground">Mode:</span> Configure
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            Story Draft generation is active. AI-selected Presentation Blueprint is a future step.
          </span>
        </div>
        <h2 className="text-xl font-bold text-foreground">Roadmap Story Pack</h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Build a Story Pack by setting what the story is about, picking which material the Story
          Draft should consider, and adding any extra context. Story Draft generation is active —
          the upcoming AI-selected Presentation Blueprint is a future step on top of it.
        </p>
      </div>

      {/* Step 1 — Select or create */}
      <StepCard
        index={1}
        title="Define the story"
        subtitle="Pick an existing draft, or create a new Story Pack that captures the current Roadmap scope."
      >
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[240px] space-y-1">
            <Label className="text-xs">Your Story Packs</Label>
            <Select
              value={selectedId ?? ""}
              onValueChange={(v) => setSelectedId(v || null)}
              disabled={list.isLoading || !(list.data?.length)}
            >
              <SelectTrigger>
                <SelectValue placeholder={list.isLoading ? "Loading…" : "None yet — create one"} />
              </SelectTrigger>
              <SelectContent>
                {(list.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p.title || "Untitled Story Pack")}
                    {p.status === "archived" ? " (archived)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[240px] space-y-1">
            <Label className="text-xs">Start a new Story Pack draft</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Story Pack title (optional)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <Button onClick={handleCreate} disabled={createPack.isPending} size="sm" className="gap-1.5">
                {createPack.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Create draft
              </Button>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          A new Story Pack captures your current Roadmap filter selection as its scope. Only your own
          Story Packs are listed.
        </p>
      </StepCard>

      {selectedId ? (
        <StoryPackEditor storyPackId={selectedId} filters={filters} />
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Select or create a Story Pack above to continue.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Reusable step shell -------------------------------------------------

function StepCard({
  index,
  title,
  subtitle,
  right,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                {index}
              </span>
              <CardTitle className="text-sm">{title}</CardTitle>
            </div>
            {subtitle && <p className="text-[12px] text-muted-foreground pl-7">{subtitle}</p>}
          </div>
          {right}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

// =========================================================================
// Editor for a single Story Pack
// =========================================================================
function StoryPackEditor({
  storyPackId,
  filters,
}: {
  storyPackId: string;
  filters?: Record<string, unknown>;
}) {
  const cfg = useRoadmapStoryPackConfig(storyPackId);

  if (cfg.isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Story Pack…
        </CardContent>
      </Card>
    );
  }
  if (cfg.error || !cfg.data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          Could not load Story Pack. {(cfg.error as Error | undefined)?.message}
        </CardContent>
      </Card>
    );
  }

  const isArchived = cfg.data.pack.status === "archived";

  return (
    <div className="space-y-5">
      {isArchived && <ArchivedBanner storyPackId={storyPackId} />}
      <StoryPackWorkflowTabs storyPackId={storyPackId} isArchived={isArchived} filters={filters} cfg={cfg.data} />
      {!isArchived && <ArchiveControls storyPackId={storyPackId} archived={false} />}
    </div>
  );
}

// ---- 6B.7a.2 — Workflow tabs --------------------------------------------
function StoryPackWorkflowTabs({
  storyPackId,
  isArchived,
  filters,
  cfg,
}: {
  storyPackId: string;
  isArchived: boolean;
  filters?: Record<string, unknown>;
  cfg: NonNullable<ReturnType<typeof useRoadmapStoryPackConfig>["data"]>;
}) {
  const latest = useRoadmapStoryLatestVersion(storyPackId);
  const hasDraft = !!latest.data?.story;
  // Default: open Preview when a draft exists at first resolution; otherwise
  // open Define. Manual selection always wins. Component state only —
  // no localStorage/sessionStorage.
  const [tab, setTab] = useState<string>("define");
  const [seeded, setSeeded] = useState(false);
  const [userSelectedTab, setUserSelectedTab] = useState(false);
  useEffect(() => {
    if (seeded || latest.isLoading || userSelectedTab) return;
    setTab(hasDraft ? "preview" : "define");
    setSeeded(true);
  }, [seeded, latest.isLoading, hasDraft, userSelectedTab]);
  // Reset seeding + manual-selection when switching story packs.
  useEffect(() => {
    setTab("define");
    setSeeded(false);
    setUserSelectedTab(false);
  }, [storyPackId]);
  const handleTabChange = (v: string) => {
    setUserSelectedTab(true);
    setTab(v);
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="w-full">

      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="define">Define</TabsTrigger>
        <TabsTrigger value="draft">Story Draft</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
        <TabsTrigger value="published">Published</TabsTrigger>
      </TabsList>

      <TabsContent value="define" className="space-y-5 mt-4">
        <IntentSection storyPackId={storyPackId} data={cfg} disabled={isArchived} />
        <SourcesSection storyPackId={storyPackId} data={cfg} disabled={isArchived} />
        <NotesSection storyPackId={storyPackId} data={cfg} disabled={isArchived} />
        <ExternalFilesSection storyPackId={storyPackId} data={cfg} disabled={isArchived} filters={filters} />
        <ReadinessSection data={cfg} filters={filters} />
        <RoadmapStorySourcePackagePreview storyPackId={storyPackId} />
      </TabsContent>

      <TabsContent value="draft" className="space-y-5 mt-4">
        <RoadmapStoryDraftSection
          storyPackId={storyPackId}
          isArchived={isArchived}
          hidePresentationPreview
        />
      </TabsContent>

      <TabsContent value="preview" className="space-y-5 mt-4">
        <RoadmapStoryPreviewTab storyPackId={storyPackId} isArchived={isArchived} />
      </TabsContent>

      <TabsContent value="published" className="space-y-5 mt-4">
        <RoadmapStoryPublishedTab storyPackId={storyPackId} isArchived={isArchived} />
      </TabsContent>
    </Tabs>
  );
}

function ArchivedBanner({ storyPackId }: { storyPackId: string }) {
  return (
    <div className="rounded-md border-2 border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm">
        <Archive className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span>
          <span className="font-semibold">This Story Pack is archived.</span>{" "}
          <span className="text-muted-foreground">Editing is locked. Unarchive to make changes.</span>
        </span>
      </div>
      <ArchiveControls storyPackId={storyPackId} archived />
    </div>
  );
}

function ArchiveControls({ storyPackId, archived }: { storyPackId: string; archived: boolean }) {
  const archive = useArchiveRoadmapStoryPack(storyPackId);
  const unarchive = useUnarchiveRoadmapStoryPack(storyPackId);
  if (archived) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={unarchive.isPending}
        onClick={async () => {
          try {
            await unarchive.mutateAsync();
            toast({ title: "Story Pack unarchived" });
          } catch (e: any) {
            toast({ title: "Could not unarchive", description: e?.message, variant: "destructive" });
          }
        }}
      >
        <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive
      </Button>
    );
  }
  return (
    <div className="flex justify-end">
      <Button
        size="sm"
        variant="ghost"
        className="gap-1.5 text-muted-foreground"
        disabled={archive.isPending}
        onClick={async () => {
          try {
            await archive.mutateAsync();
            toast({ title: "Story Pack archived" });
          } catch (e: any) {
            toast({ title: "Could not archive", description: e?.message, variant: "destructive" });
          }
        }}
      >
        <Archive className="h-3.5 w-3.5" /> Archive this Story Pack
      </Button>
    </div>
  );
}

// ---- Step 1 (intent) -----------------------------------------------------
function IntentSection({
  storyPackId,
  data,
  disabled,
}: {
  storyPackId: string;
  data: NonNullable<ReturnType<typeof useRoadmapStoryPackConfig>["data"]>;
  disabled: boolean;
}) {
  const update = useUpdateRoadmapStoryPackConfig(storyPackId);
  const [title, setTitle] = useState(data.pack.title ?? "");
  const [audience, setAudience] = useState(data.pack.audience ?? "");
  const [focus, setFocus] = useState(data.pack.focus ?? "");
  const [guidance, setGuidance] = useState(data.pack.guidance ?? "");

  useEffect(() => {
    setTitle(data.pack.title ?? "");
    setAudience(data.pack.audience ?? "");
    setFocus(data.pack.focus ?? "");
    setGuidance(data.pack.guidance ?? "");
  }, [data.pack.id, data.pack.title, data.pack.audience, data.pack.focus, data.pack.guidance]);

  const save = async () => {
    try {
      await update.mutateAsync({
        title: title.trim() || null,
        audience: audience || null,
        focus: focus || null,
        guidance: guidance.trim() || null,
      });
      toast({ title: "Story intent saved" });
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <StepCard index={2} title="Tell us what the story is about" subtitle="Title, audience, focus, and any guidance for the future Story.">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Story title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q3 program update" disabled={disabled} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Audience</Label>
          <Select value={audience} onValueChange={setAudience} disabled={disabled}>
            <SelectTrigger><SelectValue placeholder="Who is this for?" /></SelectTrigger>
            <SelectContent>
              {AUDIENCE_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Focus</Label>
          <Select value={focus} onValueChange={setFocus} disabled={disabled}>
            <SelectTrigger><SelectValue placeholder="What angle should it take?" /></SelectTrigger>
            <SelectContent>
              {FOCUS_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Guidance for the story (optional)</Label>
        <Textarea
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder="What story do you want this Pack to tell? Add any context, framing, or specific points you want covered."
          rows={4}
          disabled={disabled}
        />
        <p className="text-[11px] text-muted-foreground">
          Saved securely through the protected Story Pack service.
        </p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={disabled || update.isPending}>
          {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          Save story intent
        </Button>
      </div>
    </StepCard>
  );
}

// ---- Step 3 (sources, grouped) ------------------------------------------
function SourcesSection({
  storyPackId,
  data,
  disabled,
}: {
  storyPackId: string;
  data: NonNullable<ReturnType<typeof useRoadmapStoryPackConfig>["data"]>;
  disabled: boolean;
}) {
  const setSources = useSetRoadmapStoryPackSources(storyPackId);

  const byCategory = useMemo(() => {
    const map = new Map<RoadmapStorySourceCategory, boolean>();
    for (const grp of SOURCE_GROUPS) {
      for (const cat of grp.categories) map.set(cat, true);
    }
    for (const s of data.sources) map.set(s.source_category, s.is_enabled);
    return map;
  }, [data.sources]);

  const toggle = async (cat: RoadmapStorySourceCategory, next: boolean) => {
    try {
      await setSources.mutateAsync([{ source_category: cat, is_enabled: next }]);
    } catch (e: any) {
      toast({ title: "Could not update source", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <StepCard
      index={3}
      title="Choose source material"
      subtitle="Pick the material the future Story should consider. Nothing here is mandatory — turn on only what is useful for this story."
    >
      <div className="space-y-4">
        {SOURCE_GROUPS.map((group) => (
          <div key={group.id} className="space-y-2">
            <div>
              <h4 className="text-xs font-semibold text-foreground">{group.title}</h4>
              <p className="text-[11px] text-muted-foreground">{group.description}</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {group.categories.map((cat) => {
                const meta = SOURCE_LABELS[cat];
                const enabled = byCategory.get(cat) ?? true;
                return (
                  <label
                    key={cat}
                    className="flex items-start gap-3 rounded-md border bg-card px-3 py-2 cursor-pointer hover:bg-accent/30"
                  >
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => toggle(cat, v)}
                      disabled={disabled || setSources.isPending}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{meta.label}</span>
                        {meta.futureSource && (
                          <Badge variant="outline" className="text-[10px]">Will be connected later</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </StepCard>
  );
}

// ---- Step 4a (notes) -----------------------------------------------------
function NotesSection({
  storyPackId,
  data,
  disabled,
}: {
  storyPackId: string;
  data: NonNullable<ReturnType<typeof useRoadmapStoryPackConfig>["data"]>;
  disabled: boolean;
}) {
  const addNote = useAddRoadmapStoryPackNote(storyPackId);
  const updateNote = useUpdateRoadmapStoryPackNote(storyPackId);
  const deleteNote = useDeleteRoadmapStoryPackNote(storyPackId);
  const [draft, setDraft] = useState("");

  const handleAdd = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await addNote.mutateAsync({ body });
      setDraft("");
    } catch (e: any) {
      toast({ title: "Could not add note", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <StepCard
      index={4}
      title="Add additional context"
      subtitle="Optional. Paste anything you want the future Story to consider — for example:"
    >
      <ul className="text-[11px] text-muted-foreground list-disc pl-5 -mt-1 space-y-0.5">
        <li>Meeting talking points</li>
        <li>Stakeholder comments</li>
        <li>Business context not yet in BTPM</li>
        <li>A specific message you want the story to convey</li>
      </ul>
      <div className="space-y-1 pt-1">
        <Textarea
          rows={2}
          placeholder="Paste extra context here…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleAdd} disabled={disabled || addNote.isPending || !draft.trim()}>
            {addNote.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Add context
          </Button>
        </div>
      </div>
      {data.notes.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No additional context yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.notes.map((n) => (
            <li key={n.id} className="rounded-md border bg-card p-3 space-y-2">
              <div className="flex items-start gap-2">
                <FileText className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                <div className="flex-1 whitespace-pre-wrap text-sm">{n.body}</div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => deleteNote.mutate(n.id)}
                  disabled={disabled || deleteNote.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Checkbox
                  checked={n.include_in_story}
                  onCheckedChange={(v) =>
                    updateNote.mutate({ noteId: n.id, patch: { include_in_story: !!v } })
                  }
                  disabled={disabled}
                />
                <span>Include in Story</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        Context notes are saved securely through the protected Story Pack service.
      </p>
    </StepCard>
  );
}

// ---- Step 4b (linked files) ---------------------------------------------
function ExternalFilesSection({
  storyPackId,
  data,
  disabled,
  filters,
}: {
  storyPackId: string;
  data: NonNullable<ReturnType<typeof useRoadmapStoryPackConfig>["data"]>;
  disabled: boolean;
  filters?: Record<string, unknown>;
}) {
  const addFile = useAddRoadmapStoryPackExternalFile(storyPackId);
  const updateFile = useUpdateRoadmapStoryPackExternalFile(storyPackId);
  const removeFile = useRemoveRoadmapStoryPackExternalFile(storyPackId);

  // Canonical SharePoint picker dialog state.
  const [pickerOpen, setPickerOpen] = useState(false);

  // Optional advanced manual-entry fallback (hidden by default).
  const [manualOpen, setManualOpen] = useState(false);
  const [driveId, setDriveId] = useState("");
  const [itemId, setItemId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [userNote, setUserNote] = useState("");

  const resetManual = () => {
    setDriveId(""); setItemId(""); setDisplayName(""); setWebUrl(""); setUserNote("");
  };

  const handleManualAdd = async () => {
    if (!driveId.trim() || !itemId.trim()) {
      toast({ title: "Drive ID and Item ID are required", variant: "destructive" });
      return;
    }
    try {
      await addFile.mutateAsync({
        driveId: driveId.trim(),
        itemId: itemId.trim(),
        displayName: displayName.trim() || null,
        webUrl: webUrl.trim() || null,
        userNote: userNote.trim() || null,
      });
      resetManual();
      setManualOpen(false);
      toast({ title: "File reference linked" });
    } catch (e: any) {
      toast({ title: "Could not link file", description: e?.message, variant: "destructive" });
    }
  };

  // Best-effort defaults for the picker from Roadmap filters.
  const defaultWorkspaceId =
    (Array.isArray((filters as any)?.workspace_ids) && (filters as any).workspace_ids.length === 1)
      ? String((filters as any).workspace_ids[0])
      : null;
  const defaultProjectId =
    (Array.isArray((filters as any)?.project_ids) && (filters as any).project_ids.length === 1)
      ? String((filters as any).project_ids[0])
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Linked files</CardTitle>
        <p className="text-[12px] text-muted-foreground">
          Linked SharePoint file metadata is included in the source package; included files may also be read during generation and reported in the file context manifest.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.external_files.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No linked files yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.external_files.map((f) => (
              <LinkedFileRow
                key={f.id}
                file={f}
                disabled={disabled}
                onToggleInclude={(v) =>
                  updateFile.mutate({ fileId: f.id, patch: { includeInStory: v } })
                }
                onSaveNote={async (note) => {
                  await updateFile.mutateAsync({
                    fileId: f.id,
                    patch: { userNote: note },
                  });
                }}
                onRemove={() => removeFile.mutate(f.id)}
                isRemoving={removeFile.isPending}
              />
            ))}
          </ul>
        )}


        {/* Primary UX — canonical SharePoint picker */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setPickerOpen(true)}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" /> Select SharePoint files
          </Button>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            onClick={() => setManualOpen((v) => !v)}
            disabled={disabled}
          >
            {manualOpen ? "Hide advanced entry" : "Advanced: enter by Drive ID / Item ID"}
          </button>
        </div>

        {/* Advanced manual fallback — collapsed by default */}
        {manualOpen && (
          <div className="rounded-md border border-dashed bg-muted/20 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">Advanced</Badge>
              <p className="text-[11px] text-muted-foreground">
                For files you can't reach through the picker — paste their Drive ID and Item ID.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Drive ID *</Label>
                <Input value={driveId} onChange={(e) => setDriveId(e.target.value)} disabled={disabled} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Item ID *</Label>
                <Input value={itemId} onChange={(e) => setItemId(e.target.value)} disabled={disabled} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Display name</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={disabled} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Web URL</Label>
                <Input value={webUrl} onChange={(e) => setWebUrl(e.target.value)} disabled={disabled} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note (optional)</Label>
              <Textarea rows={2} value={userNote} onChange={(e) => setUserNote(e.target.value)} disabled={disabled} />
            </div>
            <Separator />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { resetManual(); setManualOpen(false); }} disabled={addFile.isPending}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleManualAdd} disabled={disabled || addFile.isPending}>
                {addFile.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Link reference
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Reference only — no Microsoft Graph download, no file bytes stored.
            </p>
          </div>
        )}

        <RoadmapStoryPackSharePointFilePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          storyPackId={storyPackId}
          defaultWorkspaceId={defaultWorkspaceId}
          defaultProjectId={defaultProjectId}
        />
      </CardContent>
    </Card>
  );
}

// ---- Readiness checklist -------------------------------------------------
function ReadinessSection({
  data,
  filters,
}: {
  data: NonNullable<ReturnType<typeof useRoadmapStoryPackConfig>["data"]>;
  filters?: Record<string, unknown>;
}) {
  const enabledSourceCount = useMemo(() => {
    // Default-enabled minus explicit-disabled = effective enabled.
    const allCats = SOURCE_GROUPS.flatMap((g) => g.categories);
    const explicit = new Map(data.sources.map((s) => [s.source_category, s.is_enabled] as const));
    return allCats.filter((c) => explicit.get(c) ?? true).length;
  }, [data.sources]);

  const scopeFromFilters = !!filters && Object.keys(filters).length > 0;
  const scopeFromPack =
    !!data.pack.scope_config && Object.keys(data.pack.scope_config ?? {}).length > 0;

  const hasUnavailableEnabledSource = useMemo(() => {
    const explicit = new Map(data.sources.map((s) => [s.source_category, s.is_enabled] as const));
    // discussions_comments is not connected yet.
    const futureOnly: RoadmapStorySourceCategory[] = ["discussions_comments"];
    return futureOnly.some((c) => explicit.get(c) ?? true);
  }, [data.sources]);

  const items: { ok: boolean; label: string; optional?: boolean }[] = [
    { ok: true, label: "Story Pack draft selected" },
    { ok: scopeFromPack || scopeFromFilters, label: "Scope captured from Roadmap filters" },
    { ok: !!(data.pack.title || data.pack.guidance), label: "Title or guidance saved", optional: true },
    { ok: enabledSourceCount > 0, label: `Source categories selected (${enabledSourceCount})` },
    { ok: data.notes.length > 0 || data.external_files.length > 0, label: "Extra context or linked files", optional: true },
    { ok: true, label: "Source package can be composed below" },
    { ok: data.external_files.length === 0 || data.external_files.every((f) => !!f.item_id), label: "Linked SharePoint files captured with Drive/Item IDs" },
    { ok: !hasUnavailableEnabledSource, label: "Selected categories without source coverage are disclosed", optional: true },
    { ok: true, label: "AI draft generation is available below", optional: true },
  ];

  return (
    <StepCard index={5} title="Review readiness" subtitle="Quick check of what is in place before generating or regenerating the Story Draft.">

      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            {it.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground/60" />
            )}
            <span className={it.ok ? "text-foreground" : "text-muted-foreground"}>
              {it.label}
              {it.optional && <span className="text-[10px] text-muted-foreground"> · optional</span>}
            </span>
          </li>
        ))}
      </ul>
    </StepCard>
  );
}

// ---- (Phase 6B.6) Generate Story Draft is now active and lives in
// `RoadmapStoryDraftSection`. The old `GenerateLaterCta` placeholder is
// removed.

// ---- Linked file row (with editable note) -------------------------------
function LinkedFileRow({
  file,
  disabled,
  onToggleInclude,
  onSaveNote,
  onRemove,
  isRemoving,
}: {
  file: {
    id: string;
    item_id: string;
    display_name: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    web_url: string | null;
    user_note: string | null;
    include_in_story: boolean;
  };
  disabled: boolean;
  onToggleInclude: (v: boolean) => void;
  onSaveNote: (note: string | null) => Promise<void>;
  onRemove: () => void;
  isRemoving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.user_note ?? "");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(file.user_note ?? "");
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(file.user_note ?? "");
  };
  const saveEdit = async () => {
    setSaving(true);
    try {
      const trimmed = draft.trim();
      await onSaveNote(trimmed.length === 0 ? null : trimmed);
      setEditing(false);
    } catch (e: any) {
      toast({ title: "Could not save note", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Paperclip className="h-3.5 w-3.5 mt-1 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{file.display_name || file.item_id}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {file.mime_type || "—"}
            {typeof file.size_bytes === "number" ? ` · ${formatBytes(file.size_bytes)}` : ""}
          </div>
          {file.web_url && (
            <a
              href={file.web_url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-primary underline truncate block"
            >
              Open in SharePoint
            </a>
          )}

          {!editing ? (
            <div className="mt-1.5 flex items-start gap-1.5">
              {file.user_note ? (
                <p className="text-[11px] text-muted-foreground flex-1 whitespace-pre-wrap">
                  {file.user_note}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground/70 italic flex-1">No note.</p>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={startEdit}
                disabled={disabled}
                title={file.user_note ? "Edit note" : "Add note"}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              <Textarea
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Why is this file relevant to the Story?"
                disabled={saving}
                className="text-[12px]"
              />
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 gap-1"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  <X className="h-3 w-3" /> Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2 gap-1"
                  onClick={saveEdit}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onRemove}
          disabled={disabled || isRemoving}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Checkbox
          checked={file.include_in_story}
          onCheckedChange={(v) => onToggleInclude(!!v)}
          disabled={disabled}
        />
        <span>Include in Story</span>
      </div>
    </li>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
