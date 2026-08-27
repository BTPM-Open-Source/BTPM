// deno-lint-ignore-file no-explicit-any
/**
 * BTPM Import — Server Dry-Run (Phase 6.3B)
 *
 * Authenticates the caller via user JWT, verifies active-org context and
 * Org Admin authority, then re-validates the `btpm_import_v1` payload
 * against real database state. Writes ONLY a safe summary row to
 * `public.btpm_import_batches`. Does NOT create any imported PM records.
 *
 * SAFETY:
 *  - Full JSON payload is NEVER persisted. Only a SHA-256 hash is stored.
 *  - Row-level descriptions / charter / risk / blocker / update text are
 *    NEVER stored in the audit table.
 *  - Encryption model is not bypassed. This function only reads.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";
import { runContainmentValidation } from "../_shared/btpmImportContainment.ts";

/* -------------------------------------------------------------------------- */
/* Contract mirror (kept in this file to avoid cross-runtime imports)         */
/* -------------------------------------------------------------------------- */

const SCHEMA_VERSION = "btpm_import_v1";
const SCHEMA_VERSION_V2 = "btpm_import_v2";
const SUPPORTED_SCHEMA_VERSIONS = [SCHEMA_VERSION, SCHEMA_VERSION_V2] as const;
const IMPORT_TYPE = "pm_workspace_import";
const STAKEHOLDER_TYPES = ["workspace_member", "external"] as const;

const PM_STATUS = ["planned", "active", "completed", "on_hold", "cancelled"];
const PM_PRIORITY = ["low", "medium", "high", "critical"];
const TASK_TYPE = ["milestone", "deliverable", "work_item", "decision", "review"];
const PHASE_TYPE = TASK_TYPE;
const PROJECT_STAGE = ["initiation", "planning", "execution", "closure"];
const DELIVERY_MODEL = ["internal_delivery", "vendor_delivery", "co_delivery"];
const RISK_LIKELIHOOD = ["low", "medium", "high"];
const RISK_STATUS = ["open", "under_mitigation", "monitoring", "realized", "closed"];
const BLOCKER_STATUS = ["open", "in_progress", "resolved"];
const TARGET_TYPE = ["project", "phase", "task"] as const;

