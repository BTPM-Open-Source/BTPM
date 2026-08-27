/**
 * BTPM — Wave C3, Step C3.9i
 *
 * KPI Schedule Due Engine — read-only, deterministic.
 *
 * Answers, for a given schedule policy and UTC datetime:
 *   1. Which completed reporting period does the policy refer to?
 *   2. What is the scheduled run datetime (UTC)?
 *   3. Is the policy due right now?
 *
 * This module performs NO I/O. It does not read the database, call
 * external services, create snapshots, or write anything. It is a pure
 * date-logic helper consumed by the C3.9i `evaluate-kpi-schedule-policies`
 * dry-run Edge Function and (later) by C3.9k/C3.9l scheduler integrations.
 *
 * Period resolution delegates to the canonical helper
 *   supabase/functions/_shared/kpi/kpiPreviousPeriod.ts
 *   :resolvePreviousCompletedKpiPeriod
 * to keep period boundaries identical to automatic snapshot capture.
 *
 * Initial due-window rule (C3.9i):
 *   - policy.is_active === true, AND
 *   - scheduled_run_date (UTC) === as_of_date (UTC), AND
 *   - as_of_time (UTC) >= run_time_utc
 *   No catch-up windows, no business-day calendar, no missed-run recovery.
 */

import { resolvePreviousCompletedKpiPeriod } from "./kpiPreviousPeriod.ts";

export type SchedulePolicyCadence =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export type SchedulePolicyProcessType =
  | "automatic_snapshot_capture"
  | "kpi_app_auto_submit";

export interface KpiSchedulePolicyInput {
  /** Cadence governs reporting period (NOT the run timing). */
  cadence: SchedulePolicyCadence | string;
  /** Whole-day delay after period_end before the policy fires. */
  delay_days_after_period_close: number;
  /** UTC time of day "HH:MM" or "HH:MM:SS". */
  run_time_utc: string;
  /** Active flag. Inactive => is_due=false. */
  is_active: boolean;
}

export type ScheduleDueStatus =
  | "due"
  | "inactive"
  | "not_due_time_not_reached"
  | "not_due_scheduled_date_in_future"
  | "not_due_scheduled_date_passed"
  | "invalid_policy";

