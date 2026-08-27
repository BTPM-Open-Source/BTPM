/**
 * BTPM — Wave C1, Step C1.8
 * KPI Readiness Helper (pure).
 *
 * Single source of truth for KPI readiness state used by Project KPIs UX
 * and any future internal admin/reporting surfaces.
 *
 * Pure module:
 *   - No Supabase, React, or UI imports.
 *   - Reference date is an EXPLICIT input — never reads `Date.now()`.
 *   - Reads existing kpi_snapshots rows; never writes.
 *
 * Hard rules (carried from C1.6/6a/6b/7):
 *   - Never insert into kpi_snapshots from the client.
 *   - Never trigger capture-kpi-snapshot from this helper.
 *   - schedule_signal remains NOT trustworthy for downstream reporting
 *     until canonical ReportingScheduleSignal is wired (C1.6b §9).
 *     This helper exposes that limitation via `reportable=false` +
 *     `reportableReason` when latest snapshot is the no-basis fallback.
 */

import {
  resolveKpiPeriod,
  snapshotCoversDate,
  type KpiCadence,
  type KpiPeriod,
} from "./kpiPeriod";

// ---------- Inputs ----------

/** Snapshot row shape we depend on (subset of list_decrypted_kpi_snapshots). */
export interface KpiReadinessSnapshot {
  id: string;
  kpi_definition_id: string;
  snapshot_date: string;
  period_start: string | null;
  period_end: string | null;
  source_mode: string; // "manual" | "automatic"
  value_type: string;  // "percent" | "number" | "currency" | "text"
  value_amount: number | null;
  string_value: string | null;
  calculation_status: string;
  generated_by: string;
  comment: string | null;
  action_plan: string | null;
  calculation_key: string | null;
  formula_version: number | null;
  created_at: string;
}

/** KPI definition fields the helper needs. Shape mirrors kpi_definitions. */
export interface KpiReadinessDefinition {
  id: string;
  name: string;
  source_mode: string | null;
  value_type: string | null;
  cadence: string | null;
  is_archived: boolean | null;
  comment_required?: boolean | null;
  action_plan_required?: boolean | null;
  calculation_key?: string | null;
  formula_version?: number | null;
  unit?: string | null;
}

// ---------- Output ----------

/** Controlled internal status union (do not extend casually). */
export type KpiReadinessStatus =
  | "up_to_date"
  | "due"
  | "overdue"
  | "no_snapshot"
  | "manual_only"
  | "not_configured"
  | "archived";

export interface KpiReadinessResult {
  kpiDefinitionId: string;
  kpiName: string;

  // Definition echo (for downstream rendering without re-lookup).
  sourceMode: "manual" | "automatic" | "unknown";
  valueType: "percent" | "number" | "currency" | "text" | "unknown";
  cadence: KpiCadence | "unknown";
  isArchived: boolean;

  // Status.
  readinessStatus: KpiReadinessStatus;
  readinessLabel: string;
  /** Why the status is `due` / `overdue` / `no_snapshot`. Null when up_to_date / manual_only / archived / not_configured. */
  staleReason: string | null;

  // Period.
  currentExpectedPeriod: KpiPeriod;

  // Snapshot lookup.
  latestSnapshot: KpiReadinessSnapshot | null;
  hasCurrentPeriodSnapshot: boolean;
  latestSnapshotDate: string | null;
  /** Latest snapshot's value formatted for display, or null if no value. */
  latestValueDisplay: string | null;
  /** Latest snapshot's calculation_status, or null. */
  calculationStatus: string | null;

  // Reportability.
  /** True when latest snapshot carries a usable value (numeric not null, or text non-empty) AND is not a known no-basis fallback (e.g. schedule_signal no_schedule_basis). */
  reportable: boolean;
  /** Human reason when `reportable=false`. */
  reportableReason: string | null;
}

// ---------- Labels ----------

const READINESS_LABELS: Record<KpiReadinessStatus, string> = {
  up_to_date: "Up to date",
  due: "Due",
  overdue: "Overdue",
  no_snapshot: "No snapshot yet",
  manual_only: "Manual only",
  not_configured: "Not configured",
  archived: "Archived",
};

export function readinessLabel(status: KpiReadinessStatus): string {
  return READINESS_LABELS[status];
}

const NON_REPORTABLE_CALC_STATUSES = new Set([
  "no_source_data",
  "insufficient_date_basis",
  "not_applicable",
  "error",
]);

// ---------- Value display ----------

/**
 * Format a snapshot's value for display, respecting value_type and the
 * "no misleading zero" rule. Returns null if there is no value at all
 * (in which case the UI should show the calculation_status instead).
 */
