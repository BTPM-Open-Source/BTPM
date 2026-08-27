/**
 * BTPM — Wave C3, Step C3.3
 *
 * Most-recently-completed-period resolver for Automatic KPI Snapshot Capture.
 *
 * This is a thin wrapper over the canonical
 * `supabase/functions/_shared/kpi/kpiPeriod.ts:resolveKpiPeriod` helper.
 * It does NOT implement parallel period math. Instead, it derives an
 * "anchor date" that is guaranteed to fall inside the previous completed
 * period for the given cadence, then delegates the actual period
 * boundaries to `resolveKpiPeriod`.
 *
 * Contract:
 *   - cadence in {weekly, monthly, quarterly, yearly} -> non-null period
 *   - cadence = manual_only -> { null, null }
 *   - unknown cadence -> { null, null }
 *
 * UTC-only. No Date.now() reads. Pure date logic.
 */

import {
  resolveKpiPeriod,
  type KpiCadence,
  type KpiPeriod,
} from "./kpiPeriod.ts";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function parseIsoDate(input: string): { y: number; m: number; d: number } {
  const m = ISO_DATE_RE.exec(input);
  if (!m) throw new Error(`Invalid ISO date: ${input}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toIso(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`;
}

function isoFromDate(date: Date): string {
  return toIso(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

/**
 * For the given cadence and `as_of_date`, return any date that is
 * guaranteed to lie strictly inside the previous *completed* period.
 * The canonical `resolveKpiPeriod` is then called with that anchor to
 * obtain the period boundaries.
 */
function previousPeriodAnchor(
  cadence: KpiCadence | string,
  asOfDate: string,
): string {
  const { y, m, d } = parseIsoDate(asOfDate);

  switch (cadence) {
    case "weekly": {
      // ISO week containing as_of_date is "current". Step back 7 days
      // from its Monday to land inside the previous completed week.
      const ref = new Date(Date.UTC(y, m - 1, d));
      const dow = ref.getUTCDay();
      const isoDow = dow === 0 ? 7 : dow;
      const monday = new Date(ref.getTime() - (isoDow - 1) * 86400000);
      const prev = new Date(monday.getTime() - 7 * 86400000);
      return isoFromDate(prev);
    }
    case "monthly": {
      // Day 0 of the current month = last day of the previous month.
      const prev = new Date(Date.UTC(y, m - 1, 0));
      return isoFromDate(prev);
    }
    case "quarterly": {
      // First day of current quarter, minus one day -> last day of prev quarter.
      const qIndex = Math.floor((m - 1) / 3); // 0..3
      const startMonth = qIndex * 3 + 1;
      const firstOfThisQuarter = new Date(Date.UTC(y, startMonth - 1, 1));
      const prev = new Date(firstOfThisQuarter.getTime() - 86400000);
      return isoFromDate(prev);
    }
    case "yearly": {
      // Dec 31 of previous year.
      return toIso(y - 1, 12, 31);
    }
    default:
      // manual_only / unknown — caller handles via resolveKpiPeriod's null.
      return asOfDate;
  }
}

/**
 * Resolve the most recently completed period for the given cadence,
 * anchored to `asOfDate` (UTC, "YYYY-MM-DD").
 *
 * Returns { null, null } for cadences that do not support periodic
 * automatic capture (manual_only, unknown).
 */
export function resolvePreviousCompletedKpiPeriod(
  cadence: KpiCadence | string | null | undefined,
  asOfDate: string,
): KpiPeriod {
  if (
    cadence === null ||
    cadence === undefined ||
    cadence === "manual_only"
  ) {
    return { periodStart: null, periodEnd: null };
  }
  if (
    cadence !== "weekly" &&
    cadence !== "monthly" &&
    cadence !== "quarterly" &&
    cadence !== "yearly"
  ) {
    return { periodStart: null, periodEnd: null };
  }
  const anchor = previousPeriodAnchor(cadence, asOfDate);
  return resolveKpiPeriod(cadence, anchor);
}
