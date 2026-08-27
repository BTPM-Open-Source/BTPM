/**
 * Phase 6B.8c — Authenticated Published Story Presentation viewer page.
 *
 * Route: `/story-presentations/:versionId` (mounted inside the
 * authenticated app shell in `App.tsx`). This page is NOT public — the
 * existing `AuthGuardedRoute` guard requires BTPM login and active-user
 * status before this component renders. Access to the frozen snapshot is
 * additionally gated server-side by
 * `can_view_roadmap_story_presentation_version`, which requires
 * `has_project_access` for every source project in the version.
 *
 * Explicitly out of scope for 6B.8c:
 *   - Published tab, Publish button/dialog, copy-link UI, archive/revoke
 *     UI, workspace Story Library, public/anonymous/token routes,
 *     domain-based sharing, export (PPT / PDF / Gamma).
 *
 * Nothing the publisher used to author the Story is rendered here:
 *   - No Story Pack Define / Draft / Preview controls, no Generate /
 *     Regenerate buttons, no Presentation Blueprint Details, no Story
 *     Draft Details, no prompt / input package / raw model response /
 *     parsed AI blueprint JSON / validation payload / source snapshot
 *     JSON / source package JSON / Visual Template Library / provider
 *     metadata / `_encrypted` fields.
 */

import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Info, Lock, Loader2, FileText, ArrowLeft } from "lucide-react";
import { usePublishedStoryPresentationView } from "@/hooks/usePublishedStoryPresentationView";
import { PublishedStoryPresentationRenderer } from "@/components/roadmap-story-pack/presentation/PublishedStoryPresentationRenderer";
import { PublishedStoryFullscreenPresenter } from "@/components/roadmap-story-pack/presentation/PublishedStoryFullscreenPresenter";
import { PublishedStoryHtmlExportAction } from "@/components/roadmap-story-pack/presentation/PublishedStoryHtmlExportAction";
import { HTML_EXPORT_ROOT_ATTR } from "@/lib/roadmap-story/roadmapStoryHtmlExport";
import type { PublishedStoryPresentationSnapshot } from "@/lib/roadmap-story/roadmapStoryPublishedPresentationTypes";
import type { RoadmapStoryPresentationBlock } from "@/lib/roadmap-story/roadmapStoryPresentationBlueprint";

type SnapshotValidation =
  | { ok: true; blocks: RoadmapStoryPresentationBlock[] }
  | { ok: false };

/**
 * Only the frozen `btpm_published_story_v1` envelope is accepted. The
 * legacy `roadmap_story_presentation_v1` (raw AI blueprint) shape is
 * explicitly rejected — publish already refuses to store it, but the
 * viewer double-checks so an older invalid row cannot render.
 */
function validateSnapshot(snapshot: PublishedStoryPresentationSnapshot | undefined | null): SnapshotValidation {
  if (!snapshot) return { ok: false };
  if (snapshot.schemaVersion !== "btpm_published_story_v1") return { ok: false };
  if (!Array.isArray(snapshot.blocks) || snapshot.blocks.length === 0) return { ok: false };
  return { ok: true, blocks: snapshot.blocks as RoadmapStoryPresentationBlock[] };
}

