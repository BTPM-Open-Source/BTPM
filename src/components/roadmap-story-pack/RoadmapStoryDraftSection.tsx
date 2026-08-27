/**
 * Phase 6B.6 — Roadmap Story Pack first controlled AI draft section.
 *
 * Provides:
 *  - "Generate Story Draft" CTA (disabled when ineligible / archived /
 *    snapshot not ready / source package too large);
 *  - generation loading state with toast feedback;
 *  - display of the latest generated draft (title, executive summary,
 *    sections, attention items, source limitations, evidence notes);
 *  - explicit reminders that SharePoint file contents and discussions/
 *    comments are NOT read.
 *
 * Append-only versioning: each click creates a new draft version via the
 * `complete_roadmap_story_generation_run` RPC.
 *
 * Sharing / export are out of scope.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Loader2, AlertTriangle, Info, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRoadmapStorySourceSnapshot } from "@/hooks/useRoadmapStorySourceSnapshot";
import {
  useGenerateRoadmapStoryDraft,
  useRoadmapStoryLatestVersion,
} from "@/hooks/useRoadmapStoryGeneration";
import { buildRoadmapStoryGenerationInput } from "@/lib/roadmap-story/roadmapStoryGenerationInput";
import { RoadmapStoryGenerationDetails } from "./RoadmapStoryGenerationDetails";
import { RoadmapStoryPresentationPreview } from "./presentation/RoadmapStoryPresentationPreview";
import { buildDeterministicRoadmapStoryPresentationBlueprint } from "@/lib/roadmap-story/roadmapStoryPresentationBlueprint";
import type { PollRoadmapStoryRunResponse } from "@/lib/roadmapStoryPackService";

interface Props {
  storyPackId: string;
  isArchived: boolean;
  /**
   * 6B.7a.2 — when true, the embedded Presentation Preview is omitted so
   * the Preview tab can own that surface. Defaults to false to preserve
   * legacy single-surface rendering when this component is used alone.
   */
  hidePresentationPreview?: boolean;
}

// 6B.6d — Server-controlled listing of linked files that will be sent
// (or skipped) on generation. Read-only owner-only RPC.
interface IncludedFileRow {
  external_file_id: string;
  display_name: string | null;
  file_extension: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  is_supported: boolean;
  skip_reason: string | null;
}

function useIncludedStoryPackFiles(storyPackId: string) {
  return useQuery<IncludedFileRow[]>({
    queryKey: ["roadmap-story-pack-included-files", storyPackId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "list_roadmap_story_pack_included_files" as never,
        { _story_pack_id: storyPackId } as never,
      );
      if (error) throw error;
      return ((data ?? []) as unknown) as IncludedFileRow[];
    },
    enabled: !!storyPackId,
    staleTime: 30_000,
  });
}

