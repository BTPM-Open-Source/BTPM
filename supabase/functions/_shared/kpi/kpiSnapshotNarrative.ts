// BTPM — Wave C3, Step C3.9b (supersedes C3.9a)
// Deterministic, factual, NON-AI narrative comment builder for automatic
// system-created KPI snapshots.
//
// Hard rules:
//   - No external/AI calls. Pure function.
//   - No raw calculation input payload — only the final calculated value
//     plus calculation basis metadata (calculation_key, formula_version,
//     and the calculation engine's sourceSummary).
//   - No KPI formulas are recomputed here. sourceSummary is consumed
//     as-is, never recalculated.
//   - Final comment is length-capped (max 1500 chars).
//   - Caller is responsible for keeping action_plan = null.
//   - Execution-update digest is a list of already-decrypted, already
//     truncated rows produced server-side by
//     get_project_execution_update_digest_for_snapshot_system_v2. This
//     module does NOT decrypt and does NOT read any database.

import {
  getAutomaticKpiDefinition,
  type AutomaticKpiCalculationKey,
} from "./automaticKpiLibrary.ts";

export type ExecutionUpdateDigestRow = {
  target_type: string | null;
  update_date: string | null;
  status_label: string | null;
  summary: string | null;
};

export type AutomaticSnapshotSourceSummary = Record<
  string,
  number | string | null
>;

export type AutomaticSnapshotCommentInput = {
  kpiName: string | null | undefined;
  calculationKey: string | null | undefined;
  formulaVersion: number | null | undefined;
  valueType: string | null | undefined;
  valueAmount: number | null | undefined;
  stringValue: string | null | undefined;
  periodStart: string;
  periodEnd: string;
  calculationStatus: string;
  /** C3.9b: deterministic basis metadata from the calculation engine. */
  sourceSummary?: AutomaticSnapshotSourceSummary | null;
  executionUpdates: ExecutionUpdateDigestRow[];
};

const MAX_COMMENT_LEN = 1500;
const MAX_PER_LINE_SUMMARY = 250;

/**
 * C3.9b: target-type relevance rules per calculation_key. Used by the
 * scheduler to request a KPI-relevance-filtered execution-update digest.
 * Kept here (alongside the narrative builder) so the rules and the
 * narrative templates evolve together.
 */
export const KPI_RELEVANT_TARGET_TYPES: Record<
  AutomaticKpiCalculationKey,
  ReadonlyArray<"project" | "phase" | "task">
> = {
  task_count_completion_percent: ["task", "phase", "project"],
  duration_weighted_completion_percent: ["task", "phase", "project"],
  milestone_completion_percent: ["task", "phase", "project"],
  phase_completion_percent: ["phase", "project"],
  time_elapsed_percent: ["project"],
  completion_vs_time_gap: ["task", "phase", "project"],
  overdue_task_percent: ["task", "phase", "project"],
  on_time_completion_percent: ["task", "phase", "project"],
  baseline_slip_days: ["project"],
  open_blocker_count: ["project", "phase", "task"],
  high_impact_active_risk_count: ["project", "phase", "task"],
  days_since_last_project_status_update: ["project"],
  schedule_signal: ["project"],
};

export function getRelevantTargetTypesForCalculationKey(
  calculationKey: string | null | undefined,
): ReadonlyArray<"project" | "phase" | "task"> | null {
  if (!calculationKey) return null;
  const k = calculationKey as AutomaticKpiCalculationKey;
  // deno-lint-ignore no-prototype-builtins
  if (!KPI_RELEVANT_TARGET_TYPES.hasOwnProperty(k)) return null;
  return KPI_RELEVANT_TARGET_TYPES[k];
}

function formatValue(
  valueType: string | null | undefined,
  valueAmount: number | null | undefined,
  stringValue: string | null | undefined,
): string {
  const vt = (valueType ?? "number").toLowerCase();
  if (vt === "string" || vt === "text") {
    if (typeof stringValue === "string" && stringValue.length > 0) {
      return stringValue.length > 120
        ? stringValue.slice(0, 120) + "…"
        : stringValue;
    }
    return "n/a";
  }
  if (typeof valueAmount === "number" && Number.isFinite(valueAmount)) {
    if (Number.isInteger(valueAmount)) return String(valueAmount);
    return Number(valueAmount.toFixed(4)).toString();
  }
  if (typeof stringValue === "string" && stringValue.length > 0) {
    return stringValue;
  }
  return "n/a";
}

function safeLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function num(
  s: AutomaticSnapshotSourceSummary | null | undefined,
  k: string,
): number | null {
  if (!s) return null;
  const v = s[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * C3.9b — KPI-specific result sentence. Uses sourceSummary verbatim.
 * Falls back to a generic-but-still-KPI-specific value sentence when
 * sourceSummary is missing.
 */
function buildResultSentence(
  calculationKey: string | null | undefined,
  formattedValue: string,
  sourceSummary: AutomaticSnapshotSourceSummary | null | undefined,
): string {
  const key = (calculationKey ?? "").toString();
  const ss = sourceSummary ?? null;

  switch (key) {
    case "task_count_completion_percent": {
      const total = num(ss, "total");
      const completed = num(ss, "completed");
      if (total !== null && completed !== null) {
        return `Result: ${completed} of ${total} in-scope tasks are completed (${formattedValue}%).`;
      }
      return `Result: task-count completion is ${formattedValue}%.`;
    }
    case "duration_weighted_completion_percent": {
      const total = num(ss, "total_duration_days");
      const completed = num(ss, "completed_duration_days");
      if (total !== null && completed !== null) {
        return `Result: completed planned duration is ${completed} of ${total} days (${formattedValue}%).`;
      }
      return `Result: duration-weighted completion is ${formattedValue}%.`;
    }
    case "milestone_completion_percent": {
      const total = num(ss, "milestone_total");
      const completed = num(ss, "milestone_completed");
      if (total !== null && completed !== null) {
        return `Result: ${completed} of ${total} milestones are completed (${formattedValue}%).`;
      }
      return `Result: milestone completion is ${formattedValue}%.`;
    }
    case "phase_completion_percent": {
      const total = num(ss, "phase_total");
      const completed = num(ss, "phase_completed");
      if (total !== null && completed !== null) {
        return `Result: ${completed} of ${total} phases are completed (${formattedValue}%).`;
      }
      return `Result: phase completion is ${formattedValue}%.`;
    }
    case "time_elapsed_percent": {
      const total = num(ss, "total_days");
      const elapsed = num(ss, "elapsed_days");
      if (total !== null && elapsed !== null) {
        return `Result: ${elapsed} of ${total} planned calendar days have elapsed (${formattedValue}%). This measures schedule consumption, not delivery completion.`;
      }
      return `Result: ${formattedValue}% of planned calendar days have elapsed. This measures schedule consumption, not delivery completion.`;
    }
    case "completion_vs_time_gap": {
      const cp = num(ss, "completion_percent");
      const tep = num(ss, "time_elapsed_percent");
      if (cp !== null && tep !== null) {
        return `Result: completion is ${cp}% versus ${tep}% time elapsed, giving a gap of ${formattedValue} percentage points.`;
      }
      return `Result: completion-vs-time gap is ${formattedValue} percentage points.`;
    }
    case "overdue_task_percent": {
      const open = num(ss, "open_with_basis");
      const overdue = num(ss, "overdue");
      if (open !== null && overdue !== null) {
        return `Result: ${overdue} of ${open} open tasks with a usable date basis are overdue (${formattedValue}%).`;
      }
      return `Result: overdue task share is ${formattedValue}%.`;
    }
    case "on_time_completion_percent": {
      const total = num(ss, "completed_with_basis");
      const onTime = num(ss, "on_time");
      if (total !== null && onTime !== null) {
        return `Result: ${onTime} of ${total} completed tasks with date basis were completed on time (${formattedValue}%).`;
      }
      return `Result: on-time completion is ${formattedValue}%.`;
    }
    case "baseline_slip_days":
      return `Result: current target end is ${formattedValue} days versus baseline. Positive means slip beyond baseline; negative means ahead of baseline.`;
    case "open_blocker_count":
      return `Result: ${formattedValue} open blockers are currently attached to the project or its child phases/tasks.`;
    case "high_impact_active_risk_count":
      return `Result: ${formattedValue} active high-impact risks are currently attached to the project or its child phases/tasks.`;
    case "days_since_last_project_status_update":
      return `Result: the latest project-level status update is ${formattedValue} days before the snapshot date.`;
    case "schedule_signal":
      return `Result: schedule_signal is excluded from automatic snapshot capture and should not appear in this audit.`;
    default:
      return `Result: calculated value is ${formattedValue}.`;
  }
}

export function buildAutomaticSnapshotComment(
  input: AutomaticSnapshotCommentInput,
): string {
  const kpiName = (input.kpiName ?? "Automatic KPI").toString();
  const calcKey = (input.calculationKey ?? "automatic_calculation").toString();
  const fv =
    typeof input.formulaVersion === "number" &&
    Number.isFinite(input.formulaVersion)
      ? String(input.formulaVersion)
      : "unspecified";
  const formattedValue = formatValue(
    input.valueType,
    input.valueAmount,
    input.stringValue,
  );

  const headerLine = `Automatic snapshot for ${kpiName}, period ${input.periodStart} to ${input.periodEnd}.`;
  const resultLine = buildResultSentence(
    input.calculationKey,
    formattedValue,
    input.sourceSummary ?? null,
  );

  // Basis sentence — short, includes formula description from the
  // controlled automatic-KPI library when available.
  const meta = input.calculationKey
    ? (() => {
        try {
          return getAutomaticKpiDefinition(
            input.calculationKey as AutomaticKpiCalculationKey,
          );
        } catch {
          return null;
        }
      })()
    : null;
  const basisLines: string[] = [
    `Basis: ${calcKey}, formula version ${fv}.`,
  ];
  if (meta?.formulaDescription) {
    const fd = meta.formulaDescription.trim();
    if (fd.length > 0) {
      const trimmed = fd.length > 220 ? fd.slice(0, 220) + "…" : fd;
      basisLines.push(`Formula: ${trimmed}`);
    }
  }

  const updates = Array.isArray(input.executionUpdates)
    ? input.executionUpdates.filter(Boolean)
    : [];

  let body: string;
  if (updates.length === 0) {
    body =
      "Relevant period updates:\nNo relevant execution updates were recorded in BTPM for this KPI's source scope during the period.";
  } else {
    const rendered = updates.slice(0, 5).map((u) => {
      const date = (u.update_date ?? "").toString();
      const tt = (u.target_type ?? "").toString().trim();
      const status = (u.status_label ?? "").toString().trim();
      const summary = (u.summary ?? "")
        .toString()
        .slice(0, MAX_PER_LINE_SUMMARY);
      const ttPart = tt ? `[${tt}] ` : "";
      const statusPart = status ? `${status}: ` : "";
      return `- ${date}: ${ttPart}${statusPart}${summary}`.trim();
    });
    body = ["Relevant period updates:", ...rendered].join("\n");
  }

  const headerBlock = [headerLine, resultLine, ...basisLines]
    .map(safeLine)
    .join("\n");
  const full = [headerBlock, body].join("\n");
  if (full.length <= MAX_COMMENT_LEN) return full;
  return full.slice(0, MAX_COMMENT_LEN - 1) + "…";
}
