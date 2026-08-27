/**
 * Baseline UX helpers — pure utilities for comparing CURRENT planned dates
 * against the approved BASELINE. These do NOT track actual execution dates.
 *
 * Semantics:
 *   - currentStart / currentEnd = editable working planned dates
 *   - baselineStart / baselineEnd = approved frozen reference snapshot
 *   - variance = currentEnd - baselineEnd, in whole days
 *       positive = slipping later than baseline
 *       negative = pulled in earlier than baseline
 *       zero    = on baseline
 */

export function parseISODate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const parsed = new Date(d + "T00:00:00");
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

export interface VarianceResult {
  /** Days between current end and baseline end. null if either side missing. */
  endDays: number | null;
  /** Days between current start and baseline start. null if either side missing. */
  startDays: number | null;
}

export function computeVariance(
  currentStart: string | null | undefined,
  currentEnd: string | null | undefined,
  baselineStart: string | null | undefined,
  baselineEnd: string | null | undefined,
): VarianceResult {
  const cs = parseISODate(currentStart);
  const ce = parseISODate(currentEnd);
  const bs = parseISODate(baselineStart);
  const be = parseISODate(baselineEnd);
  return {
    startDays: cs && bs ? diffDays(bs, cs) : null,
    endDays: ce && be ? diffDays(be, ce) : null,
  };
}

/** "+3d", "-2d", "0d", or "—" when null. */
export function formatVarianceDays(d: number | null): string {
  if (d === null) return "—";
  if (d === 0) return "0d";
  return `${d > 0 ? "+" : ""}${d}d`;
}

/** Semantic tone classes for variance values. Uses design tokens only. */
export function varianceTone(d: number | null): string {
  if (d === null || d === 0) return "text-muted-foreground";
  return d > 0 ? "text-destructive" : "text-primary";
}

export function varianceLabel(d: number | null): string {
  if (d === null) return "No baseline reference";
  if (d === 0) return "On baseline";
  return d > 0 ? `${d} day${d === 1 ? "" : "s"} late vs baseline` : `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ahead of baseline`;
}

export function formatDate(d: string | null | undefined): string {
  return d || "—";
}
