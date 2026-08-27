/**
 * BTPM — Wave C1, Step C1.4
 * KPI Calculation Engine (pure, deterministic).
 *
 * Implements live calculation logic for the 13 controlled automatic KPI
 * calculation keys defined in C1.3. Does NOT persist results, does NOT
 * touch the database, does NOT touch UI.
 *
 * Rules enforced here:
 *   - Snapshot date is an EXPLICIT input (no hidden Date.now()).
 *   - Missing/insufficient data returns a typed no-basis status — never throws.
 *   - schedule_signal REUSES the canonical ReportingScheduleSignal from
 *     src/lib/reportingSummary.ts (no second derivation algorithm).
 *   - completion_vs_time_gap uses the completion_method selector and
 *     defaults null → "task_count" (v1).
 *   - Percent values are 0–100 scale, rounded to 2 decimals.
 *   - Counts and day deltas are integers.
 */

// NOTE (C1.6a): relative .ts imports — see kpiCalculationTypes.ts header.
import {
  getAutomaticKpiDefinition,
  type AutomaticKpiCalculationKey,
  type AutomaticKpiDefinition,
} from "./automaticKpiLibrary.ts";
import type {
  KpiCalculationInput,
  KpiCalculationOptions,
  KpiCalculationRequest,
  KpiCalculationResult,
  KpiCompletionMethod,
  KpiPhaseInput,
  KpiTaskInput,
} from "./kpiCalculationTypes.ts";

// ---------- Internal helpers ----------

const PERCENT_DECIMALS = 2;

function round(value: number, decimals: number = PERCENT_DECIMALS): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Parse an ISO date/timestamp into UTC midnight ms. Returns null on failure. */
function parseDateUtc(input: string | null | undefined): number | null {
  if (!input) return null;
  // Accept either "YYYY-MM-DD" or full ISO. Normalize to UTC midnight for date math.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (!m) {
    const t = Date.parse(input);
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    return Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
    );
  }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const MS_PER_DAY = 86_400_000;

function daysBetween(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / MS_PER_DAY);
}

// ---------- Lifecycle/scope predicates (mirror live repo conventions) ----------

function isExcluded(item: { status: string | null; isArchived?: boolean }): boolean {
  if (item.isArchived) return true;
  return item.status === "cancelled";
}

function isCompleted(item: { status: string | null }): boolean {
  return item.status === "completed";
}

function isOpen(item: { status: string | null; isArchived?: boolean }): boolean {
  if (isExcluded(item)) return false;
  return !isCompleted(item);
}

function isMilestone(task: KpiTaskInput): boolean {
  return task.taskType === "milestone";
}

function isBlockerOpen(status: string): boolean {
  return status === "open" || status === "in_progress";
}

function isRiskActive(status: string): boolean {
  // Wave 5.6 canonical active = open + under_mitigation
  // (legacy back-compat: identified, mitigating)
  return (
    status === "open" ||
    status === "under_mitigation" ||
    status === "identified" ||
    status === "mitigating"
  );
}

function isHighImpact(impact: string): boolean {
  return impact === "high" || impact === "critical";
}

/** Returns the most reliable per-task due/planned-end basis. */
function taskDueBasis(task: KpiTaskInput): string | null {
  return task.dueDate ?? task.baselineEndDate ?? null;
}

function taskPlannedEndBasis(task: KpiTaskInput): string | null {
  // For on-time check we prefer baseline > due > null
  return task.baselineEndDate ?? task.dueDate ?? null;
}

function inProjectScope(
  targetType: string,
  targetId: string,
  projectId: string,
  phaseIds: ReadonlySet<string>,
  taskIds: ReadonlySet<string>,
): boolean {
  if (targetType === "project") return targetId === projectId;
  if (targetType === "phase") return phaseIds.has(targetId);
  if (targetType === "task") return taskIds.has(targetId);
  return false;
}

// ---------- Result builders ----------

function buildResult(
  def: AutomaticKpiDefinition,
  options: KpiCalculationOptions | undefined,
  snapshotDate: string,
  partial: {
    valueAmount?: number | null;
    stringValue?: string | null;
    calculationStatus: KpiCalculationResult["calculationStatus"];
    calculationMessage?: string | null;
    completionMethod?: KpiCompletionMethod | null;
    sourceSummary?: KpiCalculationResult["sourceSummary"];
  },
): KpiCalculationResult {
  return {
    calculationKey: def.calculationKey,
    valueType: def.valueType,
    sourceMode: "automatic",
    valueAmount: partial.valueAmount ?? null,
    stringValue: partial.stringValue ?? null,
    calculationStatus: partial.calculationStatus,
    calculationMessage: partial.calculationMessage ?? null,
    formulaVersion: options?.formulaVersion ?? def.defaultFormulaVersion,
    completionMethod: partial.completionMethod ?? null,
    snapshotDate,
    sourceSummary: partial.sourceSummary,
  };
}