const FAMILIES = [
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

type Family = (typeof FAMILIES)[number];

interface Issue {
  severity: "error" | "warning";
  code: string;
  family?: Family | "envelope" | "project_stakeholders";
  index?: number;
  external_key?: string;
  field?: string;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function canonicalStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys
    .map((k) => JSON.stringify(k) + ":" + canonicalStringify((v as any)[k]))
    .join(",") + "}";
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireString(
  row: Record<string, unknown>,
  key: string,
  family: Family | "envelope" | "project_stakeholders",
  index: number,
  errors: Issue[],
): string | null {
  const v = row[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    errors.push({
      severity: "error",
      code: "missing_required_field",
      family,
      index,
      field: key,
      message: `${family}[${index}].${key} is required.`,
    });
    return null;
  }
  return v.trim();
}

function optionalEnum(
  row: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  family: Family,
  index: number,
  errors: Issue[],
): string | undefined {
  const v = row[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !allowed.includes(v)) {
    errors.push({
      severity: "error",
      code: "invalid_enum",
      family,
      index,
      field: key,
      message: `${family}[${index}].${key} must be one of: ${allowed.join(", ")}.`,
    });
    return undefined;
  }
  return v;
}

function optionalDate(
  row: Record<string, unknown>,
  key: string,
  family: Family,
  index: number,
  errors: Issue[],
): string | undefined {
  const v = row[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !ISO_DATE_RE.test(v)) {
    errors.push({
      severity: "error",
      code: "invalid_date",
      family,
      index,
      field: key,
      message: `${family}[${index}].${key} must be an ISO date (YYYY-MM-DD).`,
    });
    return undefined;
  }
  return v;
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp(405, { ok: false, error: "method_not_allowed" });
  }

  // ---- 1. Authenticate --------------------------------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResp(401, { ok: false, error: "not_authenticated" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  try {
    const verifier = createSupabaseTokenVerifier(userClient);
    await assertBrowserSessionOnly(req, verifier);
  } catch (guardError) {
    return toSafeErrorResponse(guardError, corsHeaders);
  }

  const token = authHeader.replace("Bearer ", "");
  const claimsRes = await userClient.auth.getClaims(token);
  if (claimsRes.error || !claimsRes.data?.claims?.sub) {
    return jsonResp(401, { ok: false, error: "not_authenticated" });
  }
  const userId = claimsRes.data.claims.sub as string;

  // Service-role client — used only AFTER authority checks.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- 2. Parse body ----------------------------------------------------
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp(400, { ok: false, error: "invalid_json_body" });
  }
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : null;
  const payload = body?.payload;
  if (!organizationId || !workspaceId || !isPlainObject(payload)) {
    return jsonResp(400, {
      ok: false,
      error: "invalid_request_shape",
      message: "organizationId, workspaceId, and payload are required.",
    });
  }

  // ---- 3. Profile active + active-org context ---------------------------
  const { data: profile } = await admin
    .from("profiles")
    .select("id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) {
    return jsonResp(401, { ok: false, error: "not_authenticated" });
  }
  if (profile.is_active === false) {
    return jsonResp(403, { ok: false, error: "inactive_user" });
  }

  // Confirm active context matches supplied org (best-effort — signals mismatch).
  const { data: activeCtx } = await userClient.rpc("get_my_active_context");
  const activeOrgId =
    activeCtx && typeof activeCtx === "object"
      ? (activeCtx as any).organization_id ?? null
      : null;
  if (activeOrgId && activeOrgId !== organizationId) {
    return jsonResp(403, { ok: false, error: "active_org_mismatch" });
  }

  // ---- 4. Org Admin authority ------------------------------------------
  const { data: isOrgAdmin, error: adminErr } = await admin.rpc("is_org_admin", {
    _user_id: userId,
    _organization_id: organizationId,
  });
  if (adminErr || !isOrgAdmin) {
    return jsonResp(403, { ok: false, error: "org_admin_required" });
  }

  // ---- 5. Workspace belongs to org and is active ------------------------
  const { data: ws } = await admin
    .from("workspaces")
    .select("id, name, organization_id, is_archived, is_active")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!ws) return jsonResp(404, { ok: false, error: "workspace_not_found" });
  if (ws.organization_id !== organizationId) {
    return jsonResp(403, { ok: false, error: "workspace_not_in_org" });
  }
  if (ws.is_archived || ws.is_active === false) {
    return jsonResp(403, { ok: false, error: "workspace_archived_or_inactive" });
  }

  // ---- 6. Server-side structural validation -----------------------------
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const defaults: Issue[] = [];

  const schemaVersion = typeof payload.schema_version === "string" ? payload.schema_version : "";
  const isV2 = schemaVersion === SCHEMA_VERSION_V2;
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(schemaVersion)) {
    errors.push({
      severity: "error",
      code: "invalid_schema_version",
      family: "envelope",
      field: "schema_version",
      message: `schema_version must be one of: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}.`,
    });
  }
  if (payload.import_type !== IMPORT_TYPE) {
    errors.push({
      severity: "error",
      code: "invalid_import_type",
      family: "envelope",
      field: "import_type",
      message: `import_type must be "${IMPORT_TYPE}".`,
    });
  }
  const source = isPlainObject(payload.source) ? payload.source : null;
  if (!source || typeof source.source_name !== "string" || !source.source_name.trim()) {
    errors.push({
      severity: "error",
      code: "missing_required_field",
      family: "envelope",
      field: "source.source_name",
      message: "source.source_name is required.",
    });
  }
  for (const fam of FAMILIES) {
    if (!Array.isArray(payload[fam])) {
      errors.push({
        severity: "error",
        code: "missing_required_array",
        family: "envelope",
        field: fam,
        message: `Required top-level array "${fam}" is missing.`,
      });
    }
  }
  if (isV2 && !Array.isArray(payload.project_stakeholders)) {
    errors.push({
      severity: "error",
      code: "missing_required_array",
      family: "envelope",
      field: "project_stakeholders",
      message: `Required top-level array "project_stakeholders" is missing for schema_version "${SCHEMA_VERSION_V2}".`,
    });
  }
  if (errors.length) {
    return respondFailure(admin, {
      organizationId,
      workspaceId,
      userId,
      payload,
      source,
      ws,
      errors,
      warnings,
      defaults,
    });
  }

  // Row-level checks
  const programs = payload.programs as any[];
  const projects = payload.projects as any[];
  const team = payload.project_team_members as any[];
  const phases = payload.phases as any[];
  const tasks = payload.tasks as any[];
  const assignments = payload.task_assignments as any[];
  const risks = payload.risks as any[];
  const blockers = payload.blockers as any[];
  const updates = payload.execution_updates as any[];
  const stakeholders = (isV2 && Array.isArray(payload.project_stakeholders)
    ? (payload.project_stakeholders as any[])
    : []) as any[];

  const checkDupKeys = (fam: Family, rows: any[]) => {
    const seen = new Map<string, number>();
    rows.forEach((r, i) => {
      const k = typeof r?.external_key === "string" ? r.external_key : null;
      if (!k) return;
      if (seen.has(k)) {
        errors.push({
          severity: "error",
          code: "duplicate_external_key",
          family: fam,
          index: i,
          external_key: k,
          message: `Duplicate external_key "${k}" in ${fam} (also at index ${seen.get(k)}).`,
        });
      } else seen.set(k, i);
    });
  };

  // Structural per-row
  programs.forEach((r, i) => {
    requireString(r, "external_key", "programs", i, errors);
    requireString(r, "name", "programs", i, errors);
    optionalEnum(r, "status", PM_STATUS, "programs", i, errors);
  });
  projects.forEach((r, i) => {
    requireString(r, "external_key", "projects", i, errors);
    requireString(r, "name", "projects", i, errors);
    optionalEnum(r, "delivery_model", DELIVERY_MODEL, "projects", i, errors);
    optionalEnum(r, "project_stage", PROJECT_STAGE, "projects", i, errors);
    optionalEnum(r, "status", PM_STATUS, "projects", i, errors);
    optionalEnum(r, "priority", PM_PRIORITY, "projects", i, errors);
    const s = optionalDate(r, "planned_start", "projects", i, errors);
    const e = optionalDate(r, "planned_end", "projects", i, errors);
    if (s && e && e < s) {
      errors.push({
        severity: "error",
        code: "date_range_invalid",
        family: "projects",
        index: i,
        external_key: r.external_key,
        message: "planned_end must be on or after planned_start.",
      });
    }
  });
  team.forEach((r, i) => {
    requireString(r, "external_key", "project_team_members", i, errors);
    requireString(r, "project_external_key", "project_team_members", i, errors);
    const email = requireString(r, "user_email", "project_team_members", i, errors);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      errors.push({
        severity: "error",
        code: "invalid_email",
        family: "project_team_members",
        index: i,
        field: "user_email",
        external_key: r.external_key,
        message: `user_email "${email}" is not a valid email.`,
      });
    }
  });
  phases.forEach((r, i) => {
    requireString(r, "external_key", "phases", i, errors);
    requireString(r, "project_external_key", "phases", i, errors);
    requireString(r, "name", "phases", i, errors);
    optionalEnum(r, "phase_type", PHASE_TYPE, "phases", i, errors);
    optionalEnum(r, "status", PM_STATUS, "phases", i, errors);
    const s = optionalDate(r, "planned_start", "phases", i, errors);
    const e = optionalDate(r, "planned_end", "phases", i, errors);
    if (s && e && e < s) {
      errors.push({
        severity: "error",
        code: "date_range_invalid",
        family: "phases",
        index: i,
        external_key: r.external_key,
        message: "planned_end must be on or after planned_start.",
      });
    }
  });
  tasks.forEach((r, i) => {
    requireString(r, "external_key", "tasks", i, errors);
    requireString(r, "project_external_key", "tasks", i, errors);
    requireString(r, "phase_external_key", "tasks", i, errors);
    requireString(r, "name", "tasks", i, errors);
    optionalEnum(r, "task_type", TASK_TYPE, "tasks", i, errors);
    optionalEnum(r, "status", PM_STATUS, "tasks", i, errors);
    optionalEnum(r, "priority", PM_PRIORITY, "tasks", i, errors);
    const s = optionalDate(r, "planned_start", "tasks", i, errors);
    const d = optionalDate(r, "due_date", "tasks", i, errors);
    if (s && d && d < s) {
      errors.push({
        severity: "error",
        code: "date_range_invalid",
        family: "tasks",
        index: i,
        external_key: r.external_key,
        message: "due_date must be on or after planned_start.",
      });
    }
  });
  assignments.forEach((r, i) => {
    requireString(r, "external_key", "task_assignments", i, errors);
    requireString(r, "task_external_key", "task_assignments", i, errors);
    requireString(r, "assignee_email", "task_assignments", i, errors);
  });
  risks.forEach((r, i) => {
    requireString(r, "external_key", "risks", i, errors);
    requireString(r, "title", "risks", i, errors);
    const tt = optionalEnum(r, "target_type", TARGET_TYPE, "risks", i, errors);
    if (!tt) {
      errors.push({
        severity: "error",
        code: "missing_required_field",
        family: "risks",
        index: i,
        field: "target_type",
        message: "risks[].target_type is required.",
      });
    }
    requireString(r, "target_external_key", "risks", i, errors);
    optionalEnum(r, "likelihood", RISK_LIKELIHOOD, "risks", i, errors);
    optionalEnum(r, "impact", PM_PRIORITY, "risks", i, errors);
    optionalEnum(r, "status", RISK_STATUS, "risks", i, errors);
  });
  blockers.forEach((r, i) => {
    requireString(r, "external_key", "blockers", i, errors);
    requireString(r, "title", "blockers", i, errors);
    const tt = optionalEnum(r, "target_type", TARGET_TYPE, "blockers", i, errors);
    if (!tt) {
      errors.push({
        severity: "error",
        code: "missing_required_field",
        family: "blockers",
        index: i,
        field: "target_type",
        message: "blockers[].target_type is required.",
      });
    }
    requireString(r, "target_external_key", "blockers", i, errors);
    optionalEnum(r, "severity", PM_PRIORITY, "blockers", i, errors);
    optionalEnum(r, "status", BLOCKER_STATUS, "blockers", i, errors);
  });
  updates.forEach((r, i) => {
    requireString(r, "external_key", "execution_updates", i, errors);
    requireString(r, "summary", "execution_updates", i, errors);
    const tt = optionalEnum(r, "target_type", TARGET_TYPE, "execution_updates", i, errors);
    if (!tt) {
      errors.push({
        severity: "error",
        code: "missing_required_field",
        family: "execution_updates",
        index: i,
        field: "target_type",
        message: "execution_updates[].target_type is required.",
      });
    }
    requireString(r, "target_external_key", "execution_updates", i, errors);
    const d = r?.update_date;
    if (typeof d !== "string" || !ISO_DATE_RE.test(d)) {
      errors.push({
        severity: "error",
        code: "invalid_date",
        family: "execution_updates",
        index: i,
        field: "update_date",
        external_key: r?.external_key,
        message: "execution_updates[].update_date must be an ISO date (YYYY-MM-DD).",
      });
    }
  });

  // Duplicate external_key per family
  for (const fam of FAMILIES) {
    checkDupKeys(fam, payload[fam] as any[]);
  }

  // In-payload references, parent/child date containment, normalized name
  // duplicates, suspicious timeline-label task names, empty-parent warnings,
  // and execution_update out-of-window warnings are all produced by the
  // shared containment engine so dry-run and commit stay in lockstep.
  {
    const c = runContainmentValidation(payload);
    for (const e of c.errors) errors.push(e as Issue);
    for (const w of c.warnings) warnings.push(w as Issue);
  }

  // Duplicate team-member and task-assignment emails within same parent scope.
  // (Not covered by the shared containment module.)
  const teamProjUsers = new Map<string, Set<string>>();
  team.forEach((m, i) => {
    if (!m.project_external_key || !m.user_email) return;
    const key = String(m.user_email).toLowerCase();
    const set = teamProjUsers.get(m.project_external_key) ?? new Set<string>();
    if (set.has(key)) {
      errors.push({
        severity: "error",
        code: "duplicate_name_in_payload",
        family: "project_team_members",
        index: i,
        external_key: m.external_key,
        message: `Duplicate team member "${key}" on project "${m.project_external_key}".`,
      });
    } else set.add(key);
    teamProjUsers.set(m.project_external_key, set);
  });
  const asgTaskUsers = new Map<string, Set<string>>();
  assignments.forEach((a, i) => {
    if (!a.task_external_key || !a.assignee_email) return;
    const key = String(a.assignee_email).toLowerCase();
    const set = asgTaskUsers.get(a.task_external_key) ?? new Set<string>();
    if (set.has(key)) {
      errors.push({
        severity: "error",
        code: "duplicate_name_in_payload",
        family: "task_assignments",
        index: i,
        external_key: a.external_key,
        message: `Duplicate assignee "${key}" on task "${a.task_external_key}".`,
      });
    } else set.add(key);
    asgTaskUsers.set(a.task_external_key, set);
  });


  // Unsupported fields → warnings
  team.forEach((m, i) => {
    if (m.canonical_role_key) {
      warnings.push({
        severity: "warning",
        code: "unsupported_current_field",
        family: "project_team_members",
        index: i,
        external_key: m.external_key,
        field: "canonical_role_key",
        message:
          "canonical_role_key is captured but only role_label is planned for persistence in the first commit step.",
      });
    }
  });
  risks.forEach((r, i) => {
    if (r.owner_email) {
      warnings.push({
        severity: "warning",
        code: "owner_email_not_persisted",
        family: "risks",
        index: i,
        external_key: r.external_key,
        field: "owner_email",
        message:
          "risks table has no owner column; owner_email will be validated but not stored.",
      });
    }
    if (!r.likelihood) defaults.push({ severity: "warning", code: "default_will_be_applied", family: "risks", index: i, external_key: r.external_key, field: "likelihood", message: "Default likelihood 'medium' will be applied at commit." });
    if (!r.impact) defaults.push({ severity: "warning", code: "default_will_be_applied", family: "risks", index: i, external_key: r.external_key, field: "impact", message: "Default impact 'medium' will be applied at commit." });
    if (!r.status) defaults.push({ severity: "warning", code: "default_will_be_applied", family: "risks", index: i, external_key: r.external_key, field: "status", message: "Default status 'open' will be applied at commit." });
  });
  blockers.forEach((b, i) => {
    if (b.owner_email) {
      warnings.push({
        severity: "warning",
        code: "owner_email_not_persisted",
        family: "blockers",
        index: i,
        external_key: b.external_key,
        field: "owner_email",
        message:
          "blockers table has no owner column; owner_email will be validated but not stored.",
      });
    }
    if (!b.severity) defaults.push({ severity: "warning", code: "default_will_be_applied", family: "blockers", index: i, external_key: b.external_key, field: "severity", message: "Default severity 'medium' will be applied at commit." });
    if (!b.status) defaults.push({ severity: "warning", code: "default_will_be_applied", family: "blockers", index: i, external_key: b.external_key, field: "status", message: "Default status 'open' will be applied at commit." });
  });
  updates.forEach((u, i) => {
    if (!u.author_email) {
      defaults.push({
        severity: "warning",
        code: "default_will_be_applied",
        family: "execution_updates",
        index: i,
        external_key: u.external_key,
        field: "author_email",
        message: "author_email omitted — the importing user will be used as author at commit.",
      });
    }
  });

  // ---- 7. Database-side validation --------------------------------------
  // Program create/reuse plan (scope: workspace)
  const { data: existingPrograms } = await admin
    .from("programs")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("is_archived", false);
  const existingProgramNames = new Set(
    (existingPrograms ?? []).map((p: any) => String(p.name)),
  );

  let programsToCreate = 0;
  let programsToReuse = 0;
  programs.forEach((p, i) => {
    if (!p.name) return;
    if (existingProgramNames.has(p.name)) {
      programsToReuse += 1;
      warnings.push({
        severity: "warning",
        code: "program_will_be_reused",
        family: "programs",
        index: i,
        external_key: p.external_key,
        message: `Program "${p.name}" already exists in workspace and will be reused (not recreated).`,
      });
    } else {
      programsToCreate += 1;
    }
  });

  // Projects — create-only
  const { data: existingProjects } = await admin
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("is_archived", false);
  const existingProjectNames = new Set(
    (existingProjects ?? []).map((p: any) => String(p.name)),
  );
  projects.forEach((p, i) => {
    if (!p.name) return;
    if (existingProjectNames.has(p.name)) {
      errors.push({
        severity: "error",
        code: "project_name_conflict",
        family: "projects",
        index: i,
        external_key: p.external_key,
        field: "name",
        message: `Project "${p.name}" already exists in the target workspace. This step is create-only.`,
      });
    }
  });

  // Collect emails to resolve → profiles + workspace membership
  const allEmails = new Set<string>();
  const addEmail = (v: unknown) => {
    if (typeof v === "string" && v.trim()) allEmails.add(v.trim().toLowerCase());
  };
  team.forEach((m) => addEmail(m.user_email));
  assignments.forEach((a) => addEmail(a.assignee_email));
  risks.forEach((r) => addEmail(r.owner_email));
  blockers.forEach((b) => addEmail(b.owner_email));
  updates.forEach((u) => addEmail(u.author_email));
  // v2: pull internal-stakeholder emails so they land in the same profile/membership lookup.
  stakeholders.forEach((s) => {
    if (s?.stakeholder_type === "workspace_member") addEmail(s.user_email);
  });

  const emailsArr = Array.from(allEmails);
  let profileMap = new Map<string, { id: string; is_active: boolean }>();
  let wsMemberSet = new Set<string>();
  let orgMemberSet = new Set<string>();
  if (emailsArr.length > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, email, is_active")
      .in("email", emailsArr);
    for (const p of profs ?? []) {
      if (p?.email) {
        profileMap.set(String(p.email).toLowerCase(), {
          id: p.id,
          is_active: p.is_active !== false,
        });
      }
    }
    const userIds = Array.from(profileMap.values()).map((v) => v.id);
    if (userIds.length > 0) {
      const { data: wsm } = await admin
        .from("workspace_memberships")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .in("user_id", userIds);
      wsMemberSet = new Set((wsm ?? []).map((r: any) => r.user_id));
      const { data: orgm } = await admin
        .from("organization_memberships")
        .select("user_id, status")
        .eq("organization_id", organizationId)
        .in("user_id", userIds);
      orgMemberSet = new Set(
        (orgm ?? []).filter((r: any) => r.status === "active").map((r: any) => r.user_id),
      );
    }
  }

  const resolveUser = (
    fam: Family | "envelope" | "project_stakeholders",
    index: number,
    external_key: string | undefined,
    field: string,
    email: string | undefined | null,
    required: boolean,
  ): boolean => {
    if (!email) {
      if (required) {
        errors.push({
          severity: "error",
          code: "missing_required_field",
          family: fam,
          index,
          external_key,
          field,
          message: `${fam}[${index}].${field} is required.`,
        });
      }
      return false;
    }
    const key = email.toLowerCase();
    const p = profileMap.get(key);
    if (!p) {
      errors.push({
        severity: "error",
        code: "user_not_found",
        family: fam,
        index,
        external_key,
        field,
        message: `No active profile found for email "${key}".`,
      });
      return false;
    }
    if (!p.is_active || !orgMemberSet.has(p.id)) {
      errors.push({
        severity: "error",
        code: "user_inactive",
        family: fam,
        index,
        external_key,
        field,
        message: `User "${key}" is not an active member of the selected organization.`,
      });
      return false;
    }
    if (!wsMemberSet.has(p.id)) {
      errors.push({
        severity: "error",
        code: "user_not_in_workspace",
        family: fam,
        index,
        external_key,
        field,
        message: `User "${key}" is not a member of workspace "${ws.name}".`,
      });
      return false;
    }
    return true;
  };

  team.forEach((m, i) => resolveUser("project_team_members", i, m.external_key, "user_email", m.user_email, true));
  assignments.forEach((a, i) => resolveUser("task_assignments", i, a.external_key, "assignee_email", a.assignee_email, true));
  risks.forEach((r, i) => { if (r.owner_email) resolveUser("risks", i, r.external_key, "owner_email", r.owner_email, false); });
  blockers.forEach((b, i) => { if (b.owner_email) resolveUser("blockers", i, b.external_key, "owner_email", b.owner_email, false); });
  updates.forEach((u, i) => { if (u.author_email) resolveUser("execution_updates", i, u.external_key, "author_email", u.author_email, true); });

  // ---- 7B. v2 Project Stakeholders + Task accountability ---------------
  // Stakeholder-row problems use the `project_stakeholders` issue family so
  // the client surface can render them alongside other row-level families.
  const projectKeys = new Set(
    projects.map((p) => (typeof p?.external_key === "string" ? p.external_key : "")).filter(Boolean),
  );
  const stakeholderByKey = new Map<string, any>();
  const validStakeholderIndexes = new Set<number>();
  let taskExecutorLinksAfterDedup = 0;
  let taskRequesterLinks = 0;
  const STAKE_MAX_KEY = 120;
  if (isV2) {
    // Structural row-level checks + dup keys.
    const seenStake = new Map<string, number>();
    stakeholders.forEach((s, i) => {
      const errBefore = errors.length;
      const ek = requireString(s, "external_key", "project_stakeholders", i, errors);
      const pk = requireString(s, "project_external_key", "project_stakeholders", i, errors);
      const stype = s?.stakeholder_type;
      if (!(STAKEHOLDER_TYPES as readonly string[]).includes(stype)) {
        errors.push({
          severity: "error",
          code: "invalid_enum",
          family: "project_stakeholders",
          index: i,
          field: "stakeholder_type",
          external_key: ek ?? undefined,
          message: `project_stakeholders[${i}].stakeholder_type must be one of: ${STAKEHOLDER_TYPES.join(", ")}.`,
        });
      }
      if (stype === "workspace_member") {
        const em = typeof s?.user_email === "string" ? s.user_email.trim() : "";
        if (!em) {
          errors.push({
            severity: "error",
            code: "missing_required_field",
            family: "project_stakeholders",
            index: i,
            field: "user_email",
            external_key: ek ?? undefined,
            message: `Internal stakeholder "${ek ?? i}" requires user_email.`,
          });
        } else if (!/^\S+@\S+\.\S+$/.test(em)) {
          errors.push({
            severity: "error",
            code: "invalid_email",
            family: "project_stakeholders",
            index: i,
            field: "user_email",
            external_key: ek ?? undefined,
            message: `Stakeholder user_email "${em}" is not a valid email.`,
          });
        } else {
          // Reuse Workspace/Org membership resolver.
          resolveUser("project_stakeholders", i, ek ?? undefined, "user_email", em, true);
        }
      }
      if (stype === "external") {
        const nm = typeof s?.external_name === "string" ? s.external_name.trim() : "";
        if (!nm) {
          errors.push({
            severity: "error",
            code: "missing_required_field",
            family: "project_stakeholders",
            index: i,
            field: "external_name",
            external_key: ek ?? undefined,
            message: `External stakeholder "${ek ?? i}" requires external_name.`,
          });
        }
      }
      if (pk && !projectKeys.has(pk)) {
        errors.push({
          severity: "error",
          code: "broken_reference",
          family: "project_stakeholders",
          index: i,
          field: "project_external_key",
          external_key: ek ?? undefined,
          message: `Stakeholder "${ek ?? i}" references project "${pk}" which is not defined in this payload.`,
        });
      }
      if (ek) {
        if (seenStake.has(ek)) {
          errors.push({
            severity: "error",
            code: "duplicate_external_key",
            family: "project_stakeholders",
            index: i,
            external_key: ek,
            message: `Duplicate stakeholder external_key "${ek}" (also at index ${seenStake.get(ek)}).`,
          });
        } else {
          seenStake.set(ek, i);
          stakeholderByKey.set(ek, s);
        }
      }
      if (errors.length === errBefore) validStakeholderIndexes.add(i);
    });

    // TAE.11A.2 — only stakeholder rows that passed ALL row-level validation
    // (structural, membership resolution, project reference, uniqueness) may
    // resolve Task Requester/Executor references and contribute to planned
    // link counts. Rows that are declared but invalid are silently ignored
    // by the task-reference resolver (the row already carries its own
    // errors under the project_stakeholders family, so we do not double-
    // report on the task side).
    const validStakeholderByKey = new Map<string, any>();
    stakeholders.forEach((s, i) => {
      if (!validStakeholderIndexes.has(i)) return;
      const ek = typeof s?.external_key === "string" ? s.external_key : "";
      if (ek) validStakeholderByKey.set(ek, s);
    });

    // Task accountability refs — invalid field values MUST produce precise
    // validation errors and MUST NOT enter reference lookups or plan counts.
    tasks.forEach((t, i) => {
      const rawReq = t?.requested_by_stakeholder_external_key;
      if (rawReq !== undefined && rawReq !== null) {
        if (typeof rawReq !== "string" || rawReq.trim().length === 0 || rawReq.length > STAKE_MAX_KEY) {
          errors.push({
            severity: "error",
            code: "invalid_field_value",
            family: "tasks",
            index: i,
            external_key: t?.external_key,
            field: "requested_by_stakeholder_external_key",
            message: `Task "${t?.external_key}" requested_by_stakeholder_external_key must be a non-empty string of at most ${STAKE_MAX_KEY} characters.`,
          });
        } else {
          const req = rawReq;
          const st = validStakeholderByKey.get(req);
          if (!st) {
            // Silent-skip if the stakeholder row is declared but invalid —
            // its own row errors already cover the failure. Only emit
            // broken_reference when the key is not declared at all.
            if (!stakeholderByKey.has(req)) {
              errors.push({
                severity: "error",
                code: "broken_reference",
                family: "tasks",
                index: i,
                external_key: t?.external_key,
                field: "requested_by_stakeholder_external_key",
                message: `Task "${t?.external_key}" requester stakeholder "${req}" is not declared in project_stakeholders[].`,
              });
            }
          } else if (st.project_external_key !== t?.project_external_key) {
            errors.push({
              severity: "error",
              code: "phase_project_mismatch",
              family: "tasks",
              index: i,
              external_key: t?.external_key,
              field: "requested_by_stakeholder_external_key",
              message: `Task "${t?.external_key}" requester "${req}" belongs to project "${st.project_external_key}", not the task's project "${t?.project_external_key}".`,
            });
          } else {
            taskRequesterLinks += 1;
          }
        }
      }
      const rawExecs = t?.executed_by_stakeholder_external_keys;
      if (rawExecs !== undefined && rawExecs !== null) {
        if (!Array.isArray(rawExecs)) {
          errors.push({
            severity: "error",
            code: "invalid_field_value",
            family: "tasks",
            index: i,
            external_key: t?.external_key,
            field: "executed_by_stakeholder_external_keys",
            message: `Task "${t?.external_key}" executed_by_stakeholder_external_keys must be an array of stakeholder external keys.`,
          });
        } else {
          const validExecs: string[] = [];
          rawExecs.forEach((k: unknown, ei: number) => {
            if (typeof k !== "string" || k.trim().length === 0 || k.length > STAKE_MAX_KEY) {
              errors.push({
                severity: "error",
                code: "invalid_field_value",
                family: "tasks",
                index: i,
                external_key: t?.external_key,
                field: `executed_by_stakeholder_external_keys[${ei}]`,
                message: `Task "${t?.external_key}" executor entry at index ${ei} must be a non-empty string of at most ${STAKE_MAX_KEY} characters.`,
              });
            } else {
              validExecs.push(k);
            }
          });
          if (validExecs.length === 0) return;
          const dedup = new Set<string>();
          const dupSeen = new Set<string>();
          for (const k of validExecs) {
            if (dedup.has(k)) dupSeen.add(k);
            else dedup.add(k);
          }
          if (dupSeen.size > 0) {
            warnings.push({
              severity: "warning",
              code: "duplicate_executor_reference",
              family: "tasks",
              index: i,
              external_key: t?.external_key,
              field: "executed_by_stakeholder_external_keys",
              message: `Task "${t?.external_key}" listed executor(s) more than once: ${Array.from(dupSeen).join(", ")}. Duplicates will be deduplicated.`,
            });
          }
          for (const key of dedup) {
            const st = validStakeholderByKey.get(key);
            if (!st) {
              // Silent-skip if the stakeholder row is declared but invalid.
              if (!stakeholderByKey.has(key)) {
                errors.push({
                  severity: "error",
                  code: "broken_reference",
                  family: "tasks",
                  index: i,
                  external_key: t?.external_key,
                  field: "executed_by_stakeholder_external_keys",
                  message: `Task "${t?.external_key}" executor "${key}" is not declared in project_stakeholders[].`,
                });
              }
            } else if (st.project_external_key !== t?.project_external_key) {
              errors.push({
                severity: "error",
                code: "phase_project_mismatch",
                family: "tasks",
                index: i,
                external_key: t?.external_key,
                field: "executed_by_stakeholder_external_keys",
                message: `Task "${t?.external_key}" executor "${key}" belongs to project "${st.project_external_key}", not the task's project "${t?.project_external_key}".`,
              });
            } else {
              taskExecutorLinksAfterDedup += 1;
            }
          }
        }
      }
    });
  }

  // ---- 8. Plan counts ---------------------------------------------------
  const errorRowKeys = new Set<string>();
  for (const e of errors) {
    if (e.family && e.external_key) errorRowKeys.add(`${e.family}:${e.external_key}`);
  }
  const survivingCount = (fam: Family, rows: any[]) =>
    rows.filter((r) => !r?.external_key || !errorRowKeys.has(`${fam}:${r.external_key}`)).length;

  const counts = {
    programs: programs.length,
    projects: projects.length,
    project_team_members: team.length,
    phases: phases.length,
    tasks: tasks.length,
    task_assignments: assignments.length,
    risks: risks.length,
    blockers: blockers.length,
    execution_updates: updates.length,
    project_stakeholders: stakeholders.length,
  };

  const plan = {
    programs_to_create: programsToCreate,
    programs_to_reuse: programsToReuse,
    projects_to_create: survivingCount("projects", projects),
    phases_to_create: survivingCount("phases", phases),
    tasks_to_create: survivingCount("tasks", tasks),
    project_team_members_to_create: survivingCount("project_team_members", team),
    task_assignments_to_create: survivingCount("task_assignments", assignments),
    risks_to_create: survivingCount("risks", risks),
    blockers_to_create: survivingCount("blockers", blockers),
    execution_updates_to_create: survivingCount("execution_updates", updates),
    // v2 additive; 0 for v1 payloads. Only valid stakeholder rows contribute.
    project_stakeholders_to_create: isV2 ? validStakeholderIndexes.size : 0,
    task_requester_links_to_create: taskRequesterLinks,
    task_executor_links_to_create: taskExecutorLinksAfterDedup,
  };


  return respondSuccess(admin, {
    organizationId,
    workspaceId,
    userId,
    payload,
    source,
    ws,
    counts,
    plan,
    errors,
    warnings,
    defaults,
  });
});

