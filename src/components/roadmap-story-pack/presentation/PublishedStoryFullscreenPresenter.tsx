/**
 * Phase 6B.8f / 6B.8f.1 — Published Story full-screen presentation mode.
 *
 * Renders the entire frozen published snapshot as a single vertically
 * scrolling presentation canvas — NOT a slide/player. Story visual
 * blocks are already designed as a continuous document; presentation
 * mode strips app chrome, widens the canvas, and lets the user scroll
 * naturally.
 *
 * Data comes from the SAME frozen snapshot the normal viewer fetched.
 * No refetch, no regeneration, no debug/prompt/source-package details.
 * Falls back to a full-viewport portal when the browser Fullscreen API
 * is unavailable.
 */

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  PresentationBlockRenderer,
  PRESENTATION_BLOCK_SLOT_ORDER,
} from "./RoadmapStoryPresentationPreview";
import { useFullscreenPresentationMode } from "@/hooks/useFullscreenPresentationMode";
import type { RoadmapStoryPresentationBlock } from "@/lib/roadmap-story/roadmapStoryPresentationBlueprint";

export interface PublishedStoryFullscreenPresenterProps {
  title: string;
  subtitle?: string | null;
  blocks: RoadmapStoryPresentationBlock[];
  sourceLimitations?: string[];
  triggerLabel?: string;
}

export function PublishedStoryFullscreenPresenter({
  title,
  subtitle,
  blocks,
  sourceLimitations,
  triggerLabel = "Present full screen",
}: PublishedStoryFullscreenPresenterProps) {
  const fs = useFullscreenPresentationMode();

  const ordered = useMemo(
    () =>
      [...blocks].sort((a, b) => {
        const ai = PRESENTATION_BLOCK_SLOT_ORDER.indexOf(a.slotId);
        const bi = PRESENTATION_BLOCK_SLOT_ORDER.indexOf(b.slotId);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }),
    [blocks],
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void fs.enter()}
        className="h-8 gap-1.5 border-[#1C1F3F]/25 bg-white text-[12px] text-[#1C1F3F] hover:bg-[#F1F1EC]"
        title="Present this published Story in full screen"
        aria-label="Present this published Story in full screen"
      >
        <Maximize2 className="h-3.5 w-3.5" />
        {triggerLabel}
      </Button>
      <FullscreenCanvas
        active={fs.isActive}
        mode={fs.mode}
        fallbackNotice={fs.fallbackNotice}
        containerRef={fs.containerRef}
        title={title}
        subtitle={subtitle ?? null}
        blocks={ordered}
        sourceLimitations={sourceLimitations ?? []}
        onExit={() => void fs.exit()}
      />
    </>
  );
}

interface FullscreenCanvasProps {
  active: boolean;
  mode: "off" | "browser" | "fallback";
  fallbackNotice: string | null;
  containerRef: React.RefObject<HTMLDivElement>;
  title: string;
  subtitle: string | null;
  blocks: RoadmapStoryPresentationBlock[];
  sourceLimitations: string[];
  onExit: () => void;
}

function FullscreenCanvas({
  active,
  mode,
  fallbackNotice,
  containerRef,
  title,
  subtitle,
  blocks,
  sourceLimitations,
  onExit,
}: FullscreenCanvasProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Reset scroll to top each time presentation mode opens.
  useEffect(() => {
    if (!active) return;
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [active]);

  // Global Esc handler — do NOT hijack arrow keys; native scrolling wins.
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onExit]);

  const backToTop = () => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const inner = (
    <div
      ref={containerRef}
      className={
        active
          ? "fixed inset-0 z-[9999] flex flex-col bg-[#0B1020] text-white"
          : "sr-only"
      }
      aria-hidden={!active}
    >
      {active && (
        <>
          <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[#0B1020]/95 px-6 py-3 backdrop-blur">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">
                Published Story · presentation mode
              </div>
              <div className="truncate text-[14px] font-semibold text-white">
                {title || "Roadmap Story"}
              </div>
              {subtitle && (
                <div className="truncate text-[11px] text-white/60">{subtitle}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={backToTop}
                className="h-8 gap-1.5 text-white hover:bg-white/10"
                aria-label="Scroll back to top"
              >
                <ArrowUp className="h-3.5 w-3.5" /> Top
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onExit}
                className="h-8 gap-1.5 text-white hover:bg-white/10"
                aria-label="Exit presentation mode"
              >
                {mode === "browser" ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                Exit
              </Button>
            </div>
          </header>
          {fallbackNotice && (
            <div className="px-6 pt-3">
              <Alert className="border-white/15 bg-white/5 text-white">
                <AlertDescription className="text-[11px] text-white/80">
                  {fallbackNotice}
                </AlertDescription>
              </Alert>
            </div>
          )}
          <div
            ref={scrollerRef}
            className="flex-1 overflow-y-auto overflow-x-hidden"
          >
            <main className="mx-auto max-w-7xl px-8 py-10 space-y-8">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">
                  Presentation
                </div>
                <h1 className="text-[32px] font-semibold tracking-tight text-white">
                  {title || "Roadmap Story"}
                </h1>
                {subtitle && (
                  <p className="mt-1 text-[14px] text-white/70">{subtitle}</p>
                )}
              </div>

              {blocks.length === 0 && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-white/70">
                  This Story has no visual blocks to present.
                </div>
              )}

              {blocks.map((block, i) => (
                <section
                  key={`${block.blockType}-${i}`}
                  className="rounded-lg bg-white text-[#1C1F3F] shadow-2xl"
                >
                  <div className="p-6">
                    <PresentationBlockRenderer block={block} />
                  </div>
                </section>
              ))}

              {sourceLimitations.length > 0 && (
                <section className="rounded-lg border border-white/10 bg-white/5 p-6 text-white/80">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-white/50 mb-2">
                    Source limitations
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[13px]">
                    {sourceLimitations.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="pt-6 text-center text-[11px] text-white/40">
                End of Story · Press <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">Esc</kbd> to exit
              </div>
            </main>
          </div>
        </>
      )}
    </div>
  );

  if (active && mode === "fallback" && typeof document !== "undefined") {
    return createPortal(inner, document.body);
  }
  return inner;
}