// ---------- Individual KPI calculators ----------

function calcTaskCountCompletion(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const inScope = input.tasks.filter((t) => !isExcluded(t));
  if (inScope.length === 0) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "no_source_data",
      calculationMessage: "Project has no non-cancelled tasks.",
      sourceSummary: { total: 0, completed: 0 },
    });
  }
  const completed = inScope.filter(isCompleted).length;
  const pct = round((completed / inScope.length) * 100);
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: pct,
    calculationStatus: "calculated",
    sourceSummary: { total: inScope.length, completed },
  });
}

function calcDurationWeightedCompletion(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const inScope = input.tasks.filter((t) => !isExcluded(t));
  if (inScope.length === 0) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "no_source_data",
      calculationMessage: "Project has no non-cancelled tasks.",
    });
  }
  let totalDuration = 0;
  let completedDuration = 0;
  for (const t of inScope) {
    const startMs = parseDateUtc(t.plannedStartDate);
    const endMs = parseDateUtc(t.dueDate ?? t.baselineEndDate);
    if (startMs === null || endMs === null || endMs < startMs) {
      return buildResult(def, options, input.snapshotDate, {
        calculationStatus: "insufficient_date_basis",
        calculationMessage:
          "One or more in-scope tasks lack the planned start/end basis required for duration weighting.",
        sourceSummary: { total: inScope.length },
      });
    }
    const duration = Math.max(1, daysBetween(startMs, endMs) + 1);
    totalDuration += duration;
    if (isCompleted(t)) completedDuration += duration;
  }
  if (totalDuration === 0) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "insufficient_date_basis",
      calculationMessage: "Total planned duration is zero.",
    });
  }
  const pct = round((completedDuration / totalDuration) * 100);
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: pct,
    calculationStatus: "calculated",
    sourceSummary: {
      total_duration_days: totalDuration,
      completed_duration_days: completedDuration,
    },
  });
}

function calcMilestoneCompletion(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const milestones = input.tasks.filter(
    (t) => !isExcluded(t) && isMilestone(t),
  );
  if (milestones.length === 0) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "not_applicable",
      calculationMessage: "Project has no milestone tasks.",
    });
  }
  const completed = milestones.filter(isCompleted).length;
  const pct = round((completed / milestones.length) * 100);
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: pct,
    calculationStatus: "calculated",
    sourceSummary: { milestone_total: milestones.length, milestone_completed: completed },
  });
}

function calcPhaseCompletion(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const inScope = input.phases.filter((p: KpiPhaseInput) => !isExcluded(p));
  if (inScope.length === 0) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "no_source_data",
      calculationMessage: "Project has no non-cancelled phases.",
    });
  }
  const completed = inScope.filter(isCompleted).length;
  const pct = round((completed / inScope.length) * 100);
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: pct,
    calculationStatus: "calculated",
    sourceSummary: { phase_total: inScope.length, phase_completed: completed },
  });
}

function calcTimeElapsedPercent(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const startMs = parseDateUtc(input.project.plannedStartDate);
  const endMs = parseDateUtc(input.project.targetEndDate);
  const snapMs = parseDateUtc(input.snapshotDate);
  if (startMs === null || endMs === null || snapMs === null || endMs < startMs) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "insufficient_date_basis",
      calculationMessage:
        "Project planned start, planned end, or snapshot date is missing/invalid.",
    });
  }
  if (snapMs <= startMs) {
    return buildResult(def, options, input.snapshotDate, {
      valueAmount: 0,
      calculationStatus: "calculated",
    });
  }
  const totalDays = Math.max(1, daysBetween(startMs, endMs) + 1);
  const elapsedDays = daysBetween(startMs, snapMs) + 1;
  // Do not clamp upper bound — schedule consumption may exceed 100%.
  const pct = round((elapsedDays / totalDays) * 100);
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: pct,
    calculationStatus: "calculated",
    sourceSummary: { total_days: totalDays, elapsed_days: elapsedDays },
  });
}

