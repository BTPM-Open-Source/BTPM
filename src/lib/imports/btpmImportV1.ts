/**
 * Phase 5.1 — BTPM Import Contract v1
 *
 * Client-side JSON contract + structural validator for the Org Admin Imports
 * surface. This module intentionally does NOT touch the database. Its only
 * job is:
 *   - describe the `btpm_import_v1` JSON envelope
 *   - validate structure, required fields, duplicate external_keys, basic
 *     ISO date format, planned_start ≤ planned_end, and obvious broken
 *     cross-references inside the same payload
 *   - build downloadable JSON templates
 *
 * Server-side dry-run and commit are explicitly out of scope for this step.
 * The future commit surface must go through a governed, encryption-aware
 * backend path — never client-side inserts.
 */
import { z } from "zod";

export const IMPORT_SCHEMA_VERSION = "btpm_import_v1" as const;
export const IMPORT_SCHEMA_VERSION_V2 = "btpm_import_v2" as const;
export const IMPORT_SCHEMA_VERSIONS = [
  IMPORT_SCHEMA_VERSION,
  IMPORT_SCHEMA_VERSION_V2,
] as const;
export type ImportSchemaVersion = (typeof IMPORT_SCHEMA_VERSIONS)[number];
export const IMPORT_TYPE = "pm_workspace_import" as const;

// TAE.11A — Project Stakeholder types accepted by the canonical
// public.project_stakeholders table. Match DB values exactly.
export const STAKEHOLDER_TYPE = ["workspace_member", "external"] as const;
export type StakeholderType = (typeof STAKEHOLDER_TYPE)[number];

/* -------------------------------------------------------------------------- */
/* Enums (client-side allow-lists, aligned with current BTPM values)          */
/* -------------------------------------------------------------------------- */

export const PM_STATUS = ["planned", "active", "completed", "on_hold", "cancelled"] as const;
export const PM_PRIORITY = ["low", "medium", "high", "critical"] as const;
export const TASK_TYPE = ["milestone", "deliverable", "work_item", "decision", "review"] as const;
export const PHASE_TYPE = ["milestone", "deliverable", "work_item", "decision", "review"] as const;
export const PROJECT_STAGE = ["initiation", "planning", "execution", "closure"] as const;
export const DELIVERY_MODEL = ["internal_delivery", "vendor_delivery", "co_delivery"] as const;
export const RISK_LIKELIHOOD = ["low", "medium", "high"] as const;
export const RISK_IMPACT = ["low", "medium", "high"] as const;
export const RISK_STATUS = [
  "open",
  "under_mitigation",
  "monitoring",
  "realized",
  "closed",
] as const;
export const BLOCKER_STATUS = ["open", "in_progress", "resolved"] as const;
export const TARGET_TYPE = ["project", "phase", "task"] as const;

/* -------------------------------------------------------------------------- */
/* Primitive validators                                                       */
/* -------------------------------------------------------------------------- */

const externalKey = z
  .string()
  .trim()
  .min(1, "external_key required")
  .max(120, "external_key must be ≤ 120 chars");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

const optionalIsoDate = isoDate.optional().nullable();

const email = z.string().trim().email("must be a valid email");

const sourceMeta = z
  .object({
    source_name: z.string().optional(),
    source_file_name: z.string().optional(),
    converted_at: isoDate.optional(),
    notes: z.string().optional(),
  })
  .partial()
  .optional();

/* -------------------------------------------------------------------------- */
/* Object schemas                                                             */
/* -------------------------------------------------------------------------- */

export const programSchema = z.object({
  external_key: externalKey,
  name: z.string().trim().min(1, "name required").max(200),
  description: z.string().max(4000).optional(),
  status: z.enum(PM_STATUS).optional(),
});

export const projectSchema = z.object({
  external_key: externalKey,
  program_external_key: z.string().trim().optional(),
  name: z.string().trim().min(1, "name required").max(200),
  description: z.string().max(4000).optional(),
  charter: z.string().max(10000).optional(),
  goals: z.string().max(4000).optional(),
  scope_in: z.string().max(4000).optional(),
  scope_out: z.string().max(4000).optional(),
  business_case: z.string().max(4000).optional(),
  assumptions: z.string().max(4000).optional(),
  constraints: z.string().max(4000).optional(),
  success_criteria: z.string().max(4000).optional(),
  completion_criteria: z.string().max(4000).optional(),
  budget_narrative: z.string().max(4000).optional(),
  delivery_model: z.enum(DELIVERY_MODEL).optional(),
  project_stage: z.enum(PROJECT_STAGE).optional(),
  status: z.enum(PM_STATUS).optional(),
  priority: z.enum(PM_PRIORITY).optional(),
  planned_start: optionalIsoDate,
  planned_end: optionalIsoDate,
  source: sourceMeta,
});

export const projectTeamMemberSchema = z.object({
  external_key: externalKey,
  project_external_key: externalKey,
  user_email: email,
  canonical_role_key: z.string().max(80).optional(),
  role_label: z.string().max(120).optional(),
});

export const phaseSchema = z.object({
  external_key: externalKey,
  project_external_key: externalKey,
  name: z.string().trim().min(1, "name required").max(200),
  description: z.string().max(4000).optional(),
  phase_type: z.enum(PHASE_TYPE).optional(),
  status: z.enum(PM_STATUS).optional(),
  planned_start: optionalIsoDate,
  planned_end: optionalIsoDate,
  order_index: z.number().int().nonnegative().optional(),
  source: sourceMeta,
});

export const taskSchema = z.object({
  external_key: externalKey,
  project_external_key: externalKey,
  phase_external_key: externalKey,
  name: z.string().trim().min(1, "name required").max(200),
  description: z.string().max(4000).optional(),
  task_type: z.enum(TASK_TYPE).optional(),
  status: z.enum(PM_STATUS).optional(),
  priority: z.enum(PM_PRIORITY).optional(),
  planned_start: optionalIsoDate,
  due_date: optionalIsoDate,
  order_index: z.number().int().nonnegative().optional(),
  source: sourceMeta,
});