export function RoadmapStoryDraftSection({ storyPackId, isArchived, hidePresentationPreview = false }: Props) {
  const snap = useRoadmapStorySourceSnapshot(storyPackId);
  const latest = useRoadmapStoryLatestVersion(storyPackId);
  const included = useIncludedStoryPackFiles(storyPackId);
  const [progress, setProgress] = useState<PollRoadmapStoryRunResponse | null>(null);
  const mut = useGenerateRoadmapStoryDraft(storyPackId, {
    onQueued: () =>
      setProgress({ status: "in_progress" } as unknown as PollRoadmapStoryRunResponse),
    onProgress: (p) => setProgress(p),
  });

  const eligibility = useMemo(() => {
    if (isArchived) return { ok: false, reason: "Story Pack is archived. Unarchive it to generate." };
    if (!snap.snapshot) return { ok: false as const, reason: "Compose the source package above before generating." };
    if (snap.sourcesLoading) return { ok: false as const, reason: "Source package is still loading…" };
    const built = buildRoadmapStoryGenerationInput(snap.snapshot);
    if (built.ok === false) {
      const failed = built as { ok: false; error: string };
      if (failed.error === "source_package_too_large") {
        return { ok: false as const, reason: "Source package is too large to send. Narrow scope or unselect categories.", built };
      }
      return { ok: false as const, reason: "No usable source items in the package yet.", built };
    }
    return { ok: true as const, reason: "", built };
  }, [snap.snapshot, snap.sourcesLoading, isArchived]);

  const handleGenerate = async () => {
    if (!eligibility.ok || !("built" in eligibility) || !eligibility.built?.ok) return;
    const built = eligibility.built;
    if (!built.ok) return;
    try {
      const result = await mut.mutateAsync({
        storyPackId,
        sourceSnapshot: built.input.sourceSnapshot,
        sourceManifest: built.input.sourceManifest,
      });
      if (result.ok === true) {
        toast.success("Story draft generated.");
      } else {
        const failure = result as { ok: false; error: string; note?: string };
        toast.error(humanizeGenerationError(failure.error, failure.note));
      }
    } catch (e) {
      toast.error(`Generation failed: ${(e as Error).message}`);
    }
  };

  const draft = latest.data?.story ?? null;
  const isGenerating = mut.isPending;
  const generatedAt = latest.data?.created_at ?? null;
  const modelMeta = latest.data?.model_metadata as { model?: string; provider?: string } | undefined;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Story draft
              <Badge variant="outline" className="text-[10px]">First controlled generation</Badge>
            </CardTitle>
            <p className="text-[12px] text-muted-foreground max-w-2xl">
              Generation can use selected linked SharePoint file contents. Only files marked
              <em> included in story</em> are read, server-side, and never stored as bytes.
              Discussions / comments remain unavailable. Each generation creates a new draft
              version — previous drafts are preserved.
            </p>
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handleGenerate}
            disabled={!eligibility.ok || isGenerating}
          >
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {isGenerating
              ? progress?.status === "in_progress"
                ? "Generating… (long-running)"
                : "Starting…"
              : draft ? "Regenerate draft" : "Generate Story Draft"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!eligibility.ok && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-[12px]">{eligibility.reason}</AlertDescription>
          </Alert>
        )}

        {/* 6B.6d — File-content readiness preview */}
        <FileReadinessRow rows={included.data ?? []} loading={included.isLoading} />

        {/* 6B.6d — Long-running run status (queued / running / processing) */}
        {isGenerating && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-[12px]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>
              Story generation is running in the background. This avoids Edge Function
              timeouts and can take a minute or more when file contents are included.
            </span>
            {progress?.status && (
              <Badge variant="outline" className="ml-auto text-[10px]">{progress.status}</Badge>
            )}
          </div>
        )}


        {latest.isLoading && !draft && (
          <div className="text-[12px] text-muted-foreground">Checking for previous drafts…</div>
        )}

        {!latest.isLoading && !draft && (
          <div className="text-[12px] text-muted-foreground">
            No draft generated yet for this Story Pack.
          </div>
        )}

        {draft && (
          <DraftBody
            draft={draft}
            generatedAt={generatedAt}
            model={modelMeta?.model}
            provider={modelMeta?.provider}
            versionNumber={latest.data?.version_number}
          />
        )}

        {draft && !hidePresentationPreview && (
          <RoadmapStoryPresentationPreview
            blueprint={buildDeterministicRoadmapStoryPresentationBlueprint(draft, {
              versionId: latest.data?.id,
              sourceManifest: (latest.data?.source_manifest ?? null) as Record<string, unknown> | null,
            })}
          />
        )}

        {!draft && !latest.isLoading && !hidePresentationPreview && (
          <div className="text-[11px] text-muted-foreground italic">
            Generate a Story Draft first to preview the presentation view.
          </div>
        )}

        {latest.data?.id && (
          <RoadmapStoryGenerationDetails
            versionId={latest.data.id}
            versionNumber={latest.data.version_number}
          />
        )}
      </CardContent>
    </Card>
  );
}

function FileReadinessRow({ rows, loading }: { rows: IncludedFileRow[]; loading: boolean }) {
  if (loading) {
    return <div className="text-[11px] text-muted-foreground">Checking linked files…</div>;
  }
  if (!rows.length) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        No linked files included for this generation. Add and include files from the source step to feed file contents.
      </div>
    );
  }
  const supported = rows.filter((r) => r.is_supported && !r.skip_reason);
  const skipped = rows.filter((r) => !r.is_supported || r.skip_reason);
  return (
    <div className="rounded-md border bg-muted/20 p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 text-[12px]">
        <FileText className="h-3.5 w-3.5" />
        <span className="font-medium">Linked file contents:</span>
        <Badge variant="secondary" className="text-[10px]">{rows.length} included</Badge>
        <Badge variant="outline" className="text-[10px]">{supported.length} readable</Badge>
        {skipped.length > 0 && (
          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">
            {skipped.length} will be skipped
          </Badge>
        )}
      </div>
      {skipped.length > 0 && (
        <ul className="text-[11px] text-muted-foreground list-disc list-inside">
          {skipped.slice(0, 4).map((s) => (
            <li key={s.external_file_id}>
              <span className="font-mono">{s.display_name ?? s.external_file_id}</span>
              {s.skip_reason ? ` — ${s.skip_reason}` : " — unsupported type"}
            </li>
          ))}
          {skipped.length > 4 && <li>+{skipped.length - 4} more…</li>}
        </ul>
      )}
    </div>
  );
}


