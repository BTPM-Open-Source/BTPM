/**
 * BTPM — Wave C1, Step C1.3
 * Controlled Automatic KPI Library (pure metadata registry).
 *
 * This module is METADATA ONLY. It must not import Supabase clients,
 * React, hooks, UI components, or perform any database access. It is
 * the contract that the C1.4 calculation engine will consume.
 *
 * Calculation keys are snake_case and IMMUTABLE once shipped. Adding a
 * new KPI requires a new governance step. Removing or renaming a key
 * is a breaking change and must be governed.
 *
 * Formula descriptions are explanatory natural-language only. They are
 * NOT executable expressions. There is no formula builder in v1.
 */

export type AutomaticKpiCalculationKey =
  | "task_count_completion_percent"
  | "duration_weighted_completion_percent"
  | "milestone_completion_percent"
  | "phase_completion_percent"
  | "time_elapsed_percent"
  | "completion_vs_time_gap"
  | "overdue_task_percent"
  | "on_time_completion_percent"
  | "baseline_slip_days"
  | "open_blocker_count"
  | "high_impact_active_risk_count"
  | "days_since_last_project_status_update"
  | "schedule_signal";

export type AutomaticKpiValueType = "percent" | "number" | "currency" | "text";

/**
 * How this KPI relates to the kpi_definitions.completion_method column.
 *
 * - "not_applicable": calculation key already encodes the completion
 *    method (e.g. task_count_completion_percent vs
 *    duration_weighted_completion_percent). The completion_method
 *    column is ignored.
 * - "selector": KPI uses completion_method to pick how to derive
 *    completion (task_count vs duration_weighted). If null, default
 *    to task_count for v1.
 */
export type CompletionMethodRequirement = "not_applicable" | "selector";

/**
 * Calculation status values that a no-basis / error path may produce.
 * Mirrors kpi_snap_calc_status_chk on kpi_snapshots (C1.2).
 */
export type AutomaticKpiNoBasisStatus =
  | "no_source_data"
  | "insufficient_date_basis"
  | "not_applicable"
  | "error";

export interface AutomaticKpiNoBasisBehavior {
  /** Status to record on the snapshot when basis is missing. */
  status: AutomaticKpiNoBasisStatus | "calculated";
  /** Value to return when basis is missing. null means "no value". */
  value: number | string | null;
  /** Human description of the trigger condition. */
  description: string;
}

export interface AutomaticKpiDefinition {
  calculationKey: AutomaticKpiCalculationKey;
  name: string;
  description: string;
  valueType: AutomaticKpiValueType;
  /**
   * Default formula version recorded on snapshots. Bumped when the
   * controlled formula evolves so historical values remain
   * reproducible.
   */
  defaultFormulaVersion: number;
  /** Canonical source object names this KPI reads from. */
  sourceObjects: ReadonlyArray<string>;
  /** Specific source fields/columns required. Documentation only. */
  sourceFields: ReadonlyArray<string>;
  /** Natural-language formula description. NOT executable. */
  formulaDescription: string;
  /** What to do when required source data is missing/insufficient. */
  noBasisBehavior: ReadonlyArray<AutomaticKpiNoBasisBehavior>;
  /** Whether/how completion_method on kpi_definitions applies. */
  completionMethodRequirement: CompletionMethodRequirement;
  /** How to interpret the resulting value. */
  resultInterpretation: string;
  /** Intended reporting/management use. */
  intendedUse: string;
  /**
   * Optional ambiguity notes the calculation engine (C1.4) must
   * resolve against the live repo schema.
   */
  ambiguityNotes?: ReadonlyArray<string>;
}