// TAE.11A (v2 only) — extended Task schema with optional accountability
// external-key references. Never applied to v1 payloads; keeping v1 unchanged
// is a binding contract requirement.
export const taskSchemaV2 = taskSchema.extend({
  requested_by_stakeholder_external_key: z.string().trim().min(1).max(120).optional(),
  executed_by_stakeholder_external_keys: z.array(z.string().trim().min(1).max(120)).optional(),
});

export const taskAssignmentSchema = z.object({
  external_key: externalKey,
  task_external_key: externalKey,
  assignee_email: email,
});

// TAE.11A — Project Stakeholder row (v2 only).
// Internal stakeholders identify a Workspace member by `user_email`.
// External stakeholders are identified by a free-text `external_name`.
export const projectStakeholderSchema = z.object({
  external_key: externalKey,
  project_external_key: externalKey,
  stakeholder_type: z.enum(STAKEHOLDER_TYPE),
  user_email: email.optional(),
  external_name: z.string().trim().min(1).max(200).optional(),
  role_label: z.string().trim().max(120).optional(),
});
export type ImportProjectStakeholder = z.infer<typeof projectStakeholderSchema>;

export const riskSchema = z.object({
  external_key: externalKey,
  target_type: z.enum(TARGET_TYPE),
  target_external_key: externalKey,
  title: z.string().trim().min(1, "title required").max(200),
  description: z.string().max(4000).optional(),
  likelihood: z.enum(RISK_LIKELIHOOD).optional(),
  impact: z.enum(RISK_IMPACT).optional(),
  status: z.enum(RISK_STATUS).optional(),
  mitigation_plan: z.string().max(4000).optional(),
  owner_email: email.optional(),
  source: sourceMeta,
});

export const blockerSchema = z.object({
  external_key: externalKey,
  target_type: z.enum(TARGET_TYPE),
  target_external_key: externalKey,
  title: z.string().trim().min(1, "title required").max(200),
  description: z.string().max(4000).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(BLOCKER_STATUS).optional(),
  owner_email: email.optional(),
  source: sourceMeta,
});

export const executionUpdateSchema = z.object({
  external_key: externalKey,
  target_type: z.enum(TARGET_TYPE),
  target_external_key: externalKey,
  update_date: isoDate,
  summary: z.string().trim().min(1, "summary required").max(4000),
  status_label: z.string().max(80).optional(),
  author_email: email.optional(),
  source: sourceMeta,
});

/* -------------------------------------------------------------------------- */
/* Envelope                                                                   */
/* -------------------------------------------------------------------------- */

export const importEnvelopeSchema = z.object({
  schema_version: z.literal(IMPORT_SCHEMA_VERSION),
  import_type: z.literal(IMPORT_TYPE),
  source: z
    .object({
      source_name: z.string().trim().min(1, "source.source_name required"),
      source_file_name: z.string().optional(),
      converted_at: isoDate.optional(),
      notes: z.string().optional(),
    })
    .strict(),
  programs: z.array(programSchema),
  projects: z.array(projectSchema),
  project_team_members: z.array(projectTeamMemberSchema),
  phases: z.array(phaseSchema),
  tasks: z.array(taskSchema),
  task_assignments: z.array(taskAssignmentSchema),
  risks: z.array(riskSchema),
  blockers: z.array(blockerSchema),
  execution_updates: z.array(executionUpdateSchema),
});

// TAE.11A — v2 envelope adds `project_stakeholders` and swaps in the
// extended v2 Task schema. All other families are identical to v1.
export const importEnvelopeSchemaV2 = importEnvelopeSchema.extend({
  schema_version: z.literal(IMPORT_SCHEMA_VERSION_V2),
  tasks: z.array(taskSchemaV2),
  project_stakeholders: z.array(projectStakeholderSchema),
});

export type BtpmImportV1 = z.infer<typeof importEnvelopeSchema>;
export type BtpmImportV2 = z.infer<typeof importEnvelopeSchemaV2>;
export type BtpmImportAny = BtpmImportV1 | BtpmImportV2;
export type ImportProgram = z.infer<typeof programSchema>;
export type ImportProject = z.infer<typeof projectSchema>;
export type ImportProjectTeamMember = z.infer<typeof projectTeamMemberSchema>;
export type ImportPhase = z.infer<typeof phaseSchema>;
export type ImportTask = z.infer<typeof taskSchema>;
export type ImportTaskV2 = z.infer<typeof taskSchemaV2>;
export type ImportTaskAssignment = z.infer<typeof taskAssignmentSchema>;
export type ImportRisk = z.infer<typeof riskSchema>;
export type ImportBlocker = z.infer<typeof blockerSchema>;
export type ImportExecutionUpdate = z.infer<typeof executionUpdateSchema>;

export const OBJECT_FAMILIES = [
  "programs",
  "projects",
  "project_team_members",
  "phases",
  "tasks",
  "task_assignments",
  "risks",
  "blockers",
  "execution_updates",
] as const;
export type ObjectFamily = (typeof OBJECT_FAMILIES)[number];

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface ImportIssue {
  severity: "error" | "warning";
  family?: ObjectFamily | "project_stakeholders" | "envelope";
  index?: number;
  path?: string;
  external_key?: string;
  message: string;
}

export interface ImportCounts {
  programs: number;
  projects: number;
  project_team_members: number;
  phases: number;
  tasks: number;
  task_assignments: number;
  risks: number;
  blockers: number;
  execution_updates: number;
  // TAE.11A v2 additive — 0 in v1 payloads.
  project_stakeholders: number;
  task_requester_links: number;
  task_executor_links: number;
}

export interface ValidationResult {
  ok: boolean;
  /** Detected schema version. `null` when the envelope failed to parse. */
  schema_version?: ImportSchemaVersion | null;
  data: BtpmImportAny | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  counts: ImportCounts | null;
}

const emptyCounts = (): ImportCounts => ({
  programs: 0,
  projects: 0,
  project_team_members: 0,
  phases: 0,
  tasks: 0,
  task_assignments: 0,
  risks: 0,
  blockers: 0,
  execution_updates: 0,
  project_stakeholders: 0,
  task_requester_links: 0,
  task_executor_links: 0,
});