function calcCompletionVsTimeGap(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const method: KpiCompletionMethod = options?.completionMethod ?? "task_count";
  const completionDef =
    method === "duration_weighted"
      ? getAutomaticKpiDefinition("duration_weighted_completion_percent")
      : getAutomaticKpiDefinition("task_count_completion_percent");
  const completion =
    method === "duration_weighted"
      ? calcDurationWeightedCompletion(completionDef, input, undefined)
      : calcTaskCountCompletion(completionDef, input, undefined);
  const elapsed = calcTimeElapsedPercent(
    getAutomaticKpiDefinition("time_elapsed_percent"),
    input,
    undefined,
  );
  if (completion.calculationStatus !== "calculated") {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus:
        completion.calculationStatus === "no_source_data"
          ? "no_source_data"
          : "insufficient_date_basis",
      calculationMessage: `Completion (${method}) has no basis: ${completion.calculationStatus}.`,
      completionMethod: method,
    });
  }
  if (elapsed.calculationStatus !== "calculated") {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "insufficient_date_basis",
      calculationMessage: "Time elapsed has no basis.",
      completionMethod: method,
    });
  }
  const gap = round((completion.valueAmount ?? 0) - (elapsed.valueAmount ?? 0));
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: gap,
    calculationStatus: "calculated",
    completionMethod: method,
    sourceSummary: {
      completion_percent: completion.valueAmount ?? 0,
      time_elapsed_percent: elapsed.valueAmount ?? 0,
    },
  });
}

function calcOverdueTaskPercent(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const snapMs = parseDateUtc(input.snapshotDate);
  if (snapMs === null) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "insufficient_date_basis",
      calculationMessage: "Snapshot date invalid.",
    });
  }
  const openWithBasis: { task: KpiTaskInput; dueMs: number }[] = [];
  for (const t of input.tasks) {
    if (!isOpen(t)) continue;
    const due = parseDateUtc(taskDueBasis(t));
    if (due === null) continue;
    openWithBasis.push({ task: t, dueMs: due });
  }
  if (openWithBasis.length === 0) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "no_source_data",
      calculationMessage: "No open tasks with a due/planned end date.",
    });
  }
  const overdue = openWithBasis.filter((x) => x.dueMs < snapMs).length;
  const pct = round((overdue / openWithBasis.length) * 100);
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: pct,
    calculationStatus: "calculated",
    sourceSummary: { open_with_basis: openWithBasis.length, overdue },
  });
}

function calcOnTimeCompletionPercent(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const completed = input.tasks.filter(
    (t) => !isExcluded(t) && isCompleted(t),
  );
  if (completed.length === 0) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "no_source_data",
      calculationMessage: "No completed tasks.",
    });
  }
  let withBasis = 0;
  let onTime = 0;
  for (const t of completed) {
    const actualMs = parseDateUtc(t.actualEndDate);
    const plannedMs = parseDateUtc(taskPlannedEndBasis(t));
    if (actualMs === null || plannedMs === null) continue;
    withBasis += 1;
    if (actualMs <= plannedMs) onTime += 1;
  }
  if (withBasis === 0) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "insufficient_date_basis",
      calculationMessage:
        "Completed tasks lack actual completion or planned/baseline end dates.",
    });
  }
  const pct = round((onTime / withBasis) * 100);
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: pct,
    calculationStatus: "calculated",
    sourceSummary: { completed_with_basis: withBasis, on_time: onTime },
  });
}

function calcBaselineSlipDays(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const baseMs = parseDateUtc(input.project.baselineEndDate);
  const targetMs = parseDateUtc(input.project.targetEndDate);
  if (baseMs === null || targetMs === null) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "insufficient_date_basis",
      calculationMessage:
        "Baseline end date or current target end date is missing.",
    });
  }
  const slip = daysBetween(baseMs, targetMs);
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: slip,
    calculationStatus: "calculated",
  });
}

function calcOpenBlockerCount(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const phaseIds = new Set(input.phases.map((p) => p.id));
  const taskIds = new Set(input.tasks.map((t) => t.id));
  let count = 0;
  for (const b of input.blockers) {
    if (!isBlockerOpen(b.status)) continue;
    if (
      !inProjectScope(b.targetType, b.targetId, input.project.id, phaseIds, taskIds)
    ) {
      // Out of scope = ignore (not an error). Genuine error path is for
      // unrecognized target types only.
      if (
        b.targetType !== "project" &&
        b.targetType !== "phase" &&
        b.targetType !== "task"
      ) {
        return buildResult(def, options, input.snapshotDate, {
          calculationStatus: "error",
          calculationMessage: `Unrecognized blocker target_type "${b.targetType}".`,
        });
      }
      continue;
    }
    count += 1;
  }
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: count,
    calculationStatus: "calculated",
  });
}