export function formatKpiSnapshotValue(
  snapshot: Pick<KpiReadinessSnapshot, "value_amount" | "string_value" | "value_type" | "calculation_status">,
  unit?: string | null,
): string | null {
  // No-basis statuses must not render as 0 even if value_amount happens
  // to be null. Caller should display the calculation_status instead.
  if (NON_REPORTABLE_CALC_STATUSES.has(snapshot.calculation_status)) {
    return null;
  }
  switch (snapshot.value_type) {
    case "percent":
      if (snapshot.value_amount == null) return null;
      return `${formatNumber(snapshot.value_amount)}%`;
    case "currency":
      if (snapshot.value_amount == null) return null;
      return unit
        ? `${formatNumber(snapshot.value_amount)} ${unit}`
        : `${formatNumber(snapshot.value_amount)}`;
    case "number":
      if (snapshot.value_amount == null) return null;
      return unit
        ? `${formatNumber(snapshot.value_amount)} ${unit}`
        : `${formatNumber(snapshot.value_amount)}`;
    case "text":
      if (snapshot.string_value == null || snapshot.string_value === "") return null;
      return snapshot.string_value;
    default:
      if (snapshot.value_amount != null) return `${formatNumber(snapshot.value_amount)}`;
      if (snapshot.string_value) return snapshot.string_value;
      return null;
  }
}

function formatNumber(n: number): string {
  // Trim trailing zeros for tidy display; preserve up to 2 decimals.
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
}

// ---------- Core ----------

function pickLatest(snapshots: ReadonlyArray<KpiReadinessSnapshot>): KpiReadinessSnapshot | null {
  if (snapshots.length === 0) return null;
  let best = snapshots[0];
  for (const s of snapshots) {
    if (s.snapshot_date > best.snapshot_date) best = s;
    else if (s.snapshot_date === best.snapshot_date && s.created_at > best.created_at) best = s;
  }
  return best;
}

/** Filter snapshots that fall in the current expected period. */
function snapshotInCurrentPeriod(
  snapshot: KpiReadinessSnapshot,
  cadence: KpiCadence,
  referenceDate: string,
): boolean {
  return snapshotCoversDate(
    { period_start: snapshot.period_start, period_end: snapshot.period_end },
    cadence,
    referenceDate,
  );
}

function normalizeCadence(c: string | null | undefined): KpiCadence | "unknown" {
  switch (c) {
    case "manual_only":
    case "weekly":
    case "monthly":
    case "quarterly":
    case "yearly":
      return c;
    default:
      return "unknown";
  }
}

function normalizeSourceMode(m: string | null | undefined): "manual" | "automatic" | "unknown" {
  if (m === "manual" || m === "automatic") return m;
  return "unknown";
}

function normalizeValueType(v: string | null | undefined): KpiReadinessResult["valueType"] {
  if (v === "percent" || v === "number" || v === "currency" || v === "text") return v;
  return "unknown";
}

/**
 * Compute readiness for ONE KPI definition given its snapshot history
 * (already fetched via list_decrypted_kpi_snapshots and pre-filtered to
 * snapshots for this kpi_definition_id, OR the full project list — the
 * helper filters defensively).
 */