function formatPublishedAt(iso: string | undefined | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function PublishedStoryPresentationView() {
  const params = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const versionId = params.versionId ?? undefined;
  const query = usePublishedStoryPresentationView(versionId);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/roadmap?tab=status-pack");
    }
  };

  const backButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleBack}
      className="h-8 gap-1.5 border-[#1C1F3F]/25 bg-white text-[12px] text-[#1C1F3F] hover:bg-[#F1F1EC]"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back
    </Button>
  );

  const validation = useMemo(
    () => validateSnapshot(query.data?.snapshot),
    [query.data?.snapshot],
  );

  if (!versionId) {
    return <SafeStateShell tone="error" icon={AlertTriangle} title="Published Story not found." backSlot={backButton} />;
  }

  if (query.isLoading) {
    return (
      <SafeStateShell
        tone="neutral"
        icon={Loader2}
        iconSpin
        title="Loading published Story…"
        backSlot={backButton}
      />
    );
  }

  if (query.isError) {
    const kind = query.error?.kind ?? "generic";
    if (kind === "forbidden") {
      return (
        <SafeStateShell
          tone="warn"
          icon={Lock}
          title="You do not have access to this published Story Presentation."
          body="Access requires permission to all source projects included in this Story."
          backSlot={backButton}
        />
      );
    }
    if (kind === "archived") {
      return (
        <SafeStateShell
          tone="neutral"
          icon={Info}
          title="This published Story version is no longer available."
          backSlot={backButton}
        />
      );
    }
    if (kind === "not_found") {
      return <SafeStateShell tone="neutral" icon={Info} title="Published Story not found." backSlot={backButton} />;
    }
    return (
      <SafeStateShell
        tone="error"
        icon={AlertTriangle}
        title="This published Story could not be loaded."
        backSlot={backButton}
      />
    );
  }

  const dto = query.data;
  if (!dto || !validation.ok) {
    return (
      <SafeStateShell
        tone="error"
        icon={AlertTriangle}
        title="This published Story version cannot be displayed because the stored presentation snapshot is invalid."
        backSlot={backButton}
      />
    );
  }

  const snap = dto.snapshot;
  const publishedAt = formatPublishedAt(dto.publishedAt);
  const limitations = Array.isArray(snap.sourceLimitations) && snap.sourceLimitations.length > 0
    ? snap.sourceLimitations
    : (dto.sourceLimitations ?? []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-4">
      <div
        className="flex items-center justify-between gap-2"
        data-html-export-exclude="true"
      >
        {backButton}
        <div className="flex items-center gap-2">
          <PublishedStoryHtmlExportAction
            title={dto.title || snap.title || "Roadmap Story"}
            subtitle={snap.subtitle ?? null}
            versionId={dto.versionId}
            versionNumber={dto.versionNumber ?? null}
            publishedAtLabel={publishedAt || null}
          />
          <PublishedStoryFullscreenPresenter
            title={dto.title || snap.title || ""}
            subtitle={snap.subtitle ?? null}
            blocks={validation.blocks}
            sourceLimitations={limitations}
          />
        </div>
      </div>
      <Card
        className="overflow-hidden border-[#E1E1DC] bg-[#F8F8F6] shadow-none"
        {...{ [HTML_EXPORT_ROOT_ATTR]: "true" }}
      >
        <CardHeader className="border-b border-[#E1E1DC] bg-white pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="h-3 w-1 rounded-full bg-[#ED1C38]" aria-hidden />
                <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[#516490]">
                  Published Story
                </span>
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-[#1C1F3F]">
                {dto.title || snap.title || "Roadmap Story"}
              </h1>
              {snap.subtitle && (
                <p className="max-w-2xl text-[13px] leading-relaxed text-[#516490]">
                  {snap.subtitle}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <Badge variant="outline" className="text-[10px] border-[#1C1F3F]/30 text-[#1C1F3F] bg-white">
                Version {dto.versionNumber}
              </Badge>
              {publishedAt && (
                <Badge variant="outline" className="text-[10px] border-[#516490]/40 text-[#516490] bg-white">
                  Published {publishedAt}
                </Badge>
              )}
              {dto.status === "archived" && (
                <Badge variant="outline" className="text-[10px] border-[#ED1C38]/50 text-[#ED1C24] bg-white">
                  Archived
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 bg-[#F8F8F6] pt-5">
          <Alert className="border-[#1C1F3F]/15 bg-white">
            <Info className="h-4 w-4 text-[#516490]" />
            <AlertDescription className="text-[11px] leading-relaxed text-[#1C1F3F]/80">
              Published Story Presentation · You are viewing a frozen published
              version. Opening linked BTPM objects requires your normal BTPM
              permissions.
            </AlertDescription>
          </Alert>

          <PublishedStoryPresentationRenderer
            title={dto.title || snap.title || ""}
            subtitle={snap.subtitle ?? null}
            executiveTakeaway={snap.executiveTakeaway ?? null}
            blocks={validation.blocks}
          />

          {limitations.length > 0 && (
            <div className="rounded-md border border-dashed border-[#E1E1DC] bg-white px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#516490]">
                <AlertTriangle className="h-3.5 w-3.5" />
                Source limitations
                <Badge
                  variant="outline"
                  className="ml-1 text-[10px] border-[#516490]/40 text-[#516490] bg-white"
                >
                  {limitations.length}
                </Badge>
              </div>
              <ul className="mt-2 list-disc list-inside text-[11px] text-[#1C1F3F]/70 space-y-0.5">
                {limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 text-[10px] uppercase tracking-[0.14em] text-[#516490]">
            <FileText className="h-3 w-3" />
            <span>Frozen snapshot · not regenerated on view</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── safe state shell ─────────────────────────

interface SafeStateShellProps {
  tone: "neutral" | "warn" | "error";
  icon: React.ComponentType<{ className?: string }>;
  iconSpin?: boolean;
  title: string;
  body?: string;
  backSlot?: React.ReactNode;
}

function SafeStateShell({ tone, icon: Icon, iconSpin, title, body, backSlot }: SafeStateShellProps) {
  const toneClass =
    tone === "error"
      ? "border-[#ED1C38]/30 bg-white text-[#1C1F3F]"
      : tone === "warn"
        ? "border-[#EAC16D]/50 bg-[#EAC16D]/10 text-[#1C1F3F]"
        : "border-[#E1E1DC] bg-white text-[#1C1F3F]";
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-3">
      {backSlot && <div>{backSlot}</div>}
      <Card className={`shadow-none ${toneClass}`}>
        <CardContent className="flex items-start gap-3 p-6">
          <Icon className={`h-5 w-5 shrink-0 text-[#516490] ${iconSpin ? "animate-spin" : ""}`} />
          <div className="space-y-1">
            <div className="text-[13px] font-semibold">{title}</div>
            {body && <div className="text-[12px] text-[#516490] leading-relaxed">{body}</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
