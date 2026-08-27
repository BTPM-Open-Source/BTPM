/**
 * BTPM — Wave C1, Step C1.6
 * KPI period resolution utility.
 *
 * Pure date-only logic. Snapshot date is an explicit input — no
 * Date.now() reads. All math uses UTC midnight to avoid timezone drift.
 *
 * Cadences mirror kpi_definitions.cadence:
 *   manual_only | weekly | monthly | quarterly | yearly
 *
 * Returns ISO "YYYY-MM-DD" strings or null for manual_only.
 */

export type KpiCadence =
  | "manual_only"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export interface KpiPeriod {
  /** First day of the period, inclusive ("YYYY-MM-DD"). */
  periodStart: string | null;
  /** Last day of the period, inclusive ("YYYY-MM-DD"). */
  periodEnd: string | null;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function parseIsoDate(input: string): { y: number; m: number; d: number } {
  const m = ISO_DATE_RE.exec(input);
  if (!m) throw new Error(`Invalid ISO date: ${input}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toIso(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function isoFromDate(date: Date): string {
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Resolve the period [start,end] for a snapshot date and cadence.
 *
 * - manual_only: { null, null }
 * - weekly: ISO week (Monday → Sunday) containing snapshot_date
 * - monthly: first → last day of the calendar month
 * - quarterly: first → last day of the calendar quarter
 * - yearly: Jan 1 → Dec 31 of the calendar year
 */
export function resolveKpiPeriod(
  cadence: KpiCadence | string | null | undefined,
  snapshotDate: string,
): KpiPeriod {
  const { y, m, d } = parseIsoDate(snapshotDate);

  switch (cadence) {
    case "manual_only":
    case null:
    case undefined:
      return { periodStart: null, periodEnd: null };

    case "weekly": {
      const ref = utc(y, m, d);
      // ISO weekday: Mon=1..Sun=7. JS getUTCDay: Sun=0..Sat=6 → convert.
      const dow = ref.getUTCDay();
      const isoDow = dow === 0 ? 7 : dow;
      const monday = new Date(ref.getTime() - (isoDow - 1) * 86400000);
      const sunday = new Date(monday.getTime() + 6 * 86400000);
      return { periodStart: isoFromDate(monday), periodEnd: isoFromDate(sunday) };
    }

    case "monthly": {
      const start = utc(y, m, 1);
      // Day 0 of next month = last day of this month
      const end = new Date(Date.UTC(y, m, 0));
      return { periodStart: isoFromDate(start), periodEnd: isoFromDate(end) };
    }

    case "quarterly": {
      const qIndex = Math.floor((m - 1) / 3); // 0..3
      const startMonth = qIndex * 3 + 1;
      const start = utc(y, startMonth, 1);
      const endMonth = startMonth + 2;
      const end = new Date(Date.UTC(y, endMonth, 0));
      return { periodStart: isoFromDate(start), periodEnd: isoFromDate(end) };
    }

    case "yearly":
      return { periodStart: toIso(y, 1, 1), periodEnd: toIso(y, 12, 31) };

    default:
      // Unknown cadence — treat as manual_only (no period anchoring).
      return { periodStart: null, periodEnd: null };
  }
}

/**
 * Returns true when the snapshot row's period covers the snapshotDate
 * for the given cadence. Used by stale/due helpers.
 */
export function snapshotCoversDate(
  snapshot: { period_start: string | null; period_end: string | null },
  cadence: KpiCadence | string | null | undefined,
  date: string,
): boolean {
  if (cadence === "manual_only" || !cadence) {
    // Manual-only KPIs are never "due" by period — coverage is informational only.
    return snapshot.period_start === null && snapshot.period_end === null;
  }
  if (!snapshot.period_start || !snapshot.period_end) return false;
  return snapshot.period_start <= date && date <= snapshot.period_end;
}