export function countObjects(data: BtpmImportAny): ImportCounts {
  const stakeholders =
    "project_stakeholders" in data && Array.isArray((data as BtpmImportV2).project_stakeholders)
      ? (data as BtpmImportV2).project_stakeholders.length
      : 0;
  let requester = 0;
  let executor = 0;
  for (const t of data.tasks as ImportTaskV2[]) {
    if (typeof t.requested_by_stakeholder_external_key === "string") requester += 1;
    if (Array.isArray(t.executed_by_stakeholder_external_keys)) {
      // De-duplicate for planned link count.
      executor += new Set(t.executed_by_stakeholder_external_keys).size;
    }
  }
  return {
    programs: data.programs.length,
    projects: data.projects.length,
    project_team_members: data.project_team_members.length,
    phases: data.phases.length,
    tasks: data.tasks.length,
    task_assignments: data.task_assignments.length,
    risks: data.risks.length,
    blockers: data.blockers.length,
    execution_updates: data.execution_updates.length,
    project_stakeholders: stakeholders,
    task_requester_links: requester,
    task_executor_links: executor,
  };
}

function checkDuplicateKeys(
  family: ObjectFamily,
  rows: { external_key?: string }[],
  errors: ImportIssue[],
) {
  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    const k = row.external_key;
    if (!k) return;
    if (seen.has(k)) {
      errors.push({
        severity: "error",
        family,
        index: i,
        external_key: k,
        message: `Duplicate external_key "${k}" in ${family} (also at index ${seen.get(k)}).`,
      });
    } else {
      seen.set(k, i);
    }
  });
}

function checkDateRange(
  family: ObjectFamily,
  rows: { external_key?: string; planned_start?: string | null; planned_end?: string | null }[],
  errors: ImportIssue[],
) {
  rows.forEach((row, i) => {
    if (row.planned_start && row.planned_end && row.planned_end < row.planned_start) {
      errors.push({
        severity: "error",
        family,
        index: i,
        external_key: row.external_key,
        message: `planned_end must be on or after planned_start.`,
      });
    }
  });
}

/**
 * Parse a raw string (JSON) or already-parsed value and run the full
 * structural validation. Never touches the network or DB.
 */
