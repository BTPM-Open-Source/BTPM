/**
 * Wave 5 Step 5.7 — Project Stage helpers.
 *
 * Stage is a first-class field on `projects.project_stage`, distinct from:
 *  - Project Status (`projects.status` on `pm_status`)
 *  - Project Health (derived in `projectDerivation.ts`)
 *
 * Stored values are lower snake_case. UI labels are mapped here.
 */

export const PROJECT_STAGE_VALUES = [
  "initiation",
  "planning",
  "execution",
  "closure",
] as const;

export type ProjectStage = (typeof PROJECT_STAGE_VALUES)[number];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  initiation: "Initiation",
  planning: "Planning",
  execution: "Execution",
  closure: "Closure",
};

/**
 * Visually distinct from Status badges and Health indicators.
 * Stage uses an outline with a left accent bar style via classes
 * applied at call sites; here we provide a single accent color per stage.
 */
export const PROJECT_STAGE_BADGE_CLASS: Record<ProjectStage, string> = {
  initiation:
    "border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  planning:
    "border-transparent bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  execution:
    "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
  closure:
    "border-transparent bg-slate-200 text-slate-800 dark:bg-slate-700/40 dark:text-slate-200",
};

export function isProjectStage(value: unknown): value is ProjectStage {
  return (
    typeof value === "string" &&
    (PROJECT_STAGE_VALUES as readonly string[]).includes(value)
  );
}

export function getProjectStageLabel(value: unknown): string {
  return isProjectStage(value) ? PROJECT_STAGE_LABELS[value] : "—";
}
