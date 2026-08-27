/**
 * Phase 6B.7a.5 / 6B.7a.5b — Roadmap Story Presentation object-link primitives.
 *
 * Subtle in-app links from structured Story Pack object references to the
 * matching BTPM surface. When the ref cannot be resolved to a route (unknown
 * type / missing IDs), renders a plain non-clickable label — never a broken
 * link, never a raw UUID.
 *
 * Links never grant access; destination routes still enforce BTPM
 * permissions. See `roadmapStoryObjectLinks.ts`.
 *
 * 6B.7a.5b: Introduced `variant` so callers can choose a presentation-safe
 * treatment for dense visuals (Gantt, matrix, project cards) instead of the
 * aggressive bordered blue inline link. Also added a lightweight
 * `StoryBlockSourceLinks` accordion component that surfaces per-block
 * traceability links without cluttering the visual itself.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isExternalRoadmapStoryHref,
  resolveRoadmapStoryObjectHref,
  type RoadmapStoryObjectRef,
} from "@/lib/roadmap-story/roadmapStoryObjectLinks";

export type StoryObjectLinkVariant =
  /** Legacy Phase 6B.7a.5 bordered blue link. Kept for backward compatibility. */
  | "inline"
  /** Presentation-safe: muted, dotted underline on hover only. */
  | "subtle"
  /** Icon-only open action; `children` used as accessible label / tooltip. */
  | "icon"
  /** Small outlined chip. */
  | "chip";

export interface StoryObjectLinkProps {
  objectRef?: RoadmapStoryObjectRef | null;
  /** Visible label. Never the raw UUID. */
  children: React.ReactNode;
  className?: string;
  /** Tooltip override; defaults to a generic "Open source object". */
  title?: string;
  /** Show an ExternalLink icon after the label (external SharePoint files only). */
  showExternalIcon?: boolean;
  /** When true, unresolved refs render with a visible disabled affordance. */
  showMissingAffordance?: boolean;
  /**
   * Visual variant. Defaults to `subtle` — the presentation-safe treatment.
   * Callers that still want the strong bordered blue link must pass `inline`.
   */
  variant?: StoryObjectLinkVariant;
  /** Icon rendered for `icon` variant. Defaults to ExternalLink. */
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * Inline link primitive. Renders:
 *  - <Link> for internal BTPM routes,
 *  - <a target="_blank"> for safe external file webUrl,
 *  - plain <span> when no href resolves.
 */
export function StoryObjectLink({
  objectRef,
  children,
  className,
  title,
  showExternalIcon = true,
  showMissingAffordance = false,
  variant = "subtle",
  icon: IconComp = ExternalLink,
}: StoryObjectLinkProps) {
  const href = resolveRoadmapStoryObjectHref(objectRef);
  const isExternal = isExternalRoadmapStoryHref(objectRef);
  const tooltip = title ?? (href ? "Open source object" : undefined);

  if (!href) {
    if (variant === "icon" || variant === "chip") return null;
    if (!showMissingAffordance) return <span className={className}>{children}</span>;
    return (
      <span
        className={cn(
          "inline-block max-w-full text-[#516490]",
          className,
        )}
        title={title ?? "No source link available for this item"}
      >
        {children}
      </span>
    );
  }

  const linkClass = (() => {
    switch (variant) {
      case "inline":
        return cn(
          "inline-block max-w-full border-b-2 border-[#0057B8] pb-[1px] font-semibold leading-[1.15] text-[#0057B8] no-underline transition-colors hover:border-[#003A78] hover:text-[#003A78] cursor-pointer",
          className,
        );
      case "icon":
        return cn(
          "inline-flex items-center justify-center rounded-sm p-0.5 text-[#516490] hover:text-[#0057B8] hover:bg-[#0057B8]/[0.06] transition-colors cursor-pointer",
          className,
        );
      case "chip":
        return cn(
          "inline-flex items-center gap-1 rounded-full border border-[#E1E1DC] bg-white px-2 py-0.5 text-[11px] text-[#1C1F3F] hover:border-[#0057B8]/40 hover:text-[#0057B8] transition-colors cursor-pointer no-underline",
          className,
        );
      case "subtle":
      default:
        return cn(
          "inline text-inherit no-underline hover:underline hover:decoration-[#0057B8]/60 hover:decoration-dotted hover:underline-offset-2 hover:text-[#0057B8] cursor-pointer transition-colors",
          className,
        );
    }
  })();

  const renderBody = () => {
    if (variant === "icon") {
      return <IconComp className="h-3.5 w-3.5" aria-hidden />;
    }
    if (variant === "chip") {
      return (
        <>
          <span className="truncate">{children}</span>
          <IconComp className="h-3 w-3 opacity-70" aria-hidden />
        </>
      );
    }
    return (
      <>
        {children}
        {isExternal && showExternalIcon && (
          <ExternalLink
            className="ml-0.5 inline-block h-3 w-3 align-[-1px] opacity-70"
            aria-hidden
          />
        )}
      </>
    );
  };

  const a11yTitle = variant === "icon" && typeof children === "string" ? `Open ${children}` : tooltip;

  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        title={a11yTitle}
        aria-label={variant === "icon" && typeof children === "string" ? `Open ${children}` : undefined}
      >
        {renderBody()}
      </a>
    );
  }

  return (
    <Link
      to={href}
      className={linkClass}
      title={a11yTitle}
      aria-label={variant === "icon" && typeof children === "string" ? `Open ${children}` : undefined}
    >
      {renderBody()}
    </Link>
  );
}