export function validateImportPayload(input: unknown): ValidationResult {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];

  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        data: null,
        counts: null,
        warnings: [],
        errors: [{ severity: "error", family: "envelope", message: `Invalid JSON: ${msg}` }],
      };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      data: null,
      counts: null,
      warnings: [],
      errors: [
        { severity: "error", family: "envelope", message: "Top-level payload must be a JSON object." },
      ],
    };
  }

  const rec = parsed as Record<string, unknown>;
  const detectedVersion: ImportSchemaVersion | null =
    rec.schema_version === IMPORT_SCHEMA_VERSION
      ? IMPORT_SCHEMA_VERSION
      : rec.schema_version === IMPORT_SCHEMA_VERSION_V2
      ? IMPORT_SCHEMA_VERSION_V2
      : null;
  if (!detectedVersion) {
    errors.push({
      severity: "error",
      family: "envelope",
      path: "schema_version",
      message: `schema_version must be one of ${IMPORT_SCHEMA_VERSIONS.map((v) => `"${v}"`).join(", ")} (got ${JSON.stringify(rec.schema_version)}).`,
    });
  }
  if (rec.import_type !== IMPORT_TYPE) {
    errors.push({
      severity: "error",
      family: "envelope",
      path: "import_type",
      message: `import_type must be "${IMPORT_TYPE}" (got ${JSON.stringify(rec.import_type)}).`,
    });
  }
  for (const family of OBJECT_FAMILIES) {
    if (!Array.isArray(rec[family])) {
      errors.push({
        severity: "error",
        family: "envelope",
        path: family,
        message: `Required top-level array "${family}" is missing.`,
      });
    }
  }
  if (detectedVersion === IMPORT_SCHEMA_VERSION_V2 && !Array.isArray(rec.project_stakeholders)) {
    errors.push({
      severity: "error",
      family: "envelope",
      path: "project_stakeholders",
      message: `Required top-level array "project_stakeholders" is missing for schema_version "${IMPORT_SCHEMA_VERSION_V2}".`,
    });
  }
  if (errors.length || !detectedVersion) {
    return { ok: false, schema_version: detectedVersion, data: null, counts: null, warnings, errors };
  }

  const envelope =
    detectedVersion === IMPORT_SCHEMA_VERSION_V2 ? importEnvelopeSchemaV2 : importEnvelopeSchema;
  const result = envelope.safeParse(rec);
  if (!result.success) {
    for (const iss of result.error.issues) {
      const [head, idx, ...rest] = iss.path;
      const knownFamily =
        typeof head === "string" &&
        ((OBJECT_FAMILIES as readonly string[]).includes(head) || head === "project_stakeholders");
      const family = (knownFamily ? (head as ImportIssue["family"]) : "envelope") as ImportIssue["family"];
      errors.push({
        severity: "error",
        family,
        index: typeof idx === "number" ? idx : undefined,
        path: [head, idx, ...rest].filter((p) => p !== undefined).join("."),
        message: iss.message,
      });
    }
    return { ok: false, schema_version: detectedVersion, data: null, counts: null, warnings, errors };
  }

  const data = result.data as BtpmImportAny;

  // Duplicate external_key checks (per family)
  for (const family of OBJECT_FAMILIES) {
    checkDuplicateKeys(family, data[family] as { external_key?: string }[], errors);
  }

  // Date range checks
  checkDateRange("projects", data.projects, errors);
  checkDateRange("phases", data.phases, errors);
  // Tasks use planned_start + due_date
  data.tasks.forEach((t, i) => {
    if (t.planned_start && t.due_date && t.due_date < t.planned_start) {
      errors.push({
        severity: "error",
        family: "tasks",
        index: i,
        external_key: t.external_key,
        message: "due_date must be on or after planned_start.",
      });
    }
  });

  // Cross-reference checks (inside payload only)
  const programKeys = new Set(data.programs.map((p) => p.external_key));
  const projectKeys = new Set(data.projects.map((p) => p.external_key));
  const phaseKeys = new Set(data.phases.map((p) => p.external_key));
  const taskKeys = new Set(data.tasks.map((t) => t.external_key));
  const projectByKey = new Map(data.projects.map((p) => [p.external_key, p] as const));
  const phaseByKey = new Map(data.phases.map((p) => [p.external_key, p] as const));

  const nameOf = (v: { name?: string; external_key?: string } | undefined, fallback: string) =>
    v?.name?.trim() ? v.name.trim() : fallback;
  const norm = (s: string | undefined) => (typeof s === "string" ? s.trim().toLowerCase() : "");

  const TIMELINE_LABEL_RE = new RegExp(
    [
      "^\\s*(0?[1-9]|1[0-2])\\s*[/\\-.]\\s*(\\d{2}|\\d{4})\\s*$",
      "^\\s*(19|20)\\d{2}\\s*$",
      "^\\s*q[1-4](\\s*[-/ ]?\\s*(\\d{2}|\\d{4}))?\\s*$",
      "^\\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(uary|ruary|ch|il|e|y|ust|tember|ober|ember)?(\\s*(\\d{2}|\\d{4}))?\\s*$",
    ].join("|"),
    "i",
  );

  data.projects.forEach((p, i) => {
    if (p.program_external_key && !programKeys.has(p.program_external_key)) {
      errors.push({
        severity: "error",
        family: "projects",
        index: i,
        external_key: p.external_key,
        message: `Project "${nameOf(p, p.external_key)}" references program "${p.program_external_key}" which is not in programs[].`,
      });
    }
  });

  data.phases.forEach((ph, i) => {
    if (!projectKeys.has(ph.project_external_key)) {
      errors.push({
        severity: "error",
        family: "phases",
        index: i,
        external_key: ph.external_key,
        message: `Phase "${nameOf(ph, ph.external_key)}" references project "${ph.project_external_key}" which is not in projects[].`,
      });
      return;
    }
    const proj = projectByKey.get(ph.project_external_key);
    const s = ph.planned_start ?? null;
    const e = ph.planned_end ?? null;
    const ps = proj?.planned_start ?? null;
    const pe = proj?.planned_end ?? null;
    const phName = nameOf(ph, ph.external_key);
    const prName = nameOf(proj, ph.project_external_key);
    if (s && ps && s < ps) {
      errors.push({
        severity: "error",
        family: "phases",
        index: i,
        external_key: ph.external_key,
        message: `Phase "${phName}" starts ${s}, before parent project "${prName}" starts ${ps}.`,
      });
    }
    if (e && pe && e > pe) {
      errors.push({
        severity: "error",
        family: "phases",
        index: i,
        external_key: ph.external_key,
        message: `Phase "${phName}" ends ${e}, after parent project "${prName}" ends ${pe}.`,
      });
    }
  });

  data.tasks.forEach((t, i) => {
    const tName = nameOf(t, t.external_key);
    if (!projectKeys.has(t.project_external_key)) {
      errors.push({
        severity: "error",
        family: "tasks",
        index: i,
        external_key: t.external_key,
        message: `Task "${tName}" references project "${t.project_external_key}" which is not in projects[].`,
      });
    }
    if (!phaseKeys.has(t.phase_external_key)) {
      errors.push({
        severity: "error",
        family: "tasks",
        index: i,
        external_key: t.external_key,
        message: `Task "${tName}" references phase "${t.phase_external_key}" which is not in phases[].`,
      });
    } else {
      const ph = phaseByKey.get(t.phase_external_key);
      if (ph && ph.project_external_key !== t.project_external_key) {
        errors.push({
          severity: "error",
          family: "tasks",
          index: i,
          external_key: t.external_key,
          message: `Task "${tName}" phase belongs to project "${ph.project_external_key}", not the task's project "${t.project_external_key}".`,
        });
      }
      const phs = ph?.planned_start ?? null;
      const phe = ph?.planned_end ?? null;
      const s = t.planned_start ?? null;
      const d = t.due_date ?? null;
      const phName = nameOf(ph, t.phase_external_key);
      if (s && phs && s < phs) {
        errors.push({
          severity: "error",
          family: "tasks",
          index: i,
          external_key: t.external_key,
          message: `Task "${tName}" starts ${s}, before parent phase "${phName}" starts ${phs}.`,
        });
      }
      if (d && phe && d > phe) {
        errors.push({
          severity: "error",
          family: "tasks",
          index: i,
          external_key: t.external_key,
          message: `Task "${tName}" due_date ${d} is after parent phase "${phName}" ends ${phe}.`,
        });
      }
    }
    const proj = projectByKey.get(t.project_external_key);
    if (proj) {
      const ps = proj.planned_start ?? null;
      const pe = proj.planned_end ?? null;
      const s = t.planned_start ?? null;
      const d = t.due_date ?? null;
      const prName = nameOf(proj, t.project_external_key);
      if (s && ps && s < ps) {
        errors.push({
          severity: "error",
          family: "tasks",
          index: i,
          external_key: t.external_key,
          message: `Task "${tName}" starts ${s}, before parent project "${prName}" starts ${ps}.`,
        });
      }
      if (d && pe && d > pe) {
        errors.push({
          severity: "error",
          family: "tasks",
          index: i,
          external_key: t.external_key,
          message: `Task "${tName}" due_date ${d} is after parent project "${prName}" ends ${pe}.`,
        });
      }
    }
    if (typeof t.name === "string" && TIMELINE_LABEL_RE.test(t.name.trim())) {
      warnings.push({
        severity: "warning",
        family: "tasks",
        index: i,
        external_key: t.external_key,
        message: `Task name "${t.name}" looks like a timeline header (month/quarter/year label) rather than a real task.`,
      });
    }
  });

  data.project_team_members.forEach((m, i) => {
    if (!projectKeys.has(m.project_external_key)) {
      errors.push({
        severity: "error",
        family: "project_team_members",
        index: i,
        external_key: m.external_key,
        message: `project_team_member.project_external_key "${m.project_external_key}" not found in projects[].`,
      });
    }
  });

  data.task_assignments.forEach((a, i) => {
    if (!taskKeys.has(a.task_external_key)) {
      errors.push({
        severity: "error",
        family: "task_assignments",
        index: i,
        external_key: a.external_key,
        message: `task_assignment.task_external_key "${a.task_external_key}" not found in tasks[].`,
      });
    }
  });

  const targetSets: Record<(typeof TARGET_TYPE)[number], Set<string>> = {
    project: projectKeys,
    phase: phaseKeys,
    task: taskKeys,
  };
  const checkTarget = (
    family: ObjectFamily,
    rows: ReadonlyArray<{
      external_key?: string;
      target_type?: (typeof TARGET_TYPE)[number];
      target_external_key?: string;
    }>,
  ) => {
    rows.forEach((r, i) => {
      if (!r.target_type || !r.target_external_key) return;
      const set = targetSets[r.target_type];
      if (!set.has(r.target_external_key)) {
        errors.push({
          severity: "error",
          family,
          index: i,
          external_key: r.external_key,
          message: `${family}[${i}] references ${r.target_type} "${r.target_external_key}" which is not defined in this payload.`,
        });
      }
    });
  };
  checkTarget("risks", data.risks);
  checkTarget("blockers", data.blockers);
  checkTarget("execution_updates", data.execution_updates);

  // Normalized (case + whitespace insensitive) duplicate names in scope.
  const dupCheck = (
    family: ObjectFamily,
    rows: ReadonlyArray<{ external_key?: string; name?: string }>,
    scope?: (r: any) => string,
  ) => {
    const seen = new Map<string, number>();
    rows.forEach((r, i) => {
      const key = `${scope ? scope(r) : "*"}::${norm(r.name)}`;
      if (!norm(r.name)) return;
      if (seen.has(key)) {
        errors.push({
          severity: "error",
          family,
          index: i,
          external_key: r.external_key,
          message: `Duplicate ${family.slice(0, -1)} name "${r.name}" (case/whitespace-insensitive) also at index ${seen.get(key)}.`,
        });
      } else seen.set(key, i);
    });
  };
  dupCheck("programs", data.programs);
  dupCheck("projects", data.projects);
  dupCheck("phases", data.phases, (r) => r.project_external_key ?? "");
  dupCheck("tasks", data.tasks, (r) => r.phase_external_key ?? "");

  // Empty parent warnings
  const phasesByProject = new Map<string, number>();
  data.phases.forEach((ph) => {
    phasesByProject.set(
      ph.project_external_key,
      (phasesByProject.get(ph.project_external_key) ?? 0) + 1,
    );
  });
  const tasksByPhase = new Map<string, number>();
  data.tasks.forEach((t) => {
    tasksByPhase.set(t.phase_external_key, (tasksByPhase.get(t.phase_external_key) ?? 0) + 1);
  });
  data.projects.forEach((p, i) => {
    if ((phasesByProject.get(p.external_key) ?? 0) === 0) {
      warnings.push({
        severity: "warning",
        family: "projects",
        index: i,
        external_key: p.external_key,
        message: `Project "${nameOf(p, p.external_key)}" has no phases in this payload.`,
      });
    }
  });
  data.phases.forEach((ph, i) => {
    if ((tasksByPhase.get(ph.external_key) ?? 0) === 0) {
      warnings.push({
        severity: "warning",
        family: "phases",
        index: i,
        external_key: ph.external_key,
        message: `Phase "${nameOf(ph, ph.external_key)}" has no tasks in this payload.`,
      });
    }
  });

  // TAE.11A — v2 stakeholder + task accountability validation.
  // v1 payloads are unaffected: the v1 task schema does not accept
  // Requester/Executor fields (extra keys are stripped by zod).
  if (detectedVersion === IMPORT_SCHEMA_VERSION_V2) {
    validateV2Additions(data as BtpmImportV2, errors, warnings);
  }

  return {
    ok: errors.length === 0,
    schema_version: detectedVersion,
    data,
    counts: countObjects(data),
    warnings,
    errors,
  };
}