export interface ScheduleDueEvaluation {
  period_start: string | null;
  period_end: string | null;
  scheduled_run_at: string | null;
  is_due: boolean;
  due_status: ScheduleDueStatus;
  reason: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const SUPPORTED_CADENCES = new Set<SchedulePolicyCadence>([
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

/**
 * Parse "HH:MM" or "HH:MM:SS" into { hours, minutes, seconds }.
 * Returns null if invalid.
 */
function parseRunTimeUtc(
  s: string,
): { hours: number; minutes: number; seconds: number } | null {
  if (typeof s !== "string") return null;
  const m = RUN_TIME_RE.exec(s);
  if (!m) return null;
  return {
    hours: Number(m[1]),
    minutes: Number(m[2]),
    seconds: m[3] ? Number(m[3]) : 0,
  };
}

/** Add `days` whole UTC days to an ISO YYYY-MM-DD date and return ISO. */
function addUtcDays(isoDate: string, days: number): string {
  if (!ISO_DATE_RE.test(isoDate)) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  const t = Date.parse(isoDate + "T00:00:00Z");
  const d = new Date(t + days * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Compose UTC ISO datetime from a UTC date + run_time_utc.
 * Returns "YYYY-MM-DDTHH:MM:SSZ".
 */
function composeUtcIsoDateTime(
  dateUtc: string,
  runTime: { hours: number; minutes: number; seconds: number },
): string {
  const hh = String(runTime.hours).padStart(2, "0");
  const mm = String(runTime.minutes).padStart(2, "0");
  const ss = String(runTime.seconds).padStart(2, "0");
  return `${dateUtc}T${hh}:${mm}:${ss}Z`;
}

/**
 * Validate ISO datetime string and return the parsed Date (UTC). Returns
 * null if invalid. Accepts both "Z" and "+00:00" zero-offset forms.
 */
function parseAsOfDateTimeUtc(s: string): Date | null {
  if (typeof s !== "string" || s.length === 0) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Resolve the completed reporting period and scheduled run datetime for
 * a policy at a given as-of UTC datetime. Does NOT evaluate due-ness.
 *
 * Returns nulls when cadence is unsupported or run_time_utc is invalid.
 */
export function resolveScheduledPeriodForPolicy(
  policy: KpiSchedulePolicyInput,
  asOfDateTimeUtc: string,
): {
  period_start: string | null;
  period_end: string | null;
  scheduled_run_at: string | null;
} {
  const asOf = parseAsOfDateTimeUtc(asOfDateTimeUtc);
  if (!asOf) {
    return { period_start: null, period_end: null, scheduled_run_at: null };
  }
  if (!SUPPORTED_CADENCES.has(policy.cadence as SchedulePolicyCadence)) {
    return { period_start: null, period_end: null, scheduled_run_at: null };
  }
  const runTime = parseRunTimeUtc(policy.run_time_utc);
  if (!runTime) {
    return { period_start: null, period_end: null, scheduled_run_at: null };
  }
  if (
    !Number.isInteger(policy.delay_days_after_period_close) ||
    policy.delay_days_after_period_close < 0
  ) {
    return { period_start: null, period_end: null, scheduled_run_at: null };
  }

  const asOfDateIso = asOf.toISOString().slice(0, 10);
  const period = resolvePreviousCompletedKpiPeriod(
    policy.cadence,
    asOfDateIso,
  );
  if (!period.periodStart || !period.periodEnd) {
    return { period_start: null, period_end: null, scheduled_run_at: null };
  }

  const scheduledDate = addUtcDays(
    period.periodEnd,
    policy.delay_days_after_period_close,
  );
  const scheduledRunAt = composeUtcIsoDateTime(scheduledDate, runTime);

  return {
    period_start: period.periodStart,
    period_end: period.periodEnd,
    scheduled_run_at: scheduledRunAt,
  };
}

/**
 * Evaluate whether a schedule policy is due at the given UTC datetime.
 *
 * Initial rule (C3.9i):
 *   1. policy must be active
 *   2. scheduled_run_date (UTC) must equal as_of_date (UTC)
 *   3. as_of_time (UTC) must be >= run_time_utc
 */
export function evaluateKpiSchedulePolicyDue(
  policy: KpiSchedulePolicyInput,
  asOfDateTimeUtc: string,
): ScheduleDueEvaluation {
  // 1. Validate inputs
  const asOf = parseAsOfDateTimeUtc(asOfDateTimeUtc);
  if (!asOf) {
    return {
      period_start: null,
      period_end: null,
      scheduled_run_at: null,
      is_due: false,
      due_status: "invalid_policy",
      reason: "Invalid as_of_datetime_utc.",
    };
  }
  if (!SUPPORTED_CADENCES.has(policy.cadence as SchedulePolicyCadence)) {
    return {
      period_start: null,
      period_end: null,
      scheduled_run_at: null,
      is_due: false,
      due_status: "invalid_policy",
      reason: `Unsupported cadence: ${String(policy.cadence)}.`,
    };
  }
  const runTime = parseRunTimeUtc(policy.run_time_utc);
  if (!runTime) {
    return {
      period_start: null,
      period_end: null,
      scheduled_run_at: null,
      is_due: false,
      due_status: "invalid_policy",
      reason: "Invalid run_time_utc.",
    };
  }
  if (
    !Number.isInteger(policy.delay_days_after_period_close) ||
    policy.delay_days_after_period_close < 0
  ) {
    return {
      period_start: null,
      period_end: null,
      scheduled_run_at: null,
      is_due: false,
      due_status: "invalid_policy",
      reason: "Invalid delay_days_after_period_close.",
    };
  }

  const { period_start, period_end, scheduled_run_at } =
    resolveScheduledPeriodForPolicy(policy, asOfDateTimeUtc);

  if (!period_start || !period_end || !scheduled_run_at) {
    return {
      period_start,
      period_end,
      scheduled_run_at,
      is_due: false,
      due_status: "invalid_policy",
      reason: "Could not resolve completed reporting period.",
    };
  }

  // 2. Inactive short-circuit (still report period for context).
  if (!policy.is_active) {
    return {
      period_start,
      period_end,
      scheduled_run_at,
      is_due: false,
      due_status: "inactive",
      reason: "Policy is inactive.",
    };
  }

  // 3. Compare dates / times in UTC.
  const asOfDateUtc = asOf.toISOString().slice(0, 10);
  const scheduledDateUtc = scheduled_run_at.slice(0, 10);

  if (asOfDateUtc < scheduledDateUtc) {
    return {
      period_start,
      period_end,
      scheduled_run_at,
      is_due: false,
      due_status: "not_due_scheduled_date_in_future",
      reason: "Scheduled run date is in the future.",
    };
  }
  if (asOfDateUtc > scheduledDateUtc) {
    return {
      period_start,
      period_end,
      scheduled_run_at,
      is_due: false,
      due_status: "not_due_scheduled_date_passed",
      reason: "Scheduled run date has already passed.",
    };
  }

  // Same UTC date — compare time-of-day.
  const asOfMs = asOf.getTime();
  const scheduledMs = Date.parse(scheduled_run_at);
  if (asOfMs < scheduledMs) {
    return {
      period_start,
      period_end,
      scheduled_run_at,
      is_due: false,
      due_status: "not_due_time_not_reached",
      reason: "Scheduled run time has not been reached yet.",
    };
  }

  return {
    period_start,
    period_end,
    scheduled_run_at,
    is_due: true,
    due_status: "due",
    reason: `Scheduled run is due for the completed ${policy.cadence} period.`,
  };
}
