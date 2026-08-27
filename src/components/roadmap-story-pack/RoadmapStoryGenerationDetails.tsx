/**
 * Phase 6B.6c — Roadmap Story Pack generation transparency.
 *
 * Owner-only debug panel that lets an authorized Story Pack owner inspect
 * the exact materials used to produce a Story Draft:
 *   1. Prompt / instructions sent to the LLM
 *   2. Source input package (bounded JSON snapshot)
 *   3. Raw model response (pre-parse)
 *   4. Parsed story JSON
 *   5. AI run metadata
 *
 * Each section supports Copy and Download. All data is loaded through the
 * controlled `get_roadmap_story_pack_version_debug` SECURITY DEFINER RPC.
 * No `_encrypted` fields are ever exposed to the browser; no provider
 * secrets are read here; no public links, no Supabase Storage exports.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useRoadmapStoryVersionDebug } from "@/hooks/useRoadmapStoryGeneration";
import type { RoadmapStoryPackVersionDebug } from "@/lib/roadmapStoryPackService";

interface Props {
  versionId: string | null | undefined;
  versionNumber?: number;
}

export function RoadmapStoryGenerationDetails({ versionId, versionNumber }: Props) {
  const [open, setOpen] = useState(false);
  const debug = useRoadmapStoryVersionDebug(versionId, open);

  if (!versionId) return null;

  return (
    <Card className="border-dashed">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer pb-3 hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm flex items-center gap-2">
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Generation details
                {typeof versionNumber === "number" && (
                  <Badge variant="outline" className="text-[10px]">v{versionNumber}</Badge>
                )}
              </CardTitle>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                Prompt · Input · Raw response · Parsed JSON
              </span>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-[11px] text-amber-900 dark:text-amber-200">
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                These details may contain sensitive project information. Do not share
                outside authorized users. No provider API keys are included.
              </span>
            </div>

            {debug.isLoading && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading generation details…
              </div>
            )}
            {debug.error && (
              <div className="text-[12px] text-destructive">
                Failed to load generation details: {(debug.error as Error).message}
              </div>
            )}
            {!debug.isLoading && !debug.error && debug.data && (
              <DebugBody data={debug.data} versionNumber={versionNumber} />
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function DebugBody({
  data,
  versionNumber,
}: {
  data: RoadmapStoryPackVersionDebug;
  versionNumber?: number;
}) {
  const run = data.ai_run;
  const v = data.version;
  const fileTag = `roadmap-story-pack-v${versionNumber ?? v.version_number}`;

  // Pretty-print parsed JSON; fall back to raw text on parse failure.
  const parsedPretty = (() => {
    if (!v.story_json) return null;
    try { return JSON.stringify(JSON.parse(v.story_json), null, 2); }
    catch { return v.story_json; }
  })();
  const snapshotPretty = (() => {
    if (!v.source_snapshot) return null;
    try { return JSON.stringify(JSON.parse(v.source_snapshot), null, 2); }
    catch { return v.source_snapshot; }
  })();
  const inputManifestPretty = run?.input_manifest
    ? JSON.stringify(run.input_manifest, null, 2)
    : null;
  const modelMetaPretty = JSON.stringify(v.model_metadata ?? {}, null, 2);

  const rawIsJson = (() => {
    if (!run?.raw_response) return false;
    try { JSON.parse(run.raw_response.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/m, "").trim()); return true; }
    catch { return false; }
  })();
  const fallbackUsed = (() => {
    if (!v.story_json) return false;
    try {
      const obj = JSON.parse(v.story_json) as { _format?: string };
      return obj._format === "fallback_markdown";
    } catch { return false; }
  })();

  return (
    <div className="space-y-4">
      <DebugSection
        title="Prompt / instructions"
        subtitle="Exact system instructions sent to the model"
        text={run?.prompt_text ?? "(not recorded for this run)"}
        copyLabel="Copy prompt"
        downloadName={`${fileTag}-prompt.txt`}
        downloadType="text/plain"
        meta={[
          run?.provider ? `provider: ${run.provider}` : null,
          run?.model ? `model: ${run.model}` : null,
          run?.reasoning_effort ? `effort: ${run.reasoning_effort}` : null,
          run?.feature_key ? `feature: ${run.feature_key}` : null,
        ].filter(Boolean) as string[]}
      />

      <DebugSection
        title="Input package (source snapshot)"
        subtitle="Bounded JSON sent to the Edge Function and model"
        text={snapshotPretty ?? "(no source snapshot persisted for this version)"}
        copyLabel="Copy input JSON"
        downloadName={`${fileTag}-input.json`}
        downloadType="application/json"
        meta={[
          snapshotPretty ? `${snapshotPretty.length.toLocaleString()} chars` : null,
          inputManifestPretty ? `manifest: ${inputManifestPretty.length.toLocaleString()} chars` : null,
        ].filter(Boolean) as string[]}
        extra={inputManifestPretty ? (
          <DebugSection
            inline
            title="Input manifest"
            text={inputManifestPretty}
            copyLabel="Copy manifest"
            downloadName={`${fileTag}-input-manifest.json`}
            downloadType="application/json"
          />
        ) : null}
      />

      <DebugSection
        title="Raw model response"
        subtitle="Exactly what the LLM returned, before parsing"
        text={run?.raw_response ?? "(no raw response recorded)"}
        copyLabel="Copy raw response"
        downloadName={`${fileTag}-raw-response.${rawIsJson ? "json" : "txt"}`}
        downloadType={rawIsJson ? "application/json" : "text/plain"}
        meta={[
          rawIsJson ? "parsed as: JSON" : "parsed as: text",
          fallbackUsed ? "fallback wrapper used" : "structured contract honoured",
          typeof run?.completion_tokens === "number" ? `output tokens: ${run.completion_tokens}` : null,
        ].filter(Boolean) as string[]}
      />

      <DebugSection
        title="Parsed story JSON"
        subtitle="What the UI renders from"
        text={parsedPretty ?? "(no parsed story available)"}
        copyLabel="Copy parsed JSON"
        downloadName={`${fileTag}-parsed-story.json`}
        downloadType="application/json"
      />

      {/* 6B.6d — File context manifest (linked SharePoint files used for this run). */}
      {(data.files && data.files.length > 0) || (run && typeof run.files_selected_count === "number") ? (
        <DebugSection
          title="File context manifest"
          subtitle="Linked SharePoint files considered, sent, or skipped for this generation"
          text={JSON.stringify(
            {
              summary: {
                files_selected: run?.files_selected_count ?? null,
                files_sent: run?.files_sent_count ?? null,
                files_skipped: run?.files_skipped_count ?? null,
                total_bytes_sent: run?.total_bytes_sent ?? null,
              },
              files: data.files ?? [],
            },
            null,
            2,
          )}
          copyLabel="Copy file manifest"
          downloadName={`${fileTag}-file-manifest.json`}
          downloadType="application/json"
          meta={[
            typeof run?.files_sent_count === "number" ? `sent: ${run.files_sent_count}` : null,
            typeof run?.files_skipped_count === "number" ? `skipped: ${run.files_skipped_count}` : null,
            typeof run?.total_bytes_sent === "number"
              ? `bytes: ${run.total_bytes_sent.toLocaleString()}`
              : null,
          ].filter(Boolean) as string[]}
          extra={
            data.files && data.files.length > 0 ? (
              <div className="mt-2 space-y-1">
                {data.files.map((f) => (
                  <div key={f.id} className="text-[11px] flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        variant={f.status === "sent" ? "default" : "outline"}
                        className="text-[10px] shrink-0"
                      >
                        {f.status}
                      </Badge>
                      <span className="truncate font-mono">{f.attachment_alias}</span>
                      {f.file_extension && <span className="text-muted-foreground">.{f.file_extension}</span>}
                    </div>
                    <div className="text-muted-foreground shrink-0">
                      {typeof f.size_bytes === "number" ? `${f.size_bytes.toLocaleString()} B` : ""}
                      {f.skip_reason ? ` — ${f.skip_reason}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : null
          }
        />
      ) : null}



      <DebugSection
        title="AI run metadata"
        subtitle="Audit row and model metadata"
        text={JSON.stringify(
          {
            ai_run: run ? {
              id: run.id,
              status: run.status,
              provider: run.provider,
              model: run.model,
              reasoning_effort: run.reasoning_effort,
              feature_key: run.feature_key,
              started_at: run.started_at,
              completed_at: run.completed_at,
              prompt_tokens: run.prompt_tokens,
              completion_tokens: run.completion_tokens,
              total_tokens: run.total_tokens,
            } : null,
            version: {
              id: v.id,
              version_number: v.version_number,
              status: v.status,
              created_at: v.created_at,
              created_by: v.created_by,
              source_manifest: v.source_manifest,
              model_metadata: v.model_metadata,
            },
          },
          null,
          2,
        )}
        copyLabel="Copy metadata"
        downloadName={`${fileTag}-metadata.json`}
        downloadType="application/json"
        extra={
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Model metadata only
            </summary>
            <pre className="mt-1 rounded-md bg-muted/50 p-2 font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
              {modelMetaPretty}
            </pre>
          </details>
        }
      />
    </div>
  );
}

interface SectionProps {
  title: string;
  subtitle?: string;
  text: string;
  copyLabel: string;
  downloadName: string;
  downloadType: string;
  meta?: string[];
  extra?: React.ReactNode;
  inline?: boolean;
}

function DebugSection({
  title,
  subtitle,
  text,
  copyLabel,
  downloadName,
  downloadType,
  meta,
  extra,
  inline,
}: SectionProps) {
  const [expanded, setExpanded] = useState(false);
  const sizeBytes = new Blob([text]).size;
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };
  const handleDownload = () => {
    const blob = new Blob([text], { type: downloadType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const Wrapper = inline ? "div" : "div";
  return (
    <Wrapper className={inline ? "mt-3 border-l-2 border-muted pl-3" : "rounded-md border p-3 space-y-2"}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-[13px] font-semibold">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
          {meta && meta.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {meta.map((m, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] font-normal">{m}</Badge>
              ))}
              <Badge variant="outline" className="text-[10px] font-normal">
                {sizeBytes.toLocaleString()} bytes
              </Badge>
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={handleCopy}>
            <Copy className="h-3 w-3" /> {copyLabel}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={handleDownload}>
            <Download className="h-3 w-3" /> Download
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {expanded ? "Hide" : "Show"} content
      </button>
      {expanded && (
        <pre className="rounded-md bg-muted/50 p-2 text-[11px] font-mono whitespace-pre-wrap break-all max-h-80 overflow-auto">
          {text}
        </pre>
      )}
      {extra}
    </Wrapper>
  );
}