// TAE.11A — v2 semantic checks. Never mutates the payload.
function validateV2Additions(
  data: BtpmImportV2,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): void {
  const projectKeys = new Set(data.projects.map((p) => p.external_key));
  const stakeholders = data.project_stakeholders;

  // 1. Stakeholder external_key uniqueness (across entire payload).
  const seen = new Map<string, number>();
  stakeholders.forEach((s, i) => {
    if (!s.external_key) return;
    if (seen.has(s.external_key)) {
      errors.push({
        severity: "error",
        family: "project_stakeholders",
        index: i,
        external_key: s.external_key,
        message: `Duplicate stakeholder external_key "${s.external_key}" (also at index ${seen.get(s.external_key)}).`,
      });
    } else seen.set(s.external_key, i);
  });

  // 2. Type-specific field requirements + Project reference presence.
  stakeholders.forEach((s, i) => {
    if (s.stakeholder_type === "workspace_member" && !s.user_email) {
      errors.push({
        severity: "error",
        family: "project_stakeholders",
        index: i,
        external_key: s.external_key,
        path: "user_email",
        message: `Internal stakeholder "${s.external_key}" requires user_email.`,
      });
    }
    if (s.stakeholder_type === "external" && !s.external_name) {
      errors.push({
        severity: "error",
        family: "project_stakeholders",
        index: i,
        external_key: s.external_key,
        path: "external_name",
        message: `External stakeholder "${s.external_key}" requires external_name.`,
      });
    }
    if (s.stakeholder_type === "workspace_member" && s.external_name) {
      warnings.push({
        severity: "warning",
        family: "project_stakeholders",
        index: i,
        external_key: s.external_key,
        path: "external_name",
        message: `external_name is ignored for internal (workspace_member) stakeholders.`,
      });
    }
    if (s.stakeholder_type === "external" && s.user_email) {
      warnings.push({
        severity: "warning",
        family: "project_stakeholders",
        index: i,
        external_key: s.external_key,
        path: "user_email",
        message: `user_email is ignored for external stakeholders.`,
      });
    }
    if (!projectKeys.has(s.project_external_key)) {
      errors.push({
        severity: "error",
        family: "project_stakeholders",
        index: i,
        external_key: s.external_key,
        path: "project_external_key",
        message: `Stakeholder "${s.external_key}" references project "${s.project_external_key}" which is not defined in this payload.`,
      });
    }
  });

  // Stakeholder → project lookup (only for keys with a valid project).
  const stakeholderByKey = new Map<string, ImportProjectStakeholder>();
  stakeholders.forEach((s) => {
    if (s.external_key && !stakeholderByKey.has(s.external_key)) {
      stakeholderByKey.set(s.external_key, s);
    }
  });

  // 3. Task Requester/Executor references must resolve, be same-project, dedup.
  data.tasks.forEach((t, ti) => {
    const req = t.requested_by_stakeholder_external_key;
    if (typeof req === "string" && req.length > 0) {
      const st = stakeholderByKey.get(req);
      if (!st) {
        errors.push({
          severity: "error",
          family: "tasks",
          index: ti,
          external_key: t.external_key,
          path: "requested_by_stakeholder_external_key",
          message: `Task "${t.external_key}" requester stakeholder "${req}" is not declared in project_stakeholders[].`,
        });
      } else if (st.project_external_key !== t.project_external_key) {
        errors.push({
          severity: "error",
          family: "tasks",
          index: ti,
          external_key: t.external_key,
          path: "requested_by_stakeholder_external_key",
          message: `Task "${t.external_key}" requester "${req}" belongs to project "${st.project_external_key}", not the task's project "${t.project_external_key}".`,
        });
      }
    }
    const execs = t.executed_by_stakeholder_external_keys;
    if (Array.isArray(execs)) {
      const dedup = new Set<string>();
      const dupSeen = new Set<string>();
      for (const k of execs) {
        if (dedup.has(k)) dupSeen.add(k);
        else dedup.add(k);
      }
      if (dupSeen.size > 0) {
        warnings.push({
          severity: "warning",
          family: "tasks",
          index: ti,
          external_key: t.external_key,
          path: "executed_by_stakeholder_external_keys",
          message: `Task "${t.external_key}" listed executor(s) more than once: ${Array.from(dupSeen).join(", ")}. Duplicates will be deduplicated.`,
        });
      }
      for (const key of dedup) {
        const st = stakeholderByKey.get(key);
        if (!st) {
          errors.push({
            severity: "error",
            family: "tasks",
            index: ti,
            external_key: t.external_key,
            path: "executed_by_stakeholder_external_keys",
            message: `Task "${t.external_key}" executor stakeholder "${key}" is not declared in project_stakeholders[].`,
          });
        } else if (st.project_external_key !== t.project_external_key) {
          errors.push({
            severity: "error",
            family: "tasks",
            index: ti,
            external_key: t.external_key,
            path: "executed_by_stakeholder_external_keys",
            message: `Task "${t.external_key}" executor "${key}" belongs to project "${st.project_external_key}", not the task's project "${t.project_external_key}".`,
          });
        }
      }
    }
  });
}