/* -------------------------------------------------------------------------- */
/* Batch write helpers                                                        */
/* -------------------------------------------------------------------------- */

function buildIssueSummary(issues: Issue[]) {
  const byCode: Record<string, number> = {};
  const byFamily: Record<string, number> = {};
  for (const i of issues) {
    byCode[i.code] = (byCode[i.code] ?? 0) + 1;
    if (i.family) byFamily[i.family] = (byFamily[i.family] ?? 0) + 1;
  }
  return {
    total: issues.length,
    by_code: byCode,
    by_family: byFamily,
    // Non-sensitive metadata only — no raw values from the payload.
    issues: issues.slice(0, 500).map((i) => ({
      severity: i.severity,
      code: i.code,
      family: i.family ?? null,
      index: i.index ?? null,
      field: i.field ?? null,
    })),
  };
}

async function writeBatch(
  admin: any,
  args: {
    organizationId: string;
    workspaceId: string;
    userId: string;
    payload: any;
    source: any;
    ws: any;
    status: "dry_run_valid" | "dry_run_failed";
    counts: Record<string, number>;
    plan: Record<string, number> | null;
    errors: Issue[];
    warnings: Issue[];
    defaults: Issue[];
  },
) {
  const hash = await sha256Hex(canonicalStringify(args.payload));
  const safeSummary = {
    workspace_id: args.workspaceId,
    workspace_name: args.ws?.name ?? null,
    plan: args.plan ?? {},
    counts_of_warnings: args.warnings.length,
    counts_of_defaults: args.defaults.length,
    counts_of_errors: args.errors.length,
  };
  const safeIssues = {
    errors: buildIssueSummary(args.errors),
    warnings: buildIssueSummary(args.warnings),
    defaults: buildIssueSummary(args.defaults),
  };
  const { data, error } = await admin
    .from("btpm_import_batches")
    .insert({
      organization_id: args.organizationId,
      workspace_id: args.workspaceId,
      requested_by: args.userId,
      schema_version: typeof args.payload?.schema_version === "string" ? args.payload.schema_version : "unknown",
      import_type: typeof args.payload?.import_type === "string" ? args.payload.import_type : "unknown",
      source_name: args.source?.source_name ?? null,
      source_file_name: args.source?.source_file_name ?? null,
      payload_hash: hash,
      status: args.status,
      counts_json: args.counts,
      safe_summary_json: safeSummary,
      safe_issue_summary_json: safeIssues,
      dry_run_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("btpm_import_batches insert failed", error);
    return null;
  }
  return data?.id ?? null;
}

async function respondSuccess(admin: any, args: any) {
  const ok = args.errors.length === 0;
  const batchId = await writeBatch(admin, {
    ...args,
    status: ok ? "dry_run_valid" : "dry_run_failed",
  });
  return jsonResp(200, {
    ok,
    batch_id: batchId,
    summary: {
      schema_version: typeof args.payload?.schema_version === "string" ? args.payload.schema_version : SCHEMA_VERSION,
      import_type: IMPORT_TYPE,
      source_name: args.source?.source_name ?? null,
      workspace_id: args.workspaceId,
      workspace_name: args.ws?.name ?? null,
      counts: args.counts,
      plan: args.plan,
    },
    errors: args.errors,
    warnings: args.warnings,
    defaults: args.defaults,
  });
}

async function respondFailure(admin: any, args: any) {
  const counts = {
    programs: Array.isArray(args.payload?.programs) ? args.payload.programs.length : 0,
    projects: Array.isArray(args.payload?.projects) ? args.payload.projects.length : 0,
    project_team_members: Array.isArray(args.payload?.project_team_members) ? args.payload.project_team_members.length : 0,
    phases: Array.isArray(args.payload?.phases) ? args.payload.phases.length : 0,
    tasks: Array.isArray(args.payload?.tasks) ? args.payload.tasks.length : 0,
    task_assignments: Array.isArray(args.payload?.task_assignments) ? args.payload.task_assignments.length : 0,
    risks: Array.isArray(args.payload?.risks) ? args.payload.risks.length : 0,
    blockers: Array.isArray(args.payload?.blockers) ? args.payload.blockers.length : 0,
    execution_updates: Array.isArray(args.payload?.execution_updates) ? args.payload.execution_updates.length : 0,
    project_stakeholders: Array.isArray(args.payload?.project_stakeholders) ? args.payload.project_stakeholders.length : 0,
  };
  const batchId = await writeBatch(admin, {
    ...args,
    status: "dry_run_failed",
    counts,
    plan: null,
  });
  return jsonResp(200, {
    ok: false,
    batch_id: batchId,
    summary: {
      schema_version: typeof args.payload?.schema_version === "string" ? args.payload.schema_version : SCHEMA_VERSION,
      import_type: IMPORT_TYPE,
      source_name: args.source?.source_name ?? null,
      workspace_id: args.workspaceId,
      workspace_name: args.ws?.name ?? null,
      counts,
      plan: null,
    },
    errors: args.errors,
    warnings: args.warnings,
    defaults: args.defaults,
  });
}
