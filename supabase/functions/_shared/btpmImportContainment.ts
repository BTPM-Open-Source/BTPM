// deno-lint-ignore-file no-explicit-any
/**
 * BTPM Import — Shared containment / integrity validation (Step 6.3F)
 *
 * Pure, dependency-free validator used by BOTH:
 *   - supabase/functions/btpm-import-dry-run
 *   - supabase/functions/btpm-import-commit
 *
 * Guarantees the same blocking errors/warnings are produced by dry-run and
 * commit so an invalid payload can never slip past dry-run into a raw
 * database constraint failure at write time.
 *
 * Scope (Step 6.3F):
 *   - Parent/child date containment for projects/phases/tasks.
 *   - Cross-family reference integrity (broken_reference / phase_project_mismatch).
 *   - Normalized (trim + case-insensitive) duplicate names in payload scope.
 *   - Suspicious task names that look like timeline headers (warning).
 *   - Empty parent warnings (phase w/o tasks, project w/o phases).
 *   - execution_update.update_date far outside target window (warning).
 *
 * Never touches the network or DB. Never mutates the input payload.
 */

export type ContainmentFamily =
  | "programs"
  | "projects"
  | "project_team_members"
  | "phases"
  | "tasks"
  | "task_assignments"
  | "risks"
  | "blockers"
  | "execution_updates";

export interface ContainmentIssue {
  severity: "error" | "warning";
  code: string;
  family?: ContainmentFamily | "envelope";
  index?: number;
  external_key?: string;
  field?: string;
  message: string;
}

export interface ContainmentResult {
  errors: ContainmentIssue[];
  warnings: ContainmentIssue[];
}

const norm = (s: unknown): string =>
  typeof s === "string" ? s.trim().toLowerCase() : "";

const TIMELINE_LABEL_RE = new RegExp(
  [
    // month/year variants: 06/26, 07 / 26, 6-2026, 06/2026
    "^\\s*(0?[1-9]|1[0-2])\\s*[/\\-.]\\s*(\\d{2}|\\d{4})\\s*$",
    // bare year: 2026 or 26
    "^\\s*(19|20)\\d{2}\\s*$",
    // quarter: Q1, Q2 26, Q3 2026
    "^\\s*q[1-4](\\s*[-/ ]?\\s*(\\d{2}|\\d{4}))?\\s*$",
    // standalone month names
    "^\\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(uary|ruary|ch|il|e|y|ust|tember|ober|ember)?(\\s*(\\d{2}|\\d{4}))?\\s*$",
  ].join("|"),
  "i",
);

function isTimelineLabel(name: unknown): boolean {
  if (typeof name !== "string") return false;
  return TIMELINE_LABEL_RE.test(name.trim());
}

/**
 * Add offset days to an ISO date (YYYY-MM-DD). Returns null on invalid input.
 */