/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

const baseEnvelope = (sourceName: string): BtpmImportV1 => ({
  schema_version: IMPORT_SCHEMA_VERSION,
  import_type: IMPORT_TYPE,
  source: { source_name: sourceName },
  programs: [],
  projects: [],
  project_team_members: [],
  phases: [],
  tasks: [],
  task_assignments: [],
  risks: [],
  blockers: [],
  execution_updates: [],
});

export interface TemplateDescriptor {
  id: string;
  label: string;
  description: string;
  fileName: string;
  build: () => BtpmImportV1;
}

/** Full BTPM workspace import template with realistic (non-confidential) examples. */
function fullWorkspaceTemplate(): BtpmImportV1 {
  const env = baseEnvelope("Full PM workspace example");
  env.programs.push({
    external_key: "prg-example-alpha",
    name: "Example Program Alpha",
    description: "Umbrella program grouping related delivery streams.",
    status: "active",
  });
  env.projects.push({
    external_key: "prj-example-onboarding",
    program_external_key: "prg-example-alpha",
    name: "Customer Onboarding Uplift",
    description: "Improve the end-to-end onboarding funnel.",
    goals: "Reduce time-to-first-value from 14 days to 5 days.",
    scope_in: "Signup, activation emails, first-run experience.",
    scope_out: "Billing, procurement.",
    delivery_model: "internal_delivery",
    project_stage: "planning",
    status: "active",
    priority: "high",
    planned_start: "2026-07-15",
    planned_end: "2026-12-15",
  });
  env.project_team_members.push({
    external_key: "tm-onboarding-pm",
    project_external_key: "prj-example-onboarding",
    user_email: "pm@example.com",
    canonical_role_key: "project_manager",
    role_label: "Project Manager",
  });
  env.phases.push(
    {
      external_key: "ph-onboarding-discovery",
      project_external_key: "prj-example-onboarding",
      name: "Discovery",
      status: "active",
      planned_start: "2026-07-15",
      planned_end: "2026-08-15",
      order_index: 1,
    },
    {
      external_key: "ph-onboarding-build",
      project_external_key: "prj-example-onboarding",
      name: "Build",
      status: "planned",
      planned_start: "2026-08-16",
      planned_end: "2026-11-30",
      order_index: 2,
    },
  );
  env.tasks.push({
    external_key: "tk-onboarding-research",
    project_external_key: "prj-example-onboarding",
    phase_external_key: "ph-onboarding-discovery",
    name: "User interviews",
    task_type: "work_item",
    status: "active",
    priority: "medium",
    planned_start: "2026-07-15",
    due_date: "2026-07-31",
    order_index: 1,
  });
  env.task_assignments.push({
    external_key: "as-onboarding-research-lead",
    task_external_key: "tk-onboarding-research",
    assignee_email: "lead@example.com",
  });
  env.risks.push({
    external_key: "rk-onboarding-scope",
    target_type: "project",
    target_external_key: "prj-example-onboarding",
    title: "Scope may expand beyond onboarding funnel",
    likelihood: "medium",
    impact: "high",
    status: "open",
    mitigation_plan: "Weekly scope review with sponsor.",
    owner_email: "pm@example.com",
  });
  env.blockers.push({
    external_key: "bk-onboarding-env",
    target_type: "phase",
    target_external_key: "ph-onboarding-build",
    title: "Staging environment not available",
    severity: "high",
    status: "open",
    owner_email: "pm@example.com",
  });
  env.execution_updates.push({
    external_key: "up-onboarding-w1",
    target_type: "project",
    target_external_key: "prj-example-onboarding",
    update_date: "2026-07-22",
    summary: "Kick-off complete; interview plan drafted.",
    status_label: "On track",
    author_email: "pm@example.com",
  });
  return env;
}

