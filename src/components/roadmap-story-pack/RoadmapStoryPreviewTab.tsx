/**
 * Phase 6B.7a / 6B.7b — Roadmap Story Pack Preview tab.
 *
 * Renders either:
 *   - the deterministic Presentation Preview built from the latest Story
 *     Draft + structured source snapshot (baseline / fallback), OR
 *   - a validated AI Presentation Blueprint (Phase 6B.7b, second AI pass)
 *     overlaid onto the deterministic data. The LLM never returns HTML,
 *     charts, or URLs; BTPM validates and renders every visual.
 */

import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, Info, Loader2, Sparkles, RefreshCcw, ShieldAlert } from "lucide-react";
import {
  useRoadmapStoryLatestVersion,
  useRoadmapStoryVersionDebug,
} from "@/hooks/useRoadmapStoryGeneration";
import {
  useGeneratePresentationBlueprint,
  useLatestAiPresentationBlueprint,
  useAiPresentationBlueprintDebug,
} from "@/hooks/useRoadmapStoryPresentationBlueprint";
import {
  buildDeterministicRoadmapStoryPresentationBlueprint,
  parseRoadmapStorySourceSnapshotJson,
} from "@/lib/roadmap-story/roadmapStoryPresentationBlueprint";
import { applyAiBlueprintOverlay } from "@/lib/roadmap-story/roadmapStoryPresentationBlueprintOverlay";
import { RoadmapStoryPresentationPreview } from "./presentation/RoadmapStoryPresentationPreview";
import { RoadmapStoryVisualSettingsPanel } from "./RoadmapStoryVisualSettingsPanel";
import { useRoadmapStoryVisualSettings } from "@/hooks/useRoadmapStoryVisualSettings";
import { RoadmapStoryPublishAction } from "./RoadmapStoryPublishAction";