function shiftIsoDays(iso: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function runContainmentValidation(payload: any): ContainmentResult {
  const errors: ContainmentIssue[] = [];
  const warnings: ContainmentIssue[] = [];

  if (!payload || typeof payload !== "object") return { errors, warnings };

  const programs: any[] = Array.isArray(payload.programs) ? payload.programs : [];
  const projects: any[] = Array.isArray(payload.projects) ? payload.projects : [];
  const phases: any[] = Array.isArray(payload.phases) ? payload.phases : [];
  const tasks: any[] = Array.isArray(payload.tasks) ? payload.tasks : [];
  const team: any[] = Array.isArray(payload.project_team_members)
    ? payload.project_team_members
    : [];
  const assignments: any[] = Array.isArray(payload.task_assignments)
    ? payload.task_assignments
    : [];
  const risks: any[] = Array.isArray(payload.risks) ? payload.risks : [];
  const blockers: any[] = Array.isArray(payload.blockers) ? payload.blockers : [];
  const updates: any[] = Array.isArray(payload.execution_updates)
    ? payload.execution_updates
    : [];

  const projectByKey = new Map<string, any>();
  projects.forEach((p) => {
    if (p?.external_key) projectByKey.set(p.external_key, p);
  });
  const phaseByKey = new Map<string, any>();
  phases.forEach((p) => {
    if (p?.external_key) phaseByKey.set(p.external_key, p);
  });
  const programKeys = new Set(
    programs.map((p) => p?.external_key).filter(Boolean) as string[],
  );
  const projectKeys = new Set(projectByKey.keys());
  const phaseKeys = new Set(phaseByKey.keys());
  const taskKeys = new Set(
    tasks.map((t) => t?.external_key).filter(Boolean) as string[],
  );

  const nameOf = (v: any, fallback: string): string =>
    typeof v?.name === "string" && v.name.trim() ? v.name.trim() : fallback;

  /* ---------- Projects: date range + program ref ---------- */
  projects.forEach((p, i) => {
    const s = typeof p?.planned_start === "string" ? p.planned_start : null;
    const e = typeof p?.planned_end === "string" ? p.planned_end : null;
    if (s && e && e < s) {
      errors.push({
        severity: "error",
        code: "project_date_range_invalid",
        family: "projects",
        index: i,
        external_key: p?.external_key,
        message: `Project "${nameOf(p, p?.external_key ?? "?")}" planned_end (${e}) must be on or after planned_start (${s}).`,
      });
    }
    if (p?.program_external_key && !programKeys.has(p.program_external_key)) {
      errors.push({
        severity: "error",
        code: "broken_reference",
        family: "projects",
        index: i,
        external_key: p?.external_key,
        field: "program_external_key",
        message: `Project "${nameOf(p, p?.external_key ?? "?")}" references program "${p.program_external_key}" which is not defined in this payload.`,
      });
    }
  });

  /* ---------- Phases: ref + date range + containment inside project ---------- */
  phases.forEach((ph, i) => {
    const pk = ph?.project_external_key;
    if (!pk || !projectKeys.has(pk)) {
      errors.push({
        severity: "error",
        code: "broken_reference",
        family: "phases",
        index: i,
        external_key: ph?.external_key,
        field: "project_external_key",
        message: `Phase "${nameOf(ph, ph?.external_key ?? "?")}" references project "${pk ?? ""}" which is not defined in this payload.`,
      });
      return;
    }
    const s = typeof ph?.planned_start === "string" ? ph.planned_start : null;
    const e = typeof ph?.planned_end === "string" ? ph.planned_end : null;
    if (s && e && e < s) {
      errors.push({
        severity: "error",
        code: "phase_date_range_invalid",
        family: "phases",
        index: i,
        external_key: ph?.external_key,
        message: `Phase "${nameOf(ph, ph?.external_key ?? "?")}" planned_end (${e}) must be on or after planned_start (${s}).`,
      });
    }
    const proj = projectByKey.get(pk);
    const ps = typeof proj?.planned_start === "string" ? proj.planned_start : null;
    const pe = typeof proj?.planned_end === "string" ? proj.planned_end : null;
    const phName = nameOf(ph, ph?.external_key ?? "?");
    const prName = nameOf(proj, pk);
    if (s && ps && s < ps) {
      errors.push({
        severity: "error",
        code: "phase_before_project_start",
        family: "phases",
        index: i,
        external_key: ph?.external_key,
        field: "planned_start",
        message: `Phase "${phName}" starts ${s}, before parent project "${prName}" starts ${ps}.`,
      });
    }
    if (e && pe && e > pe) {
      errors.push({
        severity: "error",
        code: "phase_after_project_end",
        family: "phases",
        index: i,
        external_key: ph?.external_key,
        field: "planned_end",
        message: `Phase "${phName}" ends ${e}, after parent project "${prName}" ends ${pe}.`,
      });
    }
  });

  /* ---------- Tasks: refs + containment inside phase/project ---------- */
  tasks.forEach((t, i) => {
    const pk = t?.project_external_key;
    const phk = t?.phase_external_key;
    const proj = pk ? projectByKey.get(pk) : undefined;
    const ph = phk ? phaseByKey.get(phk) : undefined;
    const tName = nameOf(t, t?.external_key ?? "?");

    if (!pk || !projectKeys.has(pk)) {
      errors.push({
        severity: "error",
        code: "broken_reference",
        family: "tasks",
        index: i,
        external_key: t?.external_key,
        field: "project_external_key",
        message: `Task "${tName}" references project "${pk ?? ""}" which is not defined in this payload.`,
      });
    }
    if (!phk || !phaseKeys.has(phk)) {
      errors.push({
        severity: "error",
        code: "broken_reference",
        family: "tasks",
        index: i,
        external_key: t?.external_key,
        field: "phase_external_key",
        message: `Task "${tName}" references phase "${phk ?? ""}" which is not defined in this payload.`,
      });
    } else if (pk && ph && ph.project_external_key && ph.project_external_key !== pk) {
      errors.push({
        severity: "error",
        code: "phase_project_mismatch",
        family: "tasks",
        index: i,
        external_key: t?.external_key,
        field: "phase_external_key",
        message: `Task "${tName}" phase "${nameOf(ph, phk)}" belongs to project "${ph.project_external_key}", not the task's project "${pk}".`,
      });
    }

    const s = typeof t?.planned_start === "string" ? t.planned_start : null;
    const d = typeof t?.due_date === "string" ? t.due_date : null;
    if (s && d && d < s) {
      errors.push({
        severity: "error",
        code: "task_date_range_invalid",
        family: "tasks",
        index: i,
        external_key: t?.external_key,
        message: `Task "${tName}" due_date (${d}) must be on or after planned_start (${s}).`,
      });
    }

    if (ph) {
      const phs = typeof ph?.planned_start === "string" ? ph.planned_start : null;
      const phe = typeof ph?.planned_end === "string" ? ph.planned_end : null;
      const phName = nameOf(ph, phk ?? "?");
      if (s && phs && s < phs) {
        errors.push({
          severity: "error",
          code: "task_before_phase_start",
          family: "tasks",
          index: i,
          external_key: t?.external_key,
          field: "planned_start",
          message: `Task "${tName}" starts ${s}, before parent phase "${phName}" starts ${phs}.`,
        });
      }
      if (d && phe && d > phe) {
        errors.push({
          severity: "error",
          code: "task_after_phase_end",
          family: "tasks",
          index: i,
          external_key: t?.external_key,
          field: "due_date",
          message: `Task "${tName}" due_date ${d} is after parent phase "${phName}" ends ${phe}.`,
        });
      }
    }

    if (proj) {
      const ps = typeof proj?.planned_start === "string" ? proj.planned_start : null;
      const pe = typeof proj?.planned_end === "string" ? proj.planned_end : null;
      const prName = nameOf(proj, pk ?? "?");
      if (s && ps && s < ps) {
        errors.push({
          severity: "error",
          code: "task_before_project_start",
          family: "tasks",
          index: i,
          external_key: t?.external_key,
          field: "planned_start",
          message: `Task "${tName}" starts ${s}, before parent project "${prName}" starts ${ps}.`,
        });
      }
      if (d && pe && d > pe) {
        errors.push({
          severity: "error",
          code: "task_after_project_end",
          family: "tasks",
          index: i,
          external_key: t?.external_key,
          field: "due_date",
          message: `Task "${tName}" due_date ${d} is after parent project "${prName}" ends ${pe}.`,
        });
      }
    }

    if (isTimelineLabel(t?.name)) {
      warnings.push({
        severity: "warning",
        code: "suspicious_timeline_label_task",
        family: "tasks",
        index: i,
        external_key: t?.external_key,
        field: "name",
        message: `Task name "${t?.name}" looks like a timeline header (month / quarter / year label) rather than a real task.`,
      });
    }
  });

  /* ---------- project_team_members / task_assignments refs ---------- */
  team.forEach((m, i) => {
    if (m?.project_external_key && !projectKeys.has(m.project_external_key)) {
      errors.push({
        severity: "error",
        code: "broken_reference",
        family: "project_team_members",
        index: i,
        external_key: m?.external_key,
        field: "project_external_key",
        message: `Team member references project "${m.project_external_key}" which is not defined in this payload.`,
      });
    }
  });
  assignments.forEach((a, i) => {
    if (a?.task_external_key && !taskKeys.has(a.task_external_key)) {
      errors.push({
        severity: "error",
        code: "broken_reference",
        family: "task_assignments",
        index: i,
        external_key: a?.external_key,
        field: "task_external_key",
        message: `Task assignment references task "${a.task_external_key}" which is not defined in this payload.`,
      });
    }
  });

  /* ---------- risk / blocker / update target refs ---------- */
  const targetSets: Record<string, Set<string>> = {
    project: projectKeys,
    phase: phaseKeys,
    task: taskKeys,
  };
  const checkTarget = (fam: ContainmentFamily, rows: any[]) => {
    rows.forEach((r, i) => {
      const tt = r?.target_type;
      const tk = r?.target_external_key;
      if (!tt || !tk) return;
      const set = targetSets[tt];
      if (!set || !set.has(tk)) {
        errors.push({
          severity: "error",
          code: "target_not_resolved",
          family: fam,
          index: i,
          external_key: r?.external_key,
          field: "target_external_key",
          message: `${fam}[${i}] target ${tt} "${tk}" is not defined in this payload.`,
        });
      }
    });
  };
  checkTarget("risks", risks);
  checkTarget("blockers", blockers);
  checkTarget("execution_updates", updates);

  /* ---------- Normalized duplicate names ---------- */
  const progSeen = new Map<string, number>();
  programs.forEach((p, i) => {
    const k = norm(p?.name);
    if (!k) return;
    if (progSeen.has(k)) {
      errors.push({
        severity: "error",
        code: "duplicate_name_in_payload",
        family: "programs",
        index: i,
        external_key: p?.external_key,
        field: "name",
        message: `Duplicate program name "${p?.name}" (case/whitespace-insensitive) also at index ${progSeen.get(k)}.`,
      });
    } else progSeen.set(k, i);
  });
  const projSeen = new Map<string, number>();
  projects.forEach((p, i) => {
    const k = norm(p?.name);
    if (!k) return;
    if (projSeen.has(k)) {
      errors.push({
        severity: "error",
        code: "duplicate_name_in_payload",
        family: "projects",
        index: i,
        external_key: p?.external_key,
        field: "name",
        message: `Duplicate project name "${p?.name}" (case/whitespace-insensitive) also at index ${projSeen.get(k)}.`,
      });
    } else projSeen.set(k, i);
  });
  const phaseNamesInProj = new Map<string, Map<string, number>>();
  phases.forEach((ph, i) => {
    const pk = ph?.project_external_key;
    const k = norm(ph?.name);
    if (!pk || !k) return;
    const inner = phaseNamesInProj.get(pk) ?? new Map<string, number>();
    if (inner.has(k)) {
      errors.push({
        severity: "error",
        code: "duplicate_name_in_payload",
        family: "phases",
        index: i,
        external_key: ph?.external_key,
        field: "name",
        message: `Duplicate phase name "${ph?.name}" within project "${pk}" (case/whitespace-insensitive) also at index ${inner.get(k)}.`,
      });
    } else inner.set(k, i);
    phaseNamesInProj.set(pk, inner);
  });
  const taskNamesInPhase = new Map<string, Map<string, number>>();
  tasks.forEach((t, i) => {
    const ph = t?.phase_external_key;
    const k = norm(t?.name);
    if (!ph || !k) return;
    const inner = taskNamesInPhase.get(ph) ?? new Map<string, number>();
    if (inner.has(k)) {
      errors.push({
        severity: "error",
        code: "duplicate_name_in_payload",
        family: "tasks",
        index: i,
        external_key: t?.external_key,
        field: "name",
        message: `Duplicate task name "${t?.name}" within phase "${ph}" (case/whitespace-insensitive) also at index ${inner.get(k)}.`,
      });
    } else inner.set(k, i);
    taskNamesInPhase.set(ph, inner);
  });

  /* ---------- Empty-parent warnings ---------- */
  const phasesByProject = new Map<string, number>();
  phases.forEach((ph) => {
    if (!ph?.project_external_key) return;
    phasesByProject.set(
      ph.project_external_key,
      (phasesByProject.get(ph.project_external_key) ?? 0) + 1,
    );
  });
  const tasksByPhase = new Map<string, number>();
  tasks.forEach((t) => {
    if (!t?.phase_external_key) return;
    tasksByPhase.set(t.phase_external_key, (tasksByPhase.get(t.phase_external_key) ?? 0) + 1);
  });
  projects.forEach((p, i) => {
    if (!p?.external_key) return;
    if ((phasesByProject.get(p.external_key) ?? 0) === 0) {
      warnings.push({
        severity: "warning",
        code: "project_without_phases",
        family: "projects",
        index: i,
        external_key: p.external_key,
        message: `Project "${nameOf(p, p.external_key)}" has no phases in this payload.`,
      });
    }
  });
  phases.forEach((ph, i) => {
    if (!ph?.external_key) return;
    if ((tasksByPhase.get(ph.external_key) ?? 0) === 0) {
      warnings.push({
        severity: "warning",
        code: "empty_phase",
        family: "phases",
        index: i,
        external_key: ph.external_key,
        message: `Phase "${nameOf(ph, ph.external_key)}" has no tasks in this payload.`,
      });
    }
  });

  /* ---------- execution_update out-of-window warnings ---------- */
  updates.forEach((u, i) => {
    const d = typeof u?.update_date === "string" ? u.update_date : null;
    const tt = u?.target_type;
    const tk = u?.target_external_key;
    if (!d || !tt || !tk) return;
    let start: string | null = null;
    let end: string | null = null;
    if (tt === "project") {
      const p = projectByKey.get(tk);
      start = typeof p?.planned_start === "string" ? p.planned_start : null;
      end = typeof p?.planned_end === "string" ? p.planned_end : null;
    } else if (tt === "phase") {
      const p = phaseByKey.get(tk);
      start = typeof p?.planned_start === "string" ? p.planned_start : null;
      end = typeof p?.planned_end === "string" ? p.planned_end : null;
    } else if (tt === "task") {
      const t = tasks.find((x) => x?.external_key === tk);
      start = typeof t?.planned_start === "string" ? t.planned_start : null;
      end = typeof t?.due_date === "string" ? t.due_date : null;
    }
    const startMinus = start ? shiftIsoDays(start, -30) : null;
    const endPlus = end ? shiftIsoDays(end, 30) : null;
    if ((startMinus && d < startMinus) || (endPlus && d > endPlus)) {
      warnings.push({
        severity: "warning",
        code: "execution_update_date_outside_target_window",
        family: "execution_updates",
        index: i,
        external_key: u?.external_key,
        field: "update_date",
        message: `Execution update dated ${d} is more than 30 days outside the target ${tt}'s planned window (${start ?? "?"} → ${end ?? "?"}).`,
      });
    }
  });

  return { errors, warnings };
}