function programsProjectsTemplate(): BtpmImportV1 {
  const env = baseEnvelope("Programs & projects only");
  env.programs.push({
    external_key: "prg-market-access",
    name: "Market Access",
    status: "active",
  });
  env.projects.push({
    external_key: "prj-region-eu",
    program_external_key: "prg-market-access",
    name: "EU Market Entry",
    status: "planned",
    priority: "medium",
    planned_start: "2026-09-01",
    planned_end: "2027-03-31",
  });
  return env;
}

function projectCharterTemplate(): BtpmImportV1 {
  const env = baseEnvelope("Project charter narratives");
  env.projects.push({
    external_key: "prj-example-charter",
    name: "Charter Example Project",
    charter: "Deliver a new customer feedback loop across support and product.",
    goals: "Improve NPS from 32 to 45 within 12 months.",
    scope_in: "Support tickets, in-app surveys, quarterly interviews.",
    scope_out: "Sales feedback, marketing surveys.",
    business_case: "Retention gains valued at €1.2M annually.",
    assumptions: "Support team has bandwidth for tagging.",
    constraints: "Must comply with GDPR data-minimization.",
    success_criteria: "NPS ≥ 45, weekly signal loop in place.",
    completion_criteria: "Feedback loop operational for 2 quarters.",
    budget_narrative: "Internal delivery; no external spend.",
    delivery_model: "internal_delivery",
    project_stage: "initiation",
    status: "planned",
  });
  return env;
}

function phasesTasksTemplate(): BtpmImportV1 {
  const env = baseEnvelope("Phases & tasks");
  env.projects.push({
    external_key: "prj-example-plan",
    name: "Planning Example",
    status: "active",
  });
  env.phases.push({
    external_key: "ph-plan-design",
    project_external_key: "prj-example-plan",
    name: "Design",
    order_index: 1,
    status: "active",
  });
  env.tasks.push(
    {
      external_key: "tk-plan-arch",
      project_external_key: "prj-example-plan",
      phase_external_key: "ph-plan-design",
      name: "Draft architecture",
      task_type: "deliverable",
      status: "active",
      order_index: 1,
    },
    {
      external_key: "tk-plan-signoff",
      project_external_key: "prj-example-plan",
      phase_external_key: "ph-plan-design",
      name: "Design sign-off",
      task_type: "milestone",
      status: "planned",
      order_index: 2,
    },
  );
  return env;
}

function teamAssignmentsTemplate(): BtpmImportV1 {
  const env = baseEnvelope("Team & task assignments");
  env.projects.push({
    external_key: "prj-example-team",
    name: "Team Example",
    status: "active",
  });
  env.project_team_members.push(
    {
      external_key: "tm-team-pm",
      project_external_key: "prj-example-team",
      user_email: "pm@example.com",
      canonical_role_key: "project_manager",
    },
    {
      external_key: "tm-team-sme",
      project_external_key: "prj-example-team",
      user_email: "sme@example.com",
      canonical_role_key: "sme",
    },
  );
  env.phases.push({
    external_key: "ph-team-run",
    project_external_key: "prj-example-team",
    name: "Run",
    order_index: 1,
  });
  env.tasks.push({
    external_key: "tk-team-review",
    project_external_key: "prj-example-team",
    phase_external_key: "ph-team-run",
    name: "Quarterly review",
    task_type: "review",
  });
  env.task_assignments.push({
    external_key: "as-team-review",
    task_external_key: "tk-team-review",
    assignee_email: "sme@example.com",
  });
  return env;
}

function risksBlockersTemplate(): BtpmImportV1 {
  const env = baseEnvelope("Risks & blockers");
  env.projects.push({
    external_key: "prj-example-risk",
    name: "Risk Example",
    status: "active",
  });
  env.risks.push({
    external_key: "rk-vendor-slippage",
    target_type: "project",
    target_external_key: "prj-example-risk",
    title: "Vendor delivery slippage",
    likelihood: "high",
    impact: "high",
    status: "under_mitigation",
    mitigation_plan: "Weekly delivery review + penalty clause reminder.",
  });
  env.blockers.push({
    external_key: "bk-legal-review",
    target_type: "project",
    target_external_key: "prj-example-risk",
    title: "Legal review not scheduled",
    severity: "medium",
    status: "open",
  });
  return env;
}

function progressUpdatesTemplate(): BtpmImportV1 {
  const env = baseEnvelope("Progress updates");
  env.projects.push({
    external_key: "prj-example-updates",
    name: "Updates Example",
    status: "active",
  });
  env.execution_updates.push(
    {
      external_key: "up-updates-w1",
      target_type: "project",
      target_external_key: "prj-example-updates",
      update_date: "2026-07-01",
      summary: "Kick-off held, plan drafted.",
      status_label: "On track",
    },
    {
      external_key: "up-updates-w2",
      target_type: "project",
      target_external_key: "prj-example-updates",
      update_date: "2026-07-08",
      summary: "Stakeholder alignment complete.",
      status_label: "On track",
    },
  );
  return env;
}