export function evaluateKpiReadiness(
  def: KpiReadinessDefinition,
  snapshots: ReadonlyArray<KpiReadinessSnapshot>,
  referenceDate: string,
): KpiReadinessResult {
  const sourceMode = normalizeSourceMode(def.source_mode);
  const valueType = normalizeValueType(def.value_type);
  const cadence = normalizeCadence(def.cadence);
  const isArchived = !!def.is_archived;

  // Defensive filter: caller may pass the whole project's snapshot list.
  const ownSnapshots = snapshots.filter((s) => s.kpi_definition_id === def.id);
  const latest = pickLatest(ownSnapshots);
  const currentExpectedPeriod =
    cadence === "unknown"
      ? { periodStart: null, periodEnd: null }
      : resolveKpiPeriod(cadence, referenceDate);

  const hasCurrentPeriodSnapshot =
    cadence !== "unknown" && cadence !== "manual_only" && latest
      ? snapshotInCurrentPeriod(latest, cadence, referenceDate) ||
        ownSnapshots.some((s) => snapshotInCurrentPeriod(s, cadence, referenceDate))
      : false;

  // ----- Status logic -----
  let status: KpiReadinessStatus;
  let staleReason: string | null = null;

  if (isArchived) {
    status = "archived";
  } else if (cadence === "unknown") {
    status = "not_configured";
  } else if (cadence === "manual_only") {
    // Manual_only KPIs are never "due" by period.
    status = latest ? "up_to_date" : "manual_only";
  } else if (!latest) {
    status = "no_snapshot";
    staleReason = `No official snapshot has been captured for this ${cadence} KPI.`;
  } else if (hasCurrentPeriodSnapshot) {
    status = "up_to_date";
  } else {
    // Latest snapshot exists but does not cover current period.
    // Decide due vs overdue using the END of the *previous* period of
    // the same cadence relative to the reference date.
    if (
      currentExpectedPeriod.periodEnd &&
      referenceDate > currentExpectedPeriod.periodEnd
    ) {
      // Reference date is past the end of the current expected period
      // (rare, but possible if reference date is in the future).
      status = "overdue";
      staleReason = `Latest snapshot (${latest.snapshot_date}) does not cover the expected period ending ${currentExpectedPeriod.periodEnd}.`;
    } else {
      status = "due";
      staleReason = `Latest snapshot (${latest.snapshot_date}) is from a previous ${cadence} period.`;
    }
  }

  // ----- Reportability -----
  let reportable = false;
  let reportableReason: string | null = null;

  if (!latest) {
    reportableReason = "No official snapshot exists yet.";
  } else if (NON_REPORTABLE_CALC_STATUSES.has(latest.calculation_status)) {
    reportable = false;
    reportableReason = `Latest snapshot has calculation_status="${latest.calculation_status}".`;
  } else {
    // Calculated or manual_entry. Check the value itself.
    if (valueType === "text") {
      reportable = !!(latest.string_value && latest.string_value.trim() !== "");
      if (!reportable) reportableReason = "Latest text snapshot has no value.";
    } else {
      // Numeric / percent / currency / unknown numeric default.
      reportable = latest.value_amount !== null && latest.value_amount !== undefined;
      if (!reportable) reportableReason = "Latest numeric snapshot has no value.";
    }
    // schedule_signal C1.6b/C1.7 carve-out: even a "calculated" row is
    // only as good as its canonical schedule basis. The engine returns
    // status="not_applicable" with stringValue="no_schedule_basis"
    // when reportingSummary is unwired — that path is already caught
    // above by NON_REPORTABLE_CALC_STATUSES. Nothing to add here, but
    // we surface the policy in reportableReason if the value is the
    // literal "no_schedule_basis" sentinel.
    if (
      reportable &&
      (def.calculation_key === "schedule_signal") &&
      latest.string_value === "no_schedule_basis"
    ) {
      reportable = false;
      reportableReason =
        "schedule_signal returned no_schedule_basis (canonical reporting summary not wired — see C1.6b).";
    }
  }

  return {
    kpiDefinitionId: def.id,
    kpiName: def.name,
    sourceMode,
    valueType,
    cadence,
    isArchived,
    readinessStatus: status,
    readinessLabel: readinessLabel(status),
    staleReason,
    currentExpectedPeriod,
    latestSnapshot: latest,
    hasCurrentPeriodSnapshot,
    latestSnapshotDate: latest?.snapshot_date ?? null,
    latestValueDisplay: latest
      ? formatKpiSnapshotValue(latest, def.unit ?? null)
      : null,
    calculationStatus: latest?.calculation_status ?? null,
    reportable,
    reportableReason,
  };
}

/** Bulk evaluate readiness for many KPIs sharing the same project snapshot pool. */
export function evaluateProjectKpiReadiness(
  defs: ReadonlyArray<KpiReadinessDefinition>,
  projectSnapshots: ReadonlyArray<KpiReadinessSnapshot>,
  referenceDate: string,
): KpiReadinessResult[] {
  return defs.map((d) => evaluateKpiReadiness(d, projectSnapshots, referenceDate));
}

// ---------- Summary roll-up ----------

export interface KpiReadinessSummary {
  total: number;
  upToDate: number;
  due: number;
  overdue: number;
  noSnapshot: number;
  manualOnly: number;
  notConfigured: number;
  archived: number;
  reportable: number;
  notReportable: number;
}

export function summarizeReadiness(
  results: ReadonlyArray<KpiReadinessResult>,
): KpiReadinessSummary {
  const s: KpiReadinessSummary = {
    total: results.length,
    upToDate: 0,
    due: 0,
    overdue: 0,
    noSnapshot: 0,
    manualOnly: 0,
    notConfigured: 0,
    archived: 0,
    reportable: 0,
    notReportable: 0,
  };
  for (const r of results) {
    switch (r.readinessStatus) {
      case "up_to_date": s.upToDate += 1; break;
      case "due": s.due += 1; break;
      case "overdue": s.overdue += 1; break;
      case "no_snapshot": s.noSnapshot += 1; break;
      case "manual_only": s.manualOnly += 1; break;
      case "not_configured": s.notConfigured += 1; break;
      case "archived": s.archived += 1; break;
    }
    // Reportability is meaningful only for non-archived KPIs.
    if (r.readinessStatus === "archived") continue;
    if (r.reportable) s.reportable += 1;
    else s.notReportable += 1;
  }
  return s;
}