const DEFINITIONS: ReadonlyArray<AutomaticKpiDefinition> = [
  {
    calculationKey: "task_count_completion_percent",
    name: "Task-count completion %",
    description:
      "Share of in-scope tasks that are completed, counted equally per task.",
    valueType: "percent",
    defaultFormulaVersion: 1,
    sourceObjects: ["project", "phases", "tasks"],
    sourceFields: [
      "tasks.status / lifecycle",
      "tasks.project_id / phase_id",
      "tasks cancellation/archive state",
    ],
    formulaDescription:
      "completed non-cancelled tasks ÷ total non-cancelled tasks.",
    noBasisBehavior: [
      {
        status: "no_source_data",
        value: null,
        description: "Project has no non-cancelled tasks.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "0–100%. Higher means more tasks done. Equal weight per task.",
    intendedUse: "Headline delivery completion when tasks are sized similarly.",
  },
  {
    calculationKey: "duration_weighted_completion_percent",
    name: "Duration-weighted completion %",
    description:
      "Share of planned work duration that is completed, weighted by task duration.",
    valueType: "percent",
    defaultFormulaVersion: 1,
    sourceObjects: ["project", "phases", "tasks"],
    sourceFields: [
      "tasks.planned start / end (or due)",
      "tasks.status / lifecycle",
      "tasks cancellation/archive state",
    ],
    formulaDescription:
      "Σ(planned duration of completed non-cancelled tasks) ÷ Σ(planned duration of all non-cancelled tasks).",
    noBasisBehavior: [
      {
        status: "insufficient_date_basis",
        value: null,
        description:
          "Tasks lack the date basis required to compute planned duration.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "0–100%. Higher means more planned work-time delivered. Materially differs from task-count completion when task sizes vary.",
    intendedUse:
      "Headline delivery completion when tasks vary materially in size.",
  },
  {
    calculationKey: "milestone_completion_percent",
    name: "Milestone completion %",
    description: "Share of milestone tasks completed.",
    valueType: "percent",
    defaultFormulaVersion: 1,
    sourceObjects: ["project", "phases", "tasks"],
    sourceFields: [
      "tasks.type (milestone)",
      "tasks.status / lifecycle",
      "tasks cancellation/archive state",
    ],
    formulaDescription:
      "completed milestone tasks ÷ total non-cancelled milestone tasks.",
    noBasisBehavior: [
      {
        status: "not_applicable",
        value: null,
        description: "Project has no milestone tasks.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "0–100%. Reflects achievement of governance/milestone checkpoints, not raw task volume.",
    intendedUse: "Steering-committee view of major checkpoint progress.",
  },
  {
    calculationKey: "phase_completion_percent",
    name: "Phase completion %",
    description: "Share of phases completed.",
    valueType: "percent",
    defaultFormulaVersion: 1,
    sourceObjects: ["project", "phases"],
    sourceFields: [
      "phases.status / lifecycle (canonical phase auto-completion truth, Wave 5)",
      "phases cancellation/archive state",
    ],
    formulaDescription:
      "completed non-cancelled phases ÷ total non-cancelled phases.",
    noBasisBehavior: [
      {
        status: "no_source_data",
        value: null,
        description: "Project has no non-cancelled phases.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "0–100%. Coarse-grained delivery view aligned with the project's phase plan.",
    intendedUse:
      "High-level progress for projects whose phases are the natural reporting unit.",
  },
  {
    calculationKey: "time_elapsed_percent",
    name: "Time elapsed %",
    description:
      "Share of the planned project window that has elapsed by the snapshot date.",
    valueType: "percent",
    defaultFormulaVersion: 1,
    sourceObjects: ["project"],
    sourceFields: [
      "projects.planned_start_date",
      "projects.planned_end_date",
      "snapshot date",
    ],
    formulaDescription:
      "(snapshot date − project planned start) ÷ (project planned end − project planned start), in calendar days, clamped to [0, 100%].",
    noBasisBehavior: [
      {
        status: "insufficient_date_basis",
        value: null,
        description:
          "Project planned start or planned end is missing, or planned end is before planned start.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "0–100%. Schedule consumption only — NOT delivery completion.",
    intendedUse:
      "Pair with a completion KPI to assess pace vs schedule (see completion_vs_time_gap).",
  },
  {
    calculationKey: "completion_vs_time_gap",
    name: "Completion vs time gap",
    description:
      "Difference between the chosen completion percent and time elapsed percent.",
    valueType: "number",
    defaultFormulaVersion: 1,
    sourceObjects: ["project", "phases", "tasks"],
    sourceFields: [
      "selected completion KPI basis (per completion_method)",
      "projects.planned_start_date",
      "projects.planned_end_date",
      "snapshot date",
    ],
    formulaDescription:
      "selected completion % − time elapsed %. completion_method on the KPI definition selects task_count vs duration_weighted; null defaults to task_count in v1.",
    noBasisBehavior: [
      {
        status: "insufficient_date_basis",
        value: null,
        description:
          "Either the selected completion percent or time elapsed percent cannot be calculated.",
      },
    ],
    completionMethodRequirement: "selector",
    resultInterpretation:
      "Positive = ahead of schedule by that many percentage points. Negative = behind. ~0 = on pace.",
    intendedUse:
      "Single-glance pace indicator for steering reviews. Default v1 method is task_count when completion_method is null.",
  },
  {
    calculationKey: "overdue_task_percent",
    name: "Overdue task %",
    description:
      "Share of open tasks (with date basis) whose due/planned end date is past the snapshot date.",
    valueType: "percent",
    defaultFormulaVersion: 1,
    sourceObjects: ["project", "phases", "tasks"],
    sourceFields: [
      "tasks.status",
      "tasks.due / planned end date",
      "snapshot date",
      "tasks cancellation/archive state",
    ],
    formulaDescription:
      "open non-cancelled tasks past due ÷ open non-cancelled tasks with a due/planned end date.",
    noBasisBehavior: [
      {
        status: "no_source_data",
        value: null,
        description: "No open tasks with a usable due/planned end date exist.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "0–100%. Higher = more open work past its planned date. Excludes completed tasks by design.",
    intendedUse:
      "Operational warning signal for execution drift on currently open work.",
  },
  {
    calculationKey: "on_time_completion_percent",
    name: "On-time completion %",
    description:
      "Share of completed tasks that finished on or before their planned/baseline date.",
    valueType: "percent",
    defaultFormulaVersion: 1,
    sourceObjects: ["project", "phases", "tasks"],
    sourceFields: [
      "tasks.completed status",
      "tasks.actual completion / end date",
      "tasks.planned or baseline end / due date",
      "tasks cancellation/archive state",
    ],
    formulaDescription:
      "completed tasks where actual end ≤ planned/baseline end ÷ completed tasks with both dates available.",
    noBasisBehavior: [
      {
        status: "insufficient_date_basis",
        value: null,
        description:
          "Completed tasks lack actual completion dates or planned/baseline dates.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "0–100%. Retrospective delivery discipline — measures past completions only.",
    intendedUse:
      "Lessons-learned and team performance trend; complements forward-looking overdue %.",
  },
  {
    calculationKey: "baseline_slip_days",
    name: "Baseline slip days",
    description:
      "Days of slip between the current planned/target project end and the baseline project end.",
    valueType: "number",
    defaultFormulaVersion: 1,
    sourceObjects: ["project"],
    sourceFields: [
      "projects.current planned/target end date",
      "projects.baseline end date",
    ],
    formulaDescription:
      "current planned/target project end date − baseline project end date, in calendar days.",
    noBasisBehavior: [
      {
        status: "insufficient_date_basis",
        value: null,
        description:
          "Baseline end date or current planned/target end date is missing.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "Positive = slip beyond baseline. 0 = no slip. Negative = ahead of baseline. Aligned with Wave B reporting summary semantics.",
    intendedUse:
      "Governance/PMO visibility into commitment drift versus the approved baseline.",
  },
  {
    calculationKey: "open_blocker_count",
    name: "Open blocker count",
    description:
      "Count of currently open blockers attached to the project or its child phases/tasks.",
    valueType: "number",
    defaultFormulaVersion: 1,
    sourceObjects: ["project", "phases", "tasks", "blockers"],
    sourceFields: [
      "blockers.target scope (project / phase / task)",
      "blockers.status / lifecycle",
      "project relationship",
    ],
    formulaDescription:
      "count of blockers in open/in-progress states whose scope resolves to this project (directly or via its phases/tasks).",
    noBasisBehavior: [
      {
        status: "calculated",
        value: 0,
        description:
          "No matching blockers exist — 0 is a valid measured value, not a no-basis case.",
      },
      {
        status: "error",
        value: null,
        description:
          "Blocker source/scope cannot be resolved against the project.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "Integer ≥ 0. Higher = more open impediments. 0 is healthy.",
    intendedUse: "Operational health signal for active impediments.",
  },
  {
    calculationKey: "high_impact_active_risk_count",
    name: "High-impact active risk count",
    description:
      "Count of active high-impact risks attached to the project or its child phases/tasks.",
    valueType: "number",
    defaultFormulaVersion: 1,
    sourceObjects: ["project", "phases", "tasks", "risks"],
    sourceFields: [
      "risks.target scope (project / phase / task)",
      "risks.status / lifecycle (active = open / under_mitigation per Wave 5.6)",
      "risks.impact / severity (high)",
      "project relationship",
    ],
    formulaDescription:
      "count of risks in active states (open / under_mitigation) classified as high impact whose scope resolves to this project.",
    noBasisBehavior: [
      {
        status: "calculated",
        value: 0,
        description:
          "No matching high-impact active risks exist — 0 is a valid measured value.",
      },
      {
        status: "error",
        value: null,
        description: "Risk source/scope cannot be resolved against the project.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "Integer ≥ 0. Higher = more material exposure. Aligned with Wave 5.6 risk lifecycle.",
    intendedUse:
      "Risk posture indicator for governance/steering reviews.",
  },
  {
    calculationKey: "days_since_last_project_status_update",
    name: "Days since last project status update",
    description:
      "Calendar days between the snapshot date and the latest qualifying project-level status update.",
    valueType: "number",
    defaultFormulaVersion: 1,
    sourceObjects: [
      "project",
      "execution_updates",
      "activity_events",
      "governance/status records (if present)",
    ],
    sourceFields: [
      "update timestamp / effective date",
      "update target scope/type",
      "snapshot date",
    ],
    formulaDescription:
      "snapshot date − max(effective date of qualifying project-level status updates), in calendar days.",
    noBasisBehavior: [
      {
        status: "no_source_data",
        value: null,
        description:
          "No qualifying project-level status update exists for this project.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "Integer ≥ 0. Higher = staler status. 0 = updated today.",
    intendedUse:
      "Governance hygiene signal — flags projects whose status reporting has gone quiet.",
    ambiguityNotes: [
      "Repo currently exposes BOTH execution_updates (project-scoped, decrypted via list_decrypted_execution_updates) AND activity_events (broader audit log via list_project_activity_events). C1.4 must pick a single canonical source.",
      "Preferred v1 source: execution_updates filtered to project scope (intent matches 'project status update' semantics). activity_events is a general audit feed and would over-trigger 'recent update'.",
      "If a dedicated governance/status-record entity is introduced later, it should supersede execution_updates as the canonical source and bump defaultFormulaVersion.",
    ],
  },
  {
    calculationKey: "schedule_signal",
    name: "Schedule signal",
    description:
      "Categorical schedule status (on_track / behind_schedule / complete / no_schedule_basis).",
    valueType: "text",
    defaultFormulaVersion: 1,
    sourceObjects: [
      "project",
      "phases",
      "tasks",
      "blockers/risks (only as already considered by the canonical reporting summary)",
    ],
    sourceFields: [
      "existing reporting summary schedule_signal (canonical)",
      "project dates",
      "task dates / status",
      "completion status",
    ],
    formulaDescription:
      "Reuse the canonical reporting summary schedule_signal already produced by src/lib/reportingSummary.ts (ReportingScheduleSignal). Do NOT re-derive a parallel schedule logic.",
    noBasisBehavior: [
      {
        status: "calculated",
        value: "no_schedule_basis",
        description:
          "Date basis is missing — the canonical reporting summary already returns 'no_schedule_basis'; surface that string verbatim.",
      },
    ],
    completionMethodRequirement: "not_applicable",
    resultInterpretation:
      "One of: on_track | behind_schedule | complete | no_schedule_basis. Stored in kpi_snapshots.string_value (encrypted at rest per C1.2).",
    intendedUse:
      "Single-token health summary for dashboards and KPI App submission.",
    ambiguityNotes: [
      "Canonical source confirmed: ReportingScheduleSignal in src/lib/reportingSummary.ts (Wave B). C1.4 must consume this and must not invent a second schedule-signal logic.",
    ],
  },
];

const DEFINITIONS_BY_KEY: ReadonlyMap<
  AutomaticKpiCalculationKey,
  AutomaticKpiDefinition
> = new Map(DEFINITIONS.map((d) => [d.calculationKey, d]));

const ALL_KEYS: ReadonlySet<string> = new Set(
  DEFINITIONS.map((d) => d.calculationKey),
);

/** Type guard for an arbitrary string. */
export function isAutomaticKpiCalculationKey(
  value: unknown,
): value is AutomaticKpiCalculationKey {
  return typeof value === "string" && ALL_KEYS.has(value);
}

/** Lookup a single definition; returns undefined if unknown. */
export function getAutomaticKpiDefinition(
  calculationKey: AutomaticKpiCalculationKey,
): AutomaticKpiDefinition {
  const def = DEFINITIONS_BY_KEY.get(calculationKey);
  if (!def) {
    // Unreachable when calculationKey is correctly typed; defensive only.
    throw new Error(
      `Unknown automatic KPI calculation key: ${String(calculationKey)}`,
    );
  }
  return def;
}

/** All approved automatic KPI definitions, in registry order. */
export function listAutomaticKpiDefinitions(): ReadonlyArray<AutomaticKpiDefinition> {
  return DEFINITIONS;
}