export function RoadmapStoryPreviewTab({
  storyPackId,
  isArchived = false,
}: {
  storyPackId: string;
  isArchived?: boolean;
}) {
  const latest = useRoadmapStoryLatestVersion(storyPackId);
  const draft = latest.data?.story ?? null;
  const versionId = latest.data?.id ?? null;

  const debug = useRoadmapStoryVersionDebug(versionId, !!versionId);
  const sourceSnapshot = parseRoadmapStorySourceSnapshotJson(
    debug.data?.version.source_snapshot ?? null,
  );

  const fileManifest =
    (debug.data?.ai_run?.input_manifest as Record<string, unknown> | undefined)?.file_context as
      | {
          included_count?: number;
          sent_count?: number;
          skipped_count?: number;
          total_bytes_sent?: number;
          files?: Array<Record<string, unknown>>;
        }
      | undefined;

  const deterministicBlueprint = useMemo(
    () =>
      draft
        ? buildDeterministicRoadmapStoryPresentationBlueprint(draft, {
            versionId: latest.data?.id,
            sourceManifest: (latest.data?.source_manifest ?? null) as Record<string, unknown> | null,
            sourceSnapshot,
            fileManifestSummary: fileManifest ?? null,
          })
        : null,
    [draft, latest.data?.id, latest.data?.source_manifest, sourceSnapshot, fileManifest],
  );

  const latestAi = useLatestAiPresentationBlueprint(storyPackId);
  const generate = useGeneratePresentationBlueprint(storyPackId);
  const visualSettings = useRoadmapStoryVisualSettings(storyPackId);

  const overlaidBlueprint = useMemo(() => {
    if (!deterministicBlueprint) return null;
    const settings = visualSettings.data?.resolved ?? null;
    if (!latestAi.data?.validation.ok || !latestAi.data.blueprint) {
      if (!settings) return deterministicBlueprint;
      return applyAiBlueprintOverlay(
        {
          schemaVersion: "roadmap_story_presentation_v1",
          templateId: "steerco_briefing_v1",
          title: deterministicBlueprint.title,
          subtitle: deterministicBlueprint.subtitle,
          density: deterministicBlueprint.density,
          executiveTakeaway: "",
          blocks: deterministicBlueprint.blocks.map((b, i) => ({
            blockId: `det_${i}`,
            slotId: b.slotId,
            blockType: b.blockType,
            title: (b as { title?: string }).title ?? "",
          })),
          sourceLimitations: [],
        },
        deterministicBlueprint,
        settings,
      );
    }
    return applyAiBlueprintOverlay(latestAi.data.blueprint, deterministicBlueprint, settings);
  }, [deterministicBlueprint, latestAi.data, visualSettings.data?.resolved]);

  const aiValid = !!latestAi.data?.validation.ok && !!latestAi.data.blueprint;
  const aiPresent = !!latestAi.data;
  const running = generate.isPending;

  const canGenerate = !!draft && !!versionId && !running;

  const handleGenerate = () => {
    if (!draft || !versionId) return;
    generate.mutate(
      {
        storyPackId,
        storyPackVersionId: versionId,
        draft,
        sourceSnapshot,
        fileManifestSummary: fileManifest ?? null,
        deterministicBlockTypes: deterministicBlueprint?.blocks.map((b) => b.blockType),
        visualSettings: visualSettings.data?.resolved ?? null,
      },
      {
        onSuccess: (r) => {
          if (r.ok === true) {
            toast({
              title: r.is_valid
                ? "Presentation blueprint generated"
                : "Blueprint generated with validation issues",
              description: r.is_valid
                ? "The AI presentation blueprint is now active."
                : "Falling back to the deterministic preview.",
            });
            return;
          }
          toast({
            variant: "destructive",
            title: "Blueprint generation failed",
            description: r.note ?? r.error ?? "Unknown error",
          });
        },
      },
    );
  };

  return (
    <div className="space-y-5">
      <Alert className="border-[#E1E1DC] bg-white">
        <Info className="h-4 w-4 text-[#ED1C38]" />
        <AlertDescription className="text-[12px] text-[#1C1F3F]/80">
          Story Draft generation creates the evidence-backed narrative.
          Presentation Blueprint generation turns that narrative into a focused
          visual briefing using BTPM-rendered templates. Charts, timelines, and
          matrices always draw from structured source data — the AI never
          returns chart values, HTML, or URLs.
        </AlertDescription>
      </Alert>

      {/* Controls + status badge */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#ED1C38]" />
            <span className="text-sm font-medium">Presentation blueprint</span>
            <StatusBadge
              running={running}
              aiValid={aiValid}
              aiPresent={aiPresent}
              aiInvalid={aiPresent && !aiValid}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {latestAi.data?.completedAt && (
              <span className="text-[11px] text-muted-foreground">
                {aiValid ? "Generated" : "Last attempt"} · {new Date(latestAi.data.completedAt).toLocaleString()}
                {latestAi.data.model ? ` · ${latestAi.data.model}` : ""}
              </span>
            )}
            <Button
              size="sm"
              variant={aiValid ? "outline" : "default"}
              disabled={!canGenerate}
              onClick={handleGenerate}
              className="gap-1"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
              {aiValid ? "Regenerate blueprint" : "Generate presentation blueprint"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Publish shortcut — same shared publish flow as the Published tab. */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Publish this Preview</div>
            <p className="text-[11px] text-muted-foreground">
              Freeze the currently reviewed presentation into an immutable,
              authenticated published version.
            </p>
          </div>
          <div className="ml-auto">
            <RoadmapStoryPublishAction
              storyPackId={storyPackId}
              isArchived={isArchived}
            />
          </div>
        </CardContent>
      </Card>

      {aiPresent && !aiValid && latestAi.data?.validation.errors?.length ? (
        <Alert className="border-[#EAC16D]/50 bg-[#EAC16D]/10">
          <ShieldAlert className="h-4 w-4 text-[#7A5512]" />
          <AlertDescription className="text-[11px] text-[#1C1F3F] space-y-0.5">
            <div className="font-medium">AI blueprint failed validation — showing deterministic preview</div>
            <ul className="list-disc list-inside">
              {latestAi.data.validation.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {(latest.isLoading || (versionId && debug.isLoading)) && !draft && (
        <Card>
          <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading latest draft…
          </CardContent>
        </Card>
      )}

      {!latest.isLoading && !draft && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No Story Draft yet. Generate a draft in the <span className="font-medium text-foreground">Story Draft</span> tab
            to see a presentation preview here.
          </CardContent>
        </Card>
      )}

      {overlaidBlueprint && (
        <RoadmapStoryPresentationPreview blueprint={overlaidBlueprint} />
      )}

      {latestAi.data?.runId && (
        <PresentationBlueprintDetailsPanel runId={latestAi.data.runId} />
      )}

      <RoadmapStoryVisualSettingsPanel
        storyPackId={storyPackId}
        availableBlockTypes={deterministicBlueprint?.blocks.map((b) => b.blockType) ?? []}
        isArchived={isArchived}
      />
    </div>
  );
}

function StatusBadge({
  running, aiValid, aiPresent, aiInvalid,
}: { running: boolean; aiValid: boolean; aiPresent: boolean; aiInvalid: boolean }) {
  if (running) {
    return (
      <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-700 bg-blue-50">
        Generating…
      </Badge>
    );
  }
  if (aiValid) {
    return (
      <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-700 bg-emerald-50">
        AI blueprint active
      </Badge>
    );
  }
  if (aiInvalid) {
    return (
      <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700 bg-amber-50">
        Validation failed · fallback active
      </Badge>
    );
  }
  if (!aiPresent) {
    return (
      <Badge variant="outline" className="text-[10px] border-[#516490]/40 text-[#516490] bg-white">
        Deterministic preview
      </Badge>
    );
  }
  return null;
}

function PresentationBlueprintDetailsPanel({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const debug = useAiPresentationBlueprintDebug(runId, open);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardContent className="py-3 flex items-center gap-2 cursor-pointer hover:bg-muted/40 text-sm">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            <span className="font-medium">Presentation Blueprint Details</span>
            <span className="text-[11px] text-muted-foreground">
              Prompt · input package · raw response · parsed blueprint · validation
            </span>
          </CardContent>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-3">
            {debug.isLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading debug details…
              </div>
            )}
            {debug.data && (
              <div className="grid gap-3 text-[11px]">
                <DebugRow label="Status" value={String(debug.data.status)} />
                <DebugRow label="Valid" value={String(debug.data.is_valid ?? "—")} />
                <DebugRow label="Model" value={debug.data.model ?? "—"} />
                <DebugRow label="OpenAI response id" value={debug.data.openai_response_id ?? "—"} />
                <DebugBlock label="System prompt" body={debug.data.prompt_text} />
                <DebugBlock label="Input package" body={debug.data.input_package} pretty />
                <DebugBlock label="Raw model response" body={debug.data.raw_response} />
                <DebugBlock label="Parsed blueprint" body={debug.data.parsed_blueprint} pretty />
                <DebugBlock label="Validation" body={debug.data.validation_json} pretty />
                {debug.data.error_text && <DebugBlock label="Error" body={debug.data.error_text} />}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-40 shrink-0">{label}</span>
      <span className="font-mono break-all">{value}</span>
    </div>
  );
}

function DebugBlock({ label, body, pretty }: { label: string; body: string | null; pretty?: boolean }) {
  if (!body) return null;
  let text = body;
  if (pretty) {
    try { text = JSON.stringify(JSON.parse(body), null, 2); } catch { /* keep raw */ }
  }
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground">{label}</div>
      <pre className="max-h-64 overflow-auto rounded border bg-muted/40 p-2 text-[10px] whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}

export default RoadmapStoryPreviewTab;