// ─── Source-links accordion ───────────────────────────────────────────────
/**
 * Collapsed-by-default per-block traceability accordion. Renders only when
 * at least one entry has a resolvable objectRef. Groups entries by kind and
 * caps each group to `INITIAL_PER_GROUP` with a "Show more" toggle. Never
 * fabricates labels or URLs — labels come from the passed entries; URLs
 * come from the object-link resolver.
 */
export interface StoryBlockSourceLinkEntry {
  label: string;
  objectRef?: RoadmapStoryObjectRef | null;
}

export interface StoryBlockSourceLinksGroup {
  key: "projects" | "risks" | "decisions" | "kpis" | "files" | "phases" | "tasks";
  title: string;
  entries: StoryBlockSourceLinkEntry[];
}

const GROUP_TITLES: Record<StoryBlockSourceLinksGroup["key"], string> = {
  projects: "Projects",
  phases: "Phases",
  tasks: "Tasks",
  risks: "Risks & Blockers",
  decisions: "Decisions / Governance",
  kpis: "KPIs",
  files: "Files",
};

export function StoryBlockSourceLinks({
  groups,
  className,
}: {
  groups: StoryBlockSourceLinksGroup[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filter to resolvable entries; dedupe by resolved href within a group.
  const cleaned = groups
    .map((g) => {
      const seen = new Set<string>();
      const entries = g.entries.filter((e) => {
        const href = resolveRoadmapStoryObjectHref(e.objectRef ?? undefined);
        if (!href) return false;
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      });
      return { ...g, title: g.title || GROUP_TITLES[g.key], entries };
    })
    .filter((g) => g.entries.length > 0);

  if (cleaned.length === 0) return null;
  const total = cleaned.reduce((n, g) => n + g.entries.length, 0);
  const INITIAL_PER_GROUP = 5;

  return (
    <div className={cn("mt-3 rounded-md border border-[#E1E1DC] bg-white", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#516490] hover:text-[#1C1F3F]"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Source links
          <span className="ml-1 rounded-sm bg-[#F2F2F2] px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[#516490]">
            {total}
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-[#E1E1DC] px-3 py-2 space-y-2">
          {cleaned.map((g) => {
            const isExpanded = expanded.has(g.key);
            const visible = isExpanded ? g.entries : g.entries.slice(0, INITIAL_PER_GROUP);
            const remaining = g.entries.length - visible.length;
            return (
              <div key={g.key}>
                <div className="text-[10px] uppercase tracking-[0.10em] font-semibold text-[#516490] mb-1">
                  {g.title}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {visible.map((e, i) => (
                    <StoryObjectLink
                      key={i}
                      objectRef={e.objectRef}
                      variant="chip"
                    >
                      {e.label}
                    </StoryObjectLink>
                  ))}
                </div>
                {(remaining > 0 || (isExpanded && g.entries.length > INITIAL_PER_GROUP)) && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      })
                    }
                    className="mt-1 text-[10px] text-[#516490] hover:text-[#1C1F3F] underline decoration-dotted underline-offset-2"
                  >
                    {isExpanded ? "Show less" : `Show ${remaining} more`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
