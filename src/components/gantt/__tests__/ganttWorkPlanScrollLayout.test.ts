import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * BTPM-UX-GANTT-SCROLL-C1 — layout contract.
 *
 * Focused, layout-only assertions: the Work plan surface must be height
 * constrained, controls must sit outside the scrolling row body, and the
 * Name column and the timeline must share ONE vertical scroll container.
 */
const gantt = readFileSync(
  resolve(__dirname, "../GanttChart.tsx"),
  "utf8",
);
const page = readFileSync(
  resolve(__dirname, "../../../pages/ProjectGantt.tsx"),
  "utf8",
);

describe("Work plan / Gantt scroll layout contract", () => {
  it("constrains the Work plan surface height instead of growing with rows", () => {
    expect(page).toContain("data-workplan-frame");
    expect(page).toContain("useAvailableHeight");
    expect(page).toMatch(/className="flex min-h-\[420px\] flex-col gap-3 overflow-hidden"/);
    // No row-count / project specific hard-coded height.
    expect(page).not.toMatch(/height:\s*\d+\s*\*/);
  });

  it("renders the Gantt root as a constrained vertical flex column", () => {
    expect(gantt).toContain('data-gantt-root className="flex h-full min-h-0 flex-col gap-3"');
  });

  it("keeps the instruction banner and filter controls outside the scroll body", () => {
    const scrollIdx = gantt.indexOf("data-gantt-scroll");
    const bannerIdx = gantt.indexOf("shrink-0 flex items-center gap-2 px-3 py-2 rounded-md bg-muted");
    const filtersIdx = gantt.indexOf("shrink-0 flex flex-wrap items-center gap-4");
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(filtersIdx).toBeGreaterThan(-1);
    expect(scrollIdx).toBeGreaterThan(filtersIdx);
    expect(scrollIdx).toBeGreaterThan(bannerIdx);
  });

  it("uses a single shared vertical scroll container for names and timeline", () => {
    expect(gantt).toContain(
      'data-gantt-scroll ref={scrollRef} className="flex-1 min-h-0 overflow-auto"',
    );
    // Exactly one vertical scroll container in the chart frame.
    expect(gantt.match(/data-gantt-scroll/g)).toHaveLength(1);
    // No nested Radix ScrollArea re-introducing a second scrollbar.
    expect(gantt).not.toContain("<ScrollArea");

    const scrollIdx = gantt.indexOf("data-gantt-scroll");
    const labelIdx = gantt.indexOf("data-gantt-label-column");
    const timelineIdx = gantt.indexOf("data-gantt-timeline-column");
    expect(labelIdx).toBeGreaterThan(scrollIdx);
    expect(timelineIdx).toBeGreaterThan(labelIdx);
  });

  it("keeps the Name header and the timeline date header sticky above the rows", () => {
    expect(gantt).toContain(
      'className="sticky top-0 z-10 bg-card h-[52px] flex items-end px-3 pb-2 border-b border-border"',
    );
    expect(gantt).toContain('data-gantt-timeline-header className="sticky top-0 z-10"');
    // Name column stays pinned while the timeline scrolls horizontally.
    expect(gantt).toContain("flex-shrink-0 sticky left-0 z-20 border-r border-border bg-card");
  });

  it("does not set any global body overflow rule", () => {
    expect(page).not.toContain("document.body.style.overflow");
    expect(gantt).not.toContain("document.body.style.overflow");
  });
});