function calcHighImpactActiveRiskCount(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const phaseIds = new Set(input.phases.map((p) => p.id));
  const taskIds = new Set(input.tasks.map((t) => t.id));
  let count = 0;
  for (const r of input.risks) {
    if (!isRiskActive(r.status)) continue;
    if (!isHighImpact(r.impact)) continue;
    if (
      !inProjectScope(r.targetType, r.targetId, input.project.id, phaseIds, taskIds)
    ) {
      if (
        r.targetType !== "project" &&
        r.targetType !== "phase" &&
        r.targetType !== "task"
      ) {
        return buildResult(def, options, input.snapshotDate, {
          calculationStatus: "error",
          calculationMessage: `Unrecognized risk target_type "${r.targetType}".`,
        });
      }
      continue;
    }
    count += 1;
  }
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: count,
    calculationStatus: "calculated",
  });
}

function calcDaysSinceLastProjectStatusUpdate(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const snapMs = parseDateUtc(input.snapshotDate);
  if (snapMs === null) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "insufficient_date_basis",
      calculationMessage: "Snapshot date invalid.",
    });
  }
  // Canonical source per C1.3: project-scoped execution_updates only.
  const projectUpdates = input.executionUpdates
    .filter(
      (u) => u.targetType === "project" && u.targetId === input.project.id,
    )
    .map((u) => parseDateUtc(u.updateDate))
    .filter((ms): ms is number => ms !== null);
  if (projectUpdates.length === 0) {
    return buildResult(def, options, input.snapshotDate, {
      calculationStatus: "no_source_data",
      calculationMessage:
        "No project-scoped execution_updates exist for this project.",
    });
  }
  const latestMs = Math.max(...projectUpdates);
  const days = Math.max(0, daysBetween(latestMs, snapMs));
  return buildResult(def, options, input.snapshotDate, {
    valueAmount: days,
    calculationStatus: "calculated",
  });
}

function calcScheduleSignal(
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
): KpiCalculationResult {
  const signal = input.reportingSummary?.scheduleSignal ?? null;
  if (!signal) {
    return buildResult(def, options, input.snapshotDate, {
      stringValue: "no_schedule_basis",
      calculationStatus: "not_applicable",
      calculationMessage:
        "No canonical ReportingScheduleSignal supplied; schedule_signal MUST reuse src/lib/reportingSummary derivation.",
    });
  }
  return buildResult(def, options, input.snapshotDate, {
    stringValue: signal,
    calculationStatus: "calculated",
  });
}

// ---------- Dispatch ----------

type Calculator = (
  def: AutomaticKpiDefinition,
  input: KpiCalculationInput,
  options: KpiCalculationOptions | undefined,
) => KpiCalculationResult;

const CALCULATORS: Record<AutomaticKpiCalculationKey, Calculator> = {
  task_count_completion_percent: calcTaskCountCompletion,
  duration_weighted_completion_percent: calcDurationWeightedCompletion,
  milestone_completion_percent: calcMilestoneCompletion,
  phase_completion_percent: calcPhaseCompletion,
  time_elapsed_percent: calcTimeElapsedPercent,
  completion_vs_time_gap: calcCompletionVsTimeGap,
  overdue_task_percent: calcOverdueTaskPercent,
  on_time_completion_percent: calcOnTimeCompletionPercent,
  baseline_slip_days: calcBaselineSlipDays,
  open_blocker_count: calcOpenBlockerCount,
  high_impact_active_risk_count: calcHighImpactActiveRiskCount,
  days_since_last_project_status_update: calcDaysSinceLastProjectStatusUpdate,
  schedule_signal: calcScheduleSignal,
};

/**
 * Calculate ONE automatic KPI for ONE project from a normalized input.
 * Pure / deterministic. Never throws for normal no-basis cases.
 */
export function calculateAutomaticKpi(
  calculationKey: AutomaticKpiCalculationKey,
  input: KpiCalculationInput,
  options?: KpiCalculationOptions,
): KpiCalculationResult {
  const def = getAutomaticKpiDefinition(calculationKey);
  const calc = CALCULATORS[calculationKey];
  try {
    return calc(def, input, options);
  } catch (err) {
    return {
      calculationKey,
      valueType: def.valueType,
      sourceMode: "automatic",
      valueAmount: null,
      stringValue: null,
      calculationStatus: "error",
      calculationMessage:
        err instanceof Error ? err.message : "Unexpected calculation error.",
      formulaVersion: options?.formulaVersion ?? def.defaultFormulaVersion,
      completionMethod: options?.completionMethod ?? null,
      snapshotDate: input.snapshotDate,
    };
  }
}

/**
 * Calculate MULTIPLE automatic KPIs for ONE project. Order preserved.
 * Pure / deterministic. Errors are returned as typed results, not thrown.
 */
export function calculateAutomaticKpis(
  requests: ReadonlyArray<KpiCalculationRequest>,
  input: KpiCalculationInput,
): KpiCalculationResult[] {
  return requests.map((r) =>
    calculateAutomaticKpi(r.calculationKey, input, r.options),
  );
}