function launchProjectTemplate(): BtpmImportV1 {
  const env = baseEnvelope("Launch project example");
  env.source = {
    source_name: "Launch project example",
    notes:
      "Mapping: CMO = Program, Product Launch = Project. Charter carries the strategy narrative. Phases group launch workstreams. Tasks include milestones and decision items (task_type = decision). Critical items are Risks; only current impediments are Blockers. Dated notes are Execution updates.",
  };
  env.programs.push({
    external_key: "prg-cmo",
    name: "Example CMO",
    description: "Chief Medical Office — product launch program.",
    status: "active",
  });
  env.projects.push({
    external_key: "prj-product-launch",
    program_external_key: "prg-cmo",
    name: "Example Product Launch",
    description: "End-to-end launch of the example therapeutic product.",
    charter:
      "Strategy: cross-functional launch across Medical, Regulatory, Commercial and Supply. Partners: example co-delivery partner. Launch value: expand access in the target region. Forecast: reach first-year uptake target within launch window. Profitability: positive contribution margin from year 2 under the base scenario.",
    goals: "Hit launch date; achieve first-year uptake target.",
    scope_in: "Launch readiness, HCP engagement plan, supply plan, distribution decision.",
    scope_out: "Post-launch lifecycle management.",
    success_criteria: "All launch-critical milestones green at go-live.",
    delivery_model: "co_delivery",
    project_stage: "execution",
    status: "active",
    priority: "critical",
    planned_start: "2026-07-01",
    planned_end: "2027-06-30",
  });
  env.project_team_members.push({
    external_key: "tm-launch-pm",
    project_external_key: "prj-product-launch",
    user_email: "launch.pm@example.com",
    canonical_role_key: "project_manager",
    role_label: "Launch Project Manager",
  });
  env.phases.push(
    {
      external_key: "ph-launch-readiness",
      project_external_key: "prj-product-launch",
      name: "Launch Readiness",
      status: "active",
      planned_start: "2026-07-01",
      planned_end: "2026-11-30",
      order_index: 1,
    },
    {
      external_key: "ph-launch-go-live",
      project_external_key: "prj-product-launch",
      name: "Go-Live",
      status: "planned",
      planned_start: "2026-12-01",
      planned_end: "2027-02-28",
      order_index: 2,
    },
  );
  env.tasks.push(
    {
      external_key: "tk-launch-regulatory-milestone",
      project_external_key: "prj-product-launch",
      phase_external_key: "ph-launch-readiness",
      name: "Regulatory approval received",
      task_type: "milestone",
      status: "planned",
      due_date: "2026-11-30",
      order_index: 1,
    },
    {
      external_key: "tk-launch-decision-channel",
      project_external_key: "prj-product-launch",
      phase_external_key: "ph-launch-readiness",
      name: "Decision: distribution channel model",
      task_type: "decision",
      status: "active",
      due_date: "2026-09-30",
      order_index: 2,
    },
    {
      external_key: "tk-launch-hcp-plan",
      project_external_key: "prj-product-launch",
      phase_external_key: "ph-launch-go-live",
      name: "HCP engagement plan execution",
      task_type: "work_item",
      status: "planned",
      planned_start: "2026-12-01",
      due_date: "2027-02-15",
      order_index: 3,
    },
  );
  env.task_assignments.push({
    external_key: "as-launch-hcp-plan-lead",
    task_external_key: "tk-launch-hcp-plan",
    assignee_email: "launch.pm@example.com",
  });
  env.risks.push({
    external_key: "rk-launch-supply",
    target_type: "project",
    target_external_key: "prj-product-launch",
    title: "Supply constraints at launch",
    likelihood: "medium",
    impact: "high",
    status: "under_mitigation",
    mitigation_plan: "Dual-source critical components; monthly S&OP checkpoint.",
    owner_email: "launch.pm@example.com",
  });
  env.blockers.push({
    external_key: "bk-launch-label",
    target_type: "phase",
    target_external_key: "ph-launch-readiness",
    title: "Label copy pending medical sign-off",
    severity: "high",
    status: "open",
    owner_email: "launch.pm@example.com",
  });
  env.execution_updates.push({
    external_key: "up-launch-hcp-plan-jan",
    target_type: "task",
    target_external_key: "tk-launch-hcp-plan",
    update_date: "2027-01-10",
    summary: "HCP engagement plan rolling out on schedule; monitoring channel decision impact.",
    status_label: "On track",
    author_email: "launch.pm@example.com",
  });
  return env;
}

export const TEMPLATES: TemplateDescriptor[] = [
  {
    id: "full",
    label: "Full PM workspace import",
    description:
      "End-to-end example with rows in every supported family — programs, projects, phases, tasks, team, assignments, risks, blockers, execution updates.",
    fileName: "btpm_full_workspace_import_template_v1.json",
    build: fullWorkspaceTemplate,
  },
  {
    id: "programs-projects",
    label: "Programs and projects",
    description:
      "Just the top of the hierarchy — one program with one project. Use to seed a workspace before adding phases/tasks.",
    fileName: "btpm_programs_projects_template_v1.json",
    build: programsProjectsTemplate,
  },
  {
    id: "project-charter",
    label: "Project charter details",
    description:
      "Project row filled with charter narrative fields: goals, scope, business case, assumptions, constraints, success/completion criteria, budget narrative.",
    fileName: "btpm_project_charter_template_v1.json",
    build: projectCharterTemplate,
  },
  {
    id: "phases-tasks",
    label: "Phases and tasks",
    description:
      "Project with phases and milestone / deliverable tasks — the minimum planning skeleton for a Gantt view.",
    fileName: "btpm_phases_tasks_template_v1.json",
    build: phasesTasksTemplate,
  },
  {
    id: "team-assignments",
    label: "Team and task assignments",
    description:
      "Project team members / stakeholders by email plus task assignments — each email must already be an active workspace member.",
    fileName: "btpm_team_assignments_template_v1.json",
    build: teamAssignmentsTemplate,
  },
  {
    id: "risks-blockers",
    label: "Risks and blockers",
    description:
      "Project / phase / task risks and blockers with owners, severity and status. Blockers are current impediments, not general risks.",
    fileName: "btpm_risks_blockers_template_v1.json",
    build: risksBlockersTemplate,
  },
  {
    id: "progress-updates",
    label: "Progress / execution updates",
    description:
      "Dated execution updates against a project, phase or task — separate from generic comments.",
    fileName: "btpm_progress_updates_template_v1.json",
    build: progressUpdatesTemplate,
  },
  {
    id: "launch-project",
    label: "Launch project (CMO → Product launch)",
    description:
      "CMO as Program, Product Launch as Project, charter carries strategy/partners/value narrative, phases are workstreams, milestones and decisions are tasks, critical items are risks, active impediments are blockers, dated notes are execution updates.",
    fileName: "btpm_launch_project_template_v1.json",
    build: launchProjectTemplate,
  },
];

export function toJsonString(env: BtpmImportV1): string {
  return JSON.stringify(env, null, 2);
}

export function emptyImportCounts(): ImportCounts {
  return emptyCounts();
}