function humanizeGenerationError(code: string, note?: string): string {
  switch (code) {
    case "roadmap_story_ai_disabled":
      return "Roadmap Story AI is disabled. An admin must enable it in AI settings.";
    case "roadmap_story_ai_not_configured":
      return "Roadmap Story AI is not configured. Check AI settings.";
    case "openai_not_configured":
      return "The OpenAI Tenant integration is not configured or is incomplete.";
    case "openai_access_blocked":
      return "OpenAI access is not allowed for this Organization or environment.";
    case "openai_configuration_unavailable":
      return "OpenAI configuration is temporarily unavailable. Try again later.";
    case "story_pack_archived":
      return "This Story Pack is archived. Unarchive it before generating.";
    case "forbidden":
      return "You do not have access to this Story Pack.";
    case "source_package_too_large":
      return "Source package is too large to send. Narrow the scope or unselect categories.";
    case "openai_request_failed":
      return `AI provider request failed${note ? `: ${note}` : "."}`;
    case "openai_response_empty":
      return "AI provider returned an empty response.";
    case "version_persist_failed":
      return `Generated draft could not be saved${note ? `: ${note}` : "."}`;
    case "edge_invoke_failed":
      return `Could not reach the generation service${note ? `: ${note}` : "."}`;
    default:
      return `Generation failed (${code})${note ? `: ${note}` : ""}.`;
  }
}

function DraftBody({
  draft,
  generatedAt,
  model,
  provider,
  versionNumber,
}: {
  draft: NonNullable<ReturnType<typeof useRoadmapStoryLatestVersion>["data"]>["story"];
  generatedAt: string | null;
  model?: string;
  provider?: string;
  versionNumber?: number;
}) {
  if (!draft) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
        {typeof versionNumber === "number" && (
          <Badge variant="secondary" className="text-[10px]">Version {versionNumber}</Badge>
        )}
        {generatedAt && <span>Generated {new Date(generatedAt).toLocaleString()}</span>}
        {(model || provider) && (
          <span>· {provider ?? "openai"}/{model ?? "model"}</span>
        )}
        {draft._format === "fallback_markdown" && (
          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">
            Unstructured fallback
          </Badge>
        )}
      </div>

      {draft.title && <h3 className="text-lg font-semibold">{draft.title}</h3>}
      {draft.executiveSummary && (
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{draft.executiveSummary}</p>
      )}

      {Array.isArray(draft.sections) && draft.sections.length > 0 && (
        <div className="space-y-3">
          {draft.sections.map((s, i) => (
            <div key={i} className="border-l-2 border-primary/40 pl-3">
              <div className="text-sm font-semibold">{s.heading ?? `Section ${i + 1}`}</div>
              <div className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
                {s.body}
              </div>
              {Array.isArray(s.evidenceRefs) && s.evidenceRefs.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.evidenceRefs.map((r, j) => (
                    <Badge key={j} variant="outline" className="text-[10px]">{r}</Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {Array.isArray(draft.attentionItems) && draft.attentionItems.length > 0 && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" /> Attention items
          </div>
          <ul className="space-y-1.5">
            {draft.attentionItems.map((a, i) => (
              <li key={i} className="text-[12px]">
                <span className="font-medium">{a.title}</span>
                {a.detail && <span className="text-muted-foreground"> — {a.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(draft.sourceLimitations) && draft.sourceLimitations.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <div className="font-medium mb-1">Source limitations</div>
          <ul className="list-disc list-inside space-y-0.5">
            {draft.sourceLimitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      {Array.isArray(draft.evidenceSummary) && draft.evidenceSummary.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <div className="font-medium mb-1">Evidence / source notes</div>
          <ul className="list-disc list-inside space-y-0.5">
            {draft.evidenceSummary.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
