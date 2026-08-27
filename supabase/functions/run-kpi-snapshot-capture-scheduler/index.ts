// BTPM — Wave C3, Steps C3.3 (+ C3.3a) + C3.4 + C3.8
// Automatic KPI Snapshot Capture — Period Resolver, Dry-Run, Execute,
// and (C3.8) Internal Signed System-Mode Invocation.
//
// C3.3a authority sequencing: service-role reads are NEVER performed
// before scope authorization is established. Scope resolution for
// project_id / kpi_definition_id uses a user-scoped (RLS-respecting)
// client first; unauthorized callers receive a generic 403 with no
// metadata leak.
//
// C3.4: adds mode='execute' which calculates eligible automatic KPIs
// for the most recently completed period using the C1.4 calculation
// engine and inserts official kpi_snapshots rows. Dry-run behavior
// is preserved exactly.
//
// C3.8: adds invocation_source='system' which permits the thin cron
// wrapper (`run-kpi-snapshot-capture-scheduler-cron`) to invoke this
// orchestrator under the "Internal Signed Scheduler Invocation"
// authority model. System mode:
//   - requires x-snapshot-scheduler-secret matching
//     KPI_SNAPSHOT_SCHEDULER_SECRET (constant-time compare)
//   - requires KPI_SNAPSHOT_SCHEDULER_ENABLED === "true"
//   - rejects any Authorization header (mutually exclusive with the
//     human-admin path)
//   - requires mode='execute' (system mode is submission-only,
//     never enumerative)
//   - rejects organization_id / workspace_id / project_id /
//     kpi_definition_id filters — system runs are org-wide and
//     iterate ALL eligible auto_snapshot_enabled KPIs
//   - service-role client is constructed only AFTER the secret/
//     enabled gate (mirrors C3.3a sequencing on the system path)
// User-mode behavior is preserved unchanged.
//
// Request contract:
//   { mode: "dry_run" | "execute",
//     as_of_date?, organization_id?, workspace_id?,
//     project_id?, kpi_definition_id? }
//   Extra fields => 400. Unsupported mode => 400.
//
// Hard rules (C3.1 / C3.2 / C3.3 freeze, preserved by C3.4):
//   - kpi_snapshots is the only official reporting source.
//   - kpi_updates is NEVER read or written here.
//   - Manual KPIs (source_mode='manual') are excluded.
//   - cadence='manual_only' is excluded.
//   - calculation_key='schedule_signal' is excluded.
//   - Archived KPIs (is_archived=true) are excluded.
//   - auto_snapshot_enabled MUST be true.
//   - target_type MUST be 'project' and target_id MUST resolve to a
//     non-archived project.
//   - capture-kpi-snapshot Edge Function is NOT called.
//   - KPI App / MuleSoft / outbox / attempts are NOT called or written.
//   - No cron / pg_cron / scheduler activation in this step.
//   - No frontend UI changes.
//   - Existing snapshots (manual or system) are NEVER overwritten.
//   - Eligibility is re-checked immediately before insert.
//   - Only calculationStatus='calculated' results are persisted.


import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { buildBrowserCorsHeaders } from "../_shared/browserCors.ts";
import { resolvePreviousCompletedKpiPeriod } from "../_shared/kpi/kpiPreviousPeriod.ts";
// C3.4: reuse the C1.4 KPI calculation engine and data adapter — no
// duplication of formula logic.
import { calculateAutomaticKpi } from "../_shared/kpi/kpiCalculationEngine.ts";
import { buildKpiCalculationInput } from "../_shared/kpi/kpiCalculationDataAdapter.ts";
import {
  getAutomaticKpiDefinition,
  type AutomaticKpiCalculationKey,
} from "../_shared/kpi/automaticKpiLibrary.ts";
import type { KpiCompletionMethod } from "../_shared/kpi/kpiCalculationTypes.ts";
// C3.8: snapshot-scheduler-specific secret + activation helpers. These
// are intentionally separate from the C2 KPI App scheduler helpers so
// the two schedulers are operator-controlled independently.
import {
  verifySnapshotSchedulerSecret,
  SnapshotSchedulerAuthError,
  isSnapshotSchedulerEnabled,
} from "../_shared/kpi-snapshot-scheduler-auth.ts";
// C3.9a / C3.9b: deterministic, non-AI narrative comment for automatic
// snapshots. C3.9b adds KPI-specific result sentences and target-type
// relevance filtering for the execution-update digest.
import {
  buildAutomaticSnapshotComment,
  getRelevantTargetTypesForCalculationKey,
  type ExecutionUpdateDigestRow,
} from "../_shared/kpi/kpiSnapshotNarrative.ts";
// C3.9k: due engine for system-mode candidate gating via
// kpi_schedule_policies. Reused unchanged from C3.9i — no due-logic
// duplication here.
import {
  evaluateKpiSchedulePolicyDue,
  type SchedulePolicyCadence,
} from "../_shared/kpi/kpiScheduleDue.ts";
// API-E.R4Z — Browser-only OAuth denial guard for the human-admin path.
// System-mode invocations (Authorization-free, secret-gated) never
// enter the guard branch below.
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

function json(data: unknown, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";
const SUPPORTED_CADENCES = new Set<Cadence>([
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

type SchedulerAction =
  | "would_create_snapshot"
  | "created_snapshot"
  | "skipped_existing_snapshot"
  | "skipped_not_eligible"
  | "calculation_not_ready"
  | "failed";

type SchedulerItem = {
  organization_id: string;
  workspace_id: string;
  project_id: string;
  project_name: string | null;
  kpi_definition_id: string;
  kpi_name: string;
  calculation_key: string | null;
  cadence: string;
  period_start: string | null;
  period_end: string | null;
  validity_date: string | null;
  action: SchedulerAction;
  reason?: string;
  existing_snapshot_id?: string | null;
  snapshot_id?: string | null;
  calculation_status?: string;
};

type KpiDefinitionRow = {
  id: string;
  name: string;
  organization_id: string;
  workspace_id: string;
  target_type: string;
  target_id: string;
  source_mode: string;
  is_archived: boolean;
  cadence: string;
  calculation_key: string | null;
  formula_version: number | null;
  completion_method: string | null;
  value_type: string | null;
  auto_snapshot_enabled: boolean;
};

type ProjectRow = {
  id: string;
  name: string | null;
  workspace_id: string;
  organization_id: string;
  is_archived: boolean;
};

Deno.serve(async (req) => {
  const cors = buildBrowserCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return json(
      { request_id: requestId, ok: false, error: "Method not allowed" },
      cors,
      405,
    );
  }

  try {
    const authHeader = req.headers.get("authorization");
    const snapshotSecretHeader = req.headers.get(
      "x-snapshot-scheduler-secret",
    );
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // API-E.R4Z — For Authorization-bearing (human-admin) requests, run
    // the browser-only OAuth denial guard BEFORE any request-body parsing,
    // scope-filter extraction, database access, RPC or service-role
    // construction. Authorization-free (system-mode) requests bypass the
    // guard entirely and are still gated by the snapshot-scheduler secret
    // and activation flag below.
    let userClient: ReturnType<typeof createClient> | null = null;
    if (authHeader) {
      userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      try {
        const verifier = createSupabaseTokenVerifier(userClient);
        await assertBrowserSessionOnly(req, verifier);
      } catch (guardError) {
        return toSafeErrorResponse(guardError, cors);
      }
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return json(
        { request_id: requestId, ok: false, error: "Invalid request body" },
        cors,
        400,
      );
    }

    const ALLOWED_KEYS = new Set([
      "mode",
      "as_of_date",
      "organization_id",
      "workspace_id",
      "project_id",
      "kpi_definition_id",
      // C3.8: system-mode invocation marker. Allowed in body so the
      // canonical orchestrator can distinguish the human-admin path
      // ("user", default) from the internal scheduled-cron path
      // ("system"). System mode is mutually exclusive with a JWT.
      "invocation_source",
      // C3.9k: optional ISO datetime UTC for system-mode due evaluation.
      // User mode does not accept this field (rejected below to keep the
      // human-admin contract unambiguous; user mode continues to use
      // as_of_date only).
      "as_of_datetime_utc",
    ]);
    const extraKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
    if (extraKeys.length > 0) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: `Unexpected fields: ${extraKeys.join(", ")}`,
        },
        cors,
        400,
      );
    }

    const b = body as Record<string, unknown>;

    if (b.mode !== "dry_run" && b.mode !== "execute") {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: "mode must be 'dry_run' or 'execute'",
        },
        cors,
        400,
      );
    }
    const mode = b.mode as "dry_run" | "execute";

    let asOfDate: string;
    if (b.as_of_date === undefined || b.as_of_date === null) {
      asOfDate = todayUtcIso();
    } else if (!isValidIsoDate(b.as_of_date)) {
      return json(
        { request_id: requestId, ok: false, error: "Invalid as_of_date" },
        cors,
        400,
      );
    } else {
      asOfDate = b.as_of_date;
    }

    // C3.9k: parse optional as_of_datetime_utc. System mode uses this
    // (or "now" UTC) to evaluate due-ness against kpi_schedule_policies.
    // User mode is intentionally NOT permitted to set as_of_datetime_utc
    // — the human-admin contract continues to use as_of_date only, to
    // avoid ambiguity between two date inputs in the test runner.
    let asOfDateTimeUtcInput: string | null = null;
    if (b.as_of_datetime_utc !== undefined && b.as_of_datetime_utc !== null) {
      if (typeof b.as_of_datetime_utc !== "string") {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "Invalid as_of_datetime_utc",
          },
          cors,
          400,
        );
      }
      const parsed = new Date(b.as_of_datetime_utc);
      if (Number.isNaN(parsed.getTime())) {
        return json(
          {
            request_id: requestId,
            ok: false,
            error:
              "Invalid as_of_datetime_utc (not parseable as ISO datetime)",
          },
          cors,
          400,
        );
      }
      asOfDateTimeUtcInput = parsed.toISOString();
    }

    function parseUuid(field: string): string | null {
      const v = b[field];
      if (v === undefined || v === null) return null;
      if (typeof v !== "string" || !UUID_RE.test(v)) {
        throw new Error(`Invalid ${field}`);
      }
      return v;
    }

    let organizationFilter: string | null;
    let workspaceFilter: string | null;
    let projectFilter: string | null;
    let kpiFilter: string | null;
    try {
      organizationFilter = parseUuid("organization_id");
      workspaceFilter = parseUuid("workspace_id");
      projectFilter = parseUuid("project_id");
      kpiFilter = parseUuid("kpi_definition_id");
    } catch (e) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: e instanceof Error ? e.message : "Invalid filter",
        },
        cors,
        400,
      );
    }

    // C3.8: parse invocation_source. Default = "user" (human-admin path,
    // unchanged). "system" engages the Internal Signed Scheduler
    // Invocation gate below.
    let invocationSource: "user" | "system" = "user";
    const invocationSourceInput = b.invocation_source;
    if (
      invocationSourceInput !== undefined &&
      invocationSourceInput !== null
    ) {
      if (
        invocationSourceInput !== "user" &&
        invocationSourceInput !== "system"
      ) {
        return json(
          { request_id: requestId, ok: false, error: "Invalid invocation_source" },
          cors,
          400,
        );
      }
      invocationSource = invocationSourceInput;
    }



    // ============================================================
    // C3.8 — System-mode (scheduled cron) branch
    // ============================================================
    if (invocationSource === "system") {
      // 1) System mode is submission-only — never enumerative.
      if (mode !== "execute") {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "system mode requires mode=execute",
          },
          cors,
          400,
        );
      }
      // 2) System mode is mutually exclusive with the human-admin path.
      if (authHeader) {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "system mode rejects Authorization header",
          },
          cors,
          401,
        );
      }
      // 3) System mode is org-wide — no scoped filters allowed.
      if (
        organizationFilter ||
        workspaceFilter ||
        projectFilter ||
        kpiFilter
      ) {
        return json(
          {
            request_id: requestId,
            ok: false,
            error:
              "system mode does not accept organization_id / workspace_id / project_id / kpi_definition_id",
          },
          cors,
          400,
        );
      }
      // 4) Constant-time secret gate.
      try {
        verifySnapshotSchedulerSecret(req);
      } catch (e) {
        const status =
          e instanceof SnapshotSchedulerAuthError ? e.status : 401;
        return json(
          { request_id: requestId, ok: false, error: "Unauthorized" },
          cors,
          status,
        );
      }
      // 5) Activation gate. Inert by default.
      if (!isSnapshotSchedulerEnabled()) {
        return json(
          {
            request_id: requestId,
            ok: true,
            mode,
            as_of_date: asOfDate,
            invocation_source: "system",
            activated: false,
            reason:
              "KPI_SNAPSHOT_SCHEDULER_ENABLED is not 'true'; scheduler is inert",
            candidate_count: 0,
            created_count: 0,
            skipped_existing_snapshot_count: 0,
            calculation_not_ready_count: 0,
            failed_count: 0,
            items: [],
            summary: {
              would_create: 0,
              created: 0,
              skipped_existing_snapshot: 0,
              skipped_not_eligible: 0,
              calculation_not_ready: 0,
              failed: 0,
            },
          },
          cors,
          200,
        );
      }
      // 6) Both gates passed. NOW it is safe to construct the service-
      //    role client. From C3.9k onward, system-mode candidate
      //    selection is gated by kpi_schedule_policies — only KPIs
      //    whose (workspace_id, cadence) matches a DUE active
      //    automatic_snapshot_capture policy are processed.
      const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // 7) C3.9k — read active automatic_snapshot_capture policies and
      //    evaluate due-ness using the C3.9i helper. We never duplicate
      //    due-window logic here.
      const asOfDateTimeUtcForDue =
        asOfDateTimeUtcInput ?? new Date().toISOString();

      const { data: policiesRaw, error: policiesErr } = await adminClient
        .from("kpi_schedule_policies")
        .select(
          "id, organization_id, workspace_id, process_type, cadence, delay_days_after_period_close, run_time_utc, is_active",
        )
        .eq("process_type", "automatic_snapshot_capture")
        .eq("is_active", true);

      if (policiesErr) {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: `Failed to read schedule policies: ${policiesErr.message?.slice(0, 200) ?? "unknown"}`,
          },
          cors,
          500,
        );
      }

      type DuePolicy = {
        organization_id: string;
        workspace_id: string;
        cadence: SchedulePolicyCadence;
        period_start: string;
        period_end: string;
        scheduled_run_at: string;
      };
      const duePolicies: DuePolicy[] = [];
      for (const p of (policiesRaw ?? []) as Array<{
        organization_id: string;
        workspace_id: string;
        cadence: string;
        delay_days_after_period_close: number;
        run_time_utc: string;
        is_active: boolean;
      }>) {
        const evalRes = evaluateKpiSchedulePolicyDue(
          {
            cadence: p.cadence,
            delay_days_after_period_close: p.delay_days_after_period_close,
            run_time_utc: p.run_time_utc,
            is_active: p.is_active,
          },
          asOfDateTimeUtcForDue,
        );
        if (
          evalRes.is_due &&
          evalRes.period_start &&
          evalRes.period_end &&
          evalRes.scheduled_run_at
        ) {
          duePolicies.push({
            organization_id: p.organization_id,
            workspace_id: p.workspace_id,
            cadence: p.cadence as SchedulePolicyCadence,
            period_start: evalRes.period_start,
            period_end: evalRes.period_end,
            scheduled_run_at: evalRes.scheduled_run_at,
          });
        }
      }

      // 8) No due policies => no-op response. Per C3.9k spec, do NOT
      //    create monitor run rows for empty due checks.
      if (duePolicies.length === 0) {
        return json(
          {
            request_id: requestId,
            ok: true,
            mode,
            as_of_date: asOfDate,
            as_of_datetime_utc: asOfDateTimeUtcForDue,
            invocation_source: "system",
            activated: true,
            due_policy_count: 0,
            processed_cadences: [],
            processed_workspace_count: 0,
            candidate_count: 0,
            created_count: 0,
            skipped_existing_snapshot_count: 0,
            calculation_not_ready_count: 0,
            failed_count: 0,
            items: [],
            reason: "no_due_policies",
            summary: {
              would_create: 0,
              created: 0,
              skipped_existing_snapshot: 0,
              skipped_not_eligible: 0,
              calculation_not_ready: 0,
              failed: 0,
            },
          },
          cors,
          200,
        );
      }

      // 9) Forward due-policy filter context to the shared core. The
      //    core will constrain candidate selection to (workspace_id,
      //    cadence) pairs that appear in duePolicies.
      return await runSchedulerCore({
        requestId,
        cors,
        mode,
        asOfDate,
        asOfDateTimeUtc: asOfDateTimeUtcForDue,
        invocationSource,
        adminClient,
        // System mode: no scope filters.
        effectiveOrgId: null,
        resolvedWorkspaceId: null,
        kpiFilter: null,
        projectFilter: null,
        userScopedKpiRow: null,
        userScopedProjectRow: null,
        requestedBy: null,
        duePolicies,
      });
    }

    // ============================================================
    // User-mode path (preserved unchanged from C3.3 / C3.3a / C3.4)
    // ============================================================
    // C3.9k: user mode does not accept as_of_datetime_utc — keep the
    // human-admin contract using as_of_date only.
    if (asOfDateTimeUtcInput) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error:
            "as_of_datetime_utc is only valid for system invocations; use as_of_date in user mode",
        },
        cors,
        400,
      );
    }

    // ============================================================
    // User-mode path (preserved unchanged from C3.3 / C3.3a / C3.4)
    // ============================================================
    if (snapshotSecretHeader) {
      // Defense-in-depth: do not allow a request to mix human JWT with
      // the snapshot scheduler secret. The two authority models are
      // disjoint.
      return json(
        {
          request_id: requestId,
          ok: false,
          error: "user mode rejects x-snapshot-scheduler-secret header",
        },
        cors,
        400,
      );
    }
    if (!authHeader) {
      return json(
        { request_id: requestId, ok: false, error: "Missing authorization" },
        cors,
        401,
      );
    }

    // ---------- Step 1: identify caller (user-scoped client only) ----------
    // API-E.R4Z: reuse the caller-scoped client constructed (and browser-
    // session-guarded) before body parsing. This narrow null check is a
    // type-tightening step only — the `if (!authHeader)` above guarantees
    // `userClient` is non-null on this path.
    if (!userClient) {
      return json(
        { request_id: requestId, ok: false, error: "Unauthorized" },
        cors,
        401,
      );
    }
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json(
        { request_id: requestId, ok: false, error: "Unauthorized" },
        cors,
        401,
      );
    }
    const callerId = userData.user.id;

    const { data: callerOrgRaw, error: callerOrgErr } = await userClient.rpc(
      "get_user_org_id",
      { _user_id: callerId },
    );
    if (callerOrgErr || !callerOrgRaw) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: "Caller has no organization scope",
        },
        cors,
        403,
      );
    }
    const callerOrgId = callerOrgRaw as string;

    if (organizationFilter && organizationFilter !== callerOrgId) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: "organization_id outside caller organization",
        },
        cors,
        403,
      );
    }
    const effectiveOrgId = callerOrgId;

    // Generic, non-leaky denial used whenever a scoped resource cannot be
    // resolved through the caller's RLS-respecting view, OR the caller
    // fails the authority gate. Identical message and status for all
    // not-found / not-authorized cases on scoped paths so existence of a
    // project/KPI cannot be inferred.
    const SCOPED_DENIAL = {
      request_id: requestId,
      ok: false,
      error: "Not found or not authorized",
    };

    // ---------- Step 2: resolve scope using USER-SCOPED reads only ----------
    // No service-role client is constructed yet. We must not leak
    // existence of project/KPI rows the caller cannot see via RLS.
    let resolvedWorkspaceId: string | null = workspaceFilter;
    let userScopedProjectRow: ProjectRow | null = null;
    let userScopedKpiRow: KpiDefinitionRow | null = null;

    if (kpiFilter) {
      const { data: kpiRow, error: kpiErr } = await userClient
        .from("kpi_definitions")
        .select(
          "id, name, organization_id, workspace_id, target_type, target_id, source_mode, is_archived, cadence, calculation_key, formula_version, completion_method, value_type, auto_snapshot_enabled",
        )
        .eq("id", kpiFilter)
        .maybeSingle();
      if (kpiErr) {
        // Do not surface DB error detail; treat as generic denial.
        return json(SCOPED_DENIAL, cors, 403);
      }
      if (!kpiRow) {
        return json(SCOPED_DENIAL, cors, 403);
      }
      userScopedKpiRow = kpiRow as KpiDefinitionRow;
      if (userScopedKpiRow.organization_id !== effectiveOrgId) {
        return json(SCOPED_DENIAL, cors, 403);
      }
      resolvedWorkspaceId = userScopedKpiRow.workspace_id;
      if (userScopedKpiRow.target_type === "project") {
        projectFilter = projectFilter ?? userScopedKpiRow.target_id;
      }
    }

    if (projectFilter) {
      const { data: projRow, error: projErr } = await userClient
        .from("projects")
        .select("id, name, workspace_id, organization_id, is_archived")
        .eq("id", projectFilter)
        .maybeSingle();
      if (projErr) {
        return json(SCOPED_DENIAL, cors, 403);
      }
      if (!projRow) {
        return json(SCOPED_DENIAL, cors, 403);
      }
      userScopedProjectRow = projRow as ProjectRow;
      if (userScopedProjectRow.organization_id !== effectiveOrgId) {
        return json(SCOPED_DENIAL, cors, 403);
      }
      if (
        resolvedWorkspaceId &&
        resolvedWorkspaceId !== userScopedProjectRow.workspace_id
      ) {
        return json(SCOPED_DENIAL, cors, 403);
      }
      resolvedWorkspaceId = userScopedProjectRow.workspace_id;
    }

    // ---------- Step 3: AUTHORITY GATE (before any service-role read) ----------
    const { data: isOrgAdmin, error: isOrgAdminErr } = await userClient.rpc(
      "is_org_admin",
      { _user_id: callerId, _organization_id: effectiveOrgId },
    );
    if (isOrgAdminErr) {
      return json(
        { request_id: requestId, ok: false, error: "Authorization check failed" },
        cors,
        500,
      );
    }
    const isOrgAdminBool = isOrgAdmin === true;

    if (!resolvedWorkspaceId) {
      // Org-wide dry-run: must be Org Admin BEFORE service-role enumeration.
      if (!isOrgAdminBool) {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "Org-wide dry-run requires Org Admin authority",
          },
          cors,
          403,
        );
      }
    } else if (!isOrgAdminBool) {
      const { data: wsAdmin, error: wsErr } = await userClient.rpc(
        "is_workspace_admin_or_higher",
        { _user_id: callerId, _workspace_id: resolvedWorkspaceId },
      );
      if (wsErr) {
        return json(
          { request_id: requestId, ok: false, error: "Authorization check failed" },
          cors,
          500,
        );
      }
      if (wsAdmin !== true) {
        // Generic denial — do not reveal whether scope exists.
        return json(SCOPED_DENIAL, cors, 403);
      }
    }

    // ---------- Step 4: NOW it is safe to construct service-role client ----------
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return await runSchedulerCore({
      requestId,
      cors,
      mode,
      asOfDate,
      asOfDateTimeUtc: null,
      invocationSource,
      adminClient,
      effectiveOrgId,
      resolvedWorkspaceId,
      kpiFilter,
      projectFilter,
      userScopedKpiRow,
      userScopedProjectRow,
      requestedBy: callerId,
      duePolicies: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json(
      { request_id: requestId, ok: false, error: msg.slice(0, 300) },
      cors,
      500,
    );
  }
});

// ============================================================================
// runSchedulerCore — shared post-authority enumeration / execute pipeline.
//
// Invoked by BOTH:
//   - the user-mode path, after C3.3a authority sequencing
//   - the C3.8 system-mode path, after secret + activation gates
//
// Eligibility filtering, period resolution, idempotency probes, calculation
// engine reuse, and kpi_snapshots insert behavior are IDENTICAL across the
// two paths — only the authority model upstream differs. This avoids any
// duplication of candidate selection or calculation logic.
// ============================================================================
async function runSchedulerCore(params: {
  requestId: string;
  cors: Record<string, string>;
  mode: "dry_run" | "execute";
  asOfDate: string;
  /** C3.9k — UTC ISO datetime used by system mode for due-policy
   *  evaluation. Null in user mode (user mode has no policy gating). */
  asOfDateTimeUtc: string | null;
  invocationSource: "user" | "system";
  // deno-lint-ignore no-explicit-any
  adminClient: any;
  effectiveOrgId: string | null;
  resolvedWorkspaceId: string | null;
  kpiFilter: string | null;
  projectFilter: string | null;
  userScopedKpiRow: KpiDefinitionRow | null;
  userScopedProjectRow: ProjectRow | null;
  requestedBy: string | null;
  /** C3.9k — when present, system-mode candidate selection is restricted
   *  to KPIs whose (organization_id, workspace_id, cadence) matches a
   *  due automatic_snapshot_capture policy. Per-policy period_start /
   *  period_end / scheduled_run_at are carried for response metadata.
   *  Null in user mode and when no policy gating applies. */
  duePolicies:
    | Array<{
        organization_id: string;
        workspace_id: string;
        cadence: SchedulePolicyCadence;
        period_start: string;
        period_end: string;
        scheduled_run_at: string;
      }>
    | null;
}): Promise<Response> {
  const {
    requestId,
    cors,
    mode,
    asOfDate,
    asOfDateTimeUtc,
    invocationSource,
    adminClient,
    effectiveOrgId,
    resolvedWorkspaceId,
    kpiFilter,
    projectFilter,
    userScopedKpiRow,
    userScopedProjectRow,
    requestedBy,
    duePolicies,
  } = params;

  // ----------------------------------------------------------------
  // C3.9 + C3.9a + C3.9b — Automatic Snapshot Capture Monitoring
  // (execute mode only).
  //
  // C3.9b workspace-visibility correction: the monitor UI is workspace-
  // scoped. C3.9a stored system-mode rows with workspace_id = NULL,
  // which hid them from workspace-scoped admin users. C3.9b creates
  // ONE run row per (organization, workspace) pair for system-mode
  // runs. User-mode runs continue to map 1:1 to (effectiveOrgId,
  // resolvedWorkspaceId).
  //
  // Items are routed to the run for THEIR OWN (organization_id,
  // workspace_id), so cross-org or cross-workspace mixing cannot
  // happen, regardless of invocation source.
  // ----------------------------------------------------------------
  type RunBucketKey = string; // `${org}::${ws ?? '_'}`
  type RunBucketState = {
    organizationId: string;
    workspaceId: string | null;
    runId: string | null;
    items: Array<Record<string, unknown>>;
  };
  const runBuckets = new Map<RunBucketKey, RunBucketState>();

  function bucketKey(orgId: string, wsId: string | null): RunBucketKey {
    return `${orgId}::${wsId ?? "_"}`;
  }

  function getOrInitBucket(
    orgId: string,
    wsId: string | null,
  ): RunBucketState {
    const key = bucketKey(orgId, wsId);
    const existing = runBuckets.get(key);
    if (existing) return existing;
    const fresh: RunBucketState = {
      organizationId: orgId,
      workspaceId: wsId,
      runId: null,
      items: [],
    };
    runBuckets.set(key, fresh);
    return fresh;
  }

  async function ensureRunRow(
    orgIdForRun: string,
    wsForRun: string | null,
  ): Promise<void> {
    if (mode !== "execute") return;
    const st = getOrInitBucket(orgIdForRun, wsForRun);
    if (st.runId) return;
    const { data: runRow, error: runErr } = await adminClient
      .from("kpi_snapshot_capture_runs")
      .insert({
        organization_id: orgIdForRun,
        workspace_id: st.workspaceId,
        requested_by: requestedBy,
        invocation_source: invocationSource,
        mode: "execute",
        as_of_date: asOfDate,
        status: "running",
      })
      .select("id")
      .single();
    if (runErr || !runRow) {
      console.warn(
        `[c3.9] Failed to create capture run row: ${runErr?.message ?? "unknown"}`,
      );
      return;
    }
    st.runId = runRow.id as string;
  }

  function pushMonitorItem(it: SchedulerItem): void {
    if (mode !== "execute") return;
    // C3.9b: route by (org, workspace) so workspace-scoped admins see
    // the runs that contain their KPIs.
    const target = getOrInitBucket(
      it.organization_id,
      it.workspace_id ?? null,
    );
    target.items.push({
      organization_id: it.organization_id,
      workspace_id: it.workspace_id,
      project_id: it.project_id,
      kpi_definition_id: it.kpi_definition_id,
      snapshot_id: it.snapshot_id ?? null,
      existing_snapshot_id: it.existing_snapshot_id ?? null,
      kpi_name: it.kpi_name ?? null,
      project_name: it.project_name ?? null,
      calculation_key: it.calculation_key ?? null,
      cadence: it.cadence,
      period_start: it.period_start,
      period_end: it.period_end,
      validity_date: it.validity_date,
      action: it.action,
      reason: it.reason ? it.reason.slice(0, 300) : null,
      calculation_status: it.calculation_status ?? null,
    });
  }

  async function finalizeAllRuns(
    finalStatusFn: (
      st: RunBucketState,
    ) => "completed" | "completed_with_errors" | "failed",
    globalErrorMessage: string | null,
    forceFailedFor?: Set<RunBucketKey>,
  ): Promise<void> {
    if (mode !== "execute") return;
    for (const [key, st] of runBuckets.entries()) {
      try {
        if (!st.runId) {
          await ensureRunRow(st.organizationId, st.workspaceId);
        }
        if (!st.runId) {
          console.warn(
            `[c3.9] Skipping finalize for bucket ${key} — no run row.`,
          );
          continue;
        }
        if (st.items.length > 0) {
          const rows = st.items.map((m) => ({ ...m, run_id: st.runId }));
          const { error: itemsErr } = await adminClient
            .from("kpi_snapshot_capture_run_items")
            .insert(rows);
          if (itemsErr) {
            console.warn(
              `[c3.9] Failed to insert run items for bucket ${key}: ${itemsErr.message}`,
            );
          }
        }
        const c = {
          candidate_count: st.items.length,
          created_count: 0,
          skipped_existing_snapshot_count: 0,
          skipped_not_eligible_count: 0,
          calculation_not_ready_count: 0,
          failed_count: 0,
        };
        for (const it of st.items) {
          switch ((it as { action: string }).action) {
            case "created_snapshot":
              c.created_count++;
              break;
            case "skipped_existing_snapshot":
              c.skipped_existing_snapshot_count++;
              break;
            case "skipped_not_eligible":
              c.skipped_not_eligible_count++;
              break;
            case "calculation_not_ready":
              c.calculation_not_ready_count++;
              break;
            case "failed":
              c.failed_count++;
              break;
          }
        }
        const status: "completed" | "completed_with_errors" | "failed" =
          forceFailedFor && forceFailedFor.has(key)
            ? "failed"
            : finalStatusFn(st);
        const { error: updErr } = await adminClient
          .from("kpi_snapshot_capture_runs")
          .update({
            status,
            completed_at: new Date().toISOString(),
            candidate_count: c.candidate_count,
            created_count: c.created_count,
            skipped_existing_snapshot_count: c.skipped_existing_snapshot_count,
            skipped_not_eligible_count: c.skipped_not_eligible_count,
            calculation_not_ready_count: c.calculation_not_ready_count,
            failed_count: c.failed_count,
            error_message: globalErrorMessage
              ? globalErrorMessage.slice(0, 300)
              : null,
            summary: {
              invocation_source: invocationSource,
              workspace_id: st.workspaceId,
            },
          })
          .eq("id", st.runId);
        if (updErr) {
          console.warn(
            `[c3.9] Failed to finalize run row for bucket ${key}: ${updErr.message}`,
          );
        }
      } catch (e) {
        console.warn(
          `[c3.9] finalizeAllRuns threw for bucket ${key}: ${
            e instanceof Error ? e.message : "unknown"
          }`,
        );
      }
    }
  }

  if (mode === "execute" && invocationSource === "user" && effectiveOrgId) {
    await ensureRunRow(effectiveOrgId, resolvedWorkspaceId);
  }

  let kpiQuery = adminClient
    .from("kpi_definitions")
    .select(
      "id, name, organization_id, workspace_id, target_type, target_id, source_mode, is_archived, cadence, calculation_key, formula_version, completion_method, value_type, auto_snapshot_enabled",
    )
    .eq("auto_snapshot_enabled", true)
    .eq("source_mode", "automatic")
    .eq("is_archived", false)
    .eq("target_type", "project");

  if (effectiveOrgId) {
    kpiQuery = kpiQuery.eq("organization_id", effectiveOrgId);
  }
  if (resolvedWorkspaceId) {
    kpiQuery = kpiQuery.eq("workspace_id", resolvedWorkspaceId);
  }
  if (kpiFilter) {
    kpiQuery = kpiQuery.eq("id", kpiFilter);
  }
  if (projectFilter) {
    kpiQuery = kpiQuery.eq("target_id", projectFilter);
  }

  // C3.9k — system-mode policy gating: pre-constrain the candidate
  // query to the workspaces and cadences appearing in due policies, so
  // we never enumerate KPIs from non-due (workspace, cadence) pairs. A
  // strict per-row check below additionally guarantees no leakage.
  let duePolicyKey: Set<string> | null = null;
  let duePolicyByKey:
    | Map<string, { period_start: string; period_end: string; scheduled_run_at: string }>
    | null = null;
  if (duePolicies && duePolicies.length > 0) {
    const wsIds = Array.from(new Set(duePolicies.map((d) => d.workspace_id)));
    const cadences = Array.from(new Set(duePolicies.map((d) => d.cadence)));
    kpiQuery = kpiQuery.in("workspace_id", wsIds).in("cadence", cadences);
    duePolicyKey = new Set(
      duePolicies.map(
        (d) => `${d.organization_id}::${d.workspace_id}::${d.cadence}`,
      ),
    );
    duePolicyByKey = new Map();
    for (const d of duePolicies) {
      duePolicyByKey.set(
        `${d.organization_id}::${d.workspace_id}::${d.cadence}`,
        {
          period_start: d.period_start,
          period_end: d.period_end,
          scheduled_run_at: d.scheduled_run_at,
        },
      );
    }
  }

  const { data: kpiRowsRaw, error: kpiRowsErr } = await kpiQuery;
  if (kpiRowsErr) {
    await finalizeAllRuns(
      () => "completed_with_errors",
      `Candidate query failed: ${kpiRowsErr.message}`,
    );
    return json(
      { request_id: requestId, ok: false, error: kpiRowsErr.message },
      cors,
      500,
    );
  }
  const kpiRows = (kpiRowsRaw ?? []) as KpiDefinitionRow[];

  // C3.9b — for system-mode execute runs, pre-create run rows per
  // (organization, workspace) pair so workspace-scoped admins can see
  // them. Empty cron runs (no candidates) still leave no audit noise.
  if (
    mode === "execute" &&
    invocationSource === "system" &&
    kpiRows.length > 0
  ) {
    const seen = new Set<RunBucketKey>();
    for (const k of kpiRows) {
      const key = bucketKey(k.organization_id, k.workspace_id);
      if (seen.has(key)) continue;
      seen.add(key);
      await ensureRunRow(k.organization_id, k.workspace_id);
    }
  }

  const projectIds = Array.from(
    new Set(
      kpiRows
        .filter((k) => k.target_type === "project")
        .map((k) => k.target_id),
    ),
  );
  const projectsById = new Map<string, ProjectRow>();
  if (projectIds.length > 0) {
    const { data: projRowsRaw, error: projRowsErr } = await adminClient
      .from("projects")
      .select("id, name, workspace_id, organization_id, is_archived")
      .in("id", projectIds);
    if (projRowsErr) {
      await finalizeAllRuns(
        () => "failed",
        `Project lookup failed: ${projRowsErr.message}`,
      );
      return json(
        { request_id: requestId, ok: false, error: projRowsErr.message },
        cors,
        500,
      );
    }
    for (const p of (projRowsRaw ?? []) as ProjectRow[]) {
      projectsById.set(p.id, p);
    }
  }

  const items: SchedulerItem[] = [];
  // C3.9 — mirror every persisted scheduler item into the monitor
  // buffer (execute mode only; pushMonitorItem is a no-op in dry_run).
  const _origPush = items.push.bind(items);
  items.push = ((...vals: SchedulerItem[]) => {
    for (const v of vals) pushMonitorItem(v);
    return _origPush(...vals);
  }) as typeof items.push;
  let wouldCreate = 0;
  let createdCount = 0;
  let failedCount = 0;
  let skippedExisting = 0;
  let skippedNotEligible = 0;
  let calculationNotReady = 0;

  for (const k of kpiRows) {
    if (k.source_mode !== "automatic") {
      skippedNotEligible++;
      items.push(buildIneligible(k, null, "source_mode is not automatic"));
      continue;
    }
    if (k.is_archived) {
      skippedNotEligible++;
      items.push(buildIneligible(k, null, "KPI is archived"));
      continue;
    }
    if (!SUPPORTED_CADENCES.has(k.cadence as Cadence)) {
      skippedNotEligible++;
      items.push(
        buildIneligible(
          k,
          null,
          `cadence '${k.cadence}' is not supported for automatic snapshot capture`,
        ),
      );
      continue;
    }
    if (!k.calculation_key) {
      skippedNotEligible++;
      items.push(buildIneligible(k, null, "calculation_key is null"));
      continue;
    }
    if (k.calculation_key === "schedule_signal") {
      skippedNotEligible++;
      items.push(
        buildIneligible(k, null, "schedule_signal is excluded from C3"),
      );
      continue;
    }
    if (k.target_type !== "project") {
      skippedNotEligible++;
      items.push(buildIneligible(k, null, "target_type is not 'project'"));
      continue;
    }
    const proj = projectsById.get(k.target_id);
    if (!proj) {
      skippedNotEligible++;
      items.push(buildIneligible(k, null, "target project not found"));
      continue;
    }
    if (proj.is_archived) {
      skippedNotEligible++;
      items.push(buildIneligible(k, proj, "target project is archived"));
      continue;
    }
    if (
      proj.organization_id !== k.organization_id ||
      proj.workspace_id !== k.workspace_id
    ) {
      skippedNotEligible++;
      items.push(
        buildIneligible(
          k,
          proj,
          "project scope does not match KPI scope",
        ),
      );
      continue;
    }


    // C3.9k — strict per-row due-policy gate. In system mode with
    // policy gating active, every candidate must match a due policy by
    // (organization_id, workspace_id, cadence). Belt-and-braces with
    // the constrained candidate query above.
    let policyPeriod:
      | { period_start: string; period_end: string; scheduled_run_at: string }
      | null = null;
    if (duePolicyKey) {
      const key = `${k.organization_id}::${k.workspace_id}::${k.cadence}`;
      if (!duePolicyKey.has(key)) {
        skippedNotEligible++;
        items.push(
          buildIneligible(
            k,
            proj,
            "no due automatic_snapshot_capture policy for (workspace, cadence)",
          ),
        );
        continue;
      }
      policyPeriod = duePolicyByKey?.get(key) ?? null;
    }

    // Use the due-policy period when available; otherwise fall back to
    // the canonical resolver. Both are derived from the same helper,
    // so this is a defensive consistency check, not a divergence.
    const period = policyPeriod
      ? {
          periodStart: policyPeriod.period_start,
          periodEnd: policyPeriod.period_end,
        }
      : resolvePreviousCompletedKpiPeriod(k.cadence, asOfDate);
    if (!period.periodStart || !period.periodEnd) {
      skippedNotEligible++;
      items.push(
        buildIneligible(
          k,
          proj,
          `cannot resolve previous completed period for cadence '${k.cadence}'`,
        ),
      );
      continue;
    }

    const { data: existingRows, error: existingErr } = await adminClient
      .from("kpi_snapshots")
      .select("id")
      .eq("organization_id", k.organization_id)
      .eq("workspace_id", k.workspace_id)
      .eq("project_id", proj.id)
      .eq("kpi_definition_id", k.id)
      .eq("period_start", period.periodStart)
      .eq("period_end", period.periodEnd)
      .limit(1);
    if (existingErr) {
      // C3.9 — record per-item failure and continue with the next
      // candidate where safe, rather than aborting the entire run.
      failedCount++;
      items.push({
        organization_id: k.organization_id,
        workspace_id: k.workspace_id,
        project_id: proj.id,
        project_name: proj.name,
        kpi_definition_id: k.id,
        kpi_name: k.name,
        calculation_key: k.calculation_key,
        cadence: k.cadence,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        validity_date: period.periodEnd,
        action: "failed",
        reason: `Existing-snapshot probe failed: ${existingErr.message?.slice(0, 200) ?? "unknown"}`,
        calculation_status: "error",
      });
      continue;
    }
    const existing = (existingRows ?? [])[0] ?? null;

    if (existing) {
      skippedExisting++;
      items.push({
        organization_id: k.organization_id,
        workspace_id: k.workspace_id,
        project_id: proj.id,
        project_name: proj.name,
        kpi_definition_id: k.id,
        kpi_name: k.name,
        calculation_key: k.calculation_key,
        cadence: k.cadence,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        validity_date: period.periodEnd,
        action: "skipped_existing_snapshot",
        reason:
          "An official snapshot already exists for this (KPI, project, period).",
        existing_snapshot_id: existing.id,
        calculation_status: "not_evaluated_in_dry_run",
      });
      continue;
    }

    if (mode === "dry_run") {
      wouldCreate++;
      items.push({
        organization_id: k.organization_id,
        workspace_id: k.workspace_id,
        project_id: proj.id,
        project_name: proj.name,
        kpi_definition_id: k.id,
        kpi_name: k.name,
        calculation_key: k.calculation_key,
        cadence: k.cadence,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        validity_date: period.periodEnd,
        action: "would_create_snapshot",
        reason: "Eligible. No existing snapshot for the previous period.",
        calculation_status: "not_evaluated_in_dry_run",
      });
      continue;
    }

    // ---------- mode === "execute" ----------
    if (
      k.source_mode !== "automatic" ||
      k.is_archived ||
      !k.auto_snapshot_enabled ||
      !k.calculation_key ||
      k.calculation_key === "schedule_signal" ||
      !SUPPORTED_CADENCES.has(k.cadence as Cadence) ||
      k.target_type !== "project" ||
      proj.is_archived ||
      proj.organization_id !== k.organization_id ||
      proj.workspace_id !== k.workspace_id
    ) {
      skippedNotEligible++;
      items.push(
        buildIneligible(k, proj, "Eligibility re-check failed before write"),
      );
      continue;
    }

    const meta = getAutomaticKpiDefinition(
      k.calculation_key as AutomaticKpiCalculationKey,
    );
    if (!meta) {
      skippedNotEligible++;
      items.push(
        buildIneligible(
          k,
          proj,
          `Unknown calculation_key: ${k.calculation_key}`,
        ),
      );
      continue;
    }

    let calcStatus: string;
    let valueAmount: number | null = null;
    let stringValue: string | null = null;
    let resolvedFormulaVersion: number | null = k.formula_version ?? null;
    let calcMessage: string | null = null;
    // C3.9b — capture engine sourceSummary for the KPI-specific
    // narrative builder. We do NOT recompute formulas in the narrative
    // layer; we consume this metadata as-is.
    let calcSourceSummary:
      | Record<string, number | string | null>
      | null = null;
    try {
      const calcInput = await buildKpiCalculationInput(
        adminClient as unknown as never,
        proj.id,
        { snapshotDate: period.periodEnd },
      );
      const result = calculateAutomaticKpi(
        k.calculation_key as AutomaticKpiCalculationKey,
        calcInput,
        {
          completionMethod:
            (k.completion_method as KpiCompletionMethod | null) ?? null,
          formulaVersion: k.formula_version ?? undefined,
        },
      );
      calcStatus = result.calculationStatus;
      valueAmount = result.valueAmount;
      stringValue = result.stringValue;
      resolvedFormulaVersion = result.formulaVersion;
      calcMessage = result.calculationMessage ?? null;
      calcSourceSummary = result.sourceSummary ?? null;
    } catch (err) {
      failedCount++;
      items.push({
        organization_id: k.organization_id,
        workspace_id: k.workspace_id,
        project_id: proj.id,
        project_name: proj.name,
        kpi_definition_id: k.id,
        kpi_name: k.name,
        calculation_key: k.calculation_key,
        cadence: k.cadence,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        validity_date: period.periodEnd,
        action: "failed",
        reason:
          err instanceof Error
            ? `Calculation threw: ${err.message.slice(0, 200)}`
            : "Calculation threw",
        calculation_status: "error",
      });
      continue;
    }

    if (calcStatus !== "calculated") {
      calculationNotReady++;
      items.push({
        organization_id: k.organization_id,
        workspace_id: k.workspace_id,
        project_id: proj.id,
        project_name: proj.name,
        kpi_definition_id: k.id,
        kpi_name: k.name,
        calculation_key: k.calculation_key,
        cadence: k.cadence,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        validity_date: period.periodEnd,
        action: "calculation_not_ready",
        reason: calcMessage ?? `Calculation status: ${calcStatus}`,
        calculation_status: calcStatus,
      });
      continue;
    }

    {
      const { data: raceCheckRows, error: raceErr } = await adminClient
        .from("kpi_snapshots")
        .select("id")
        .eq("organization_id", k.organization_id)
        .eq("workspace_id", k.workspace_id)
        .eq("project_id", proj.id)
        .eq("kpi_definition_id", k.id)
        .eq("period_start", period.periodStart)
        .eq("period_end", period.periodEnd)
        .limit(1);
      if (raceErr) {
        failedCount++;
        items.push({
          organization_id: k.organization_id,
          workspace_id: k.workspace_id,
          project_id: proj.id,
          project_name: proj.name,
          kpi_definition_id: k.id,
          kpi_name: k.name,
          calculation_key: k.calculation_key,
          cadence: k.cadence,
          period_start: period.periodStart,
          period_end: period.periodEnd,
          validity_date: period.periodEnd,
          action: "failed",
          reason: "Pre-insert idempotency check failed",
          calculation_status: calcStatus,
        });
        continue;
      }
      const raceExisting = (raceCheckRows ?? [])[0] ?? null;
      if (raceExisting) {
        skippedExisting++;
        items.push({
          organization_id: k.organization_id,
          workspace_id: k.workspace_id,
          project_id: proj.id,
          project_name: proj.name,
          kpi_definition_id: k.id,
          kpi_name: k.name,
          calculation_key: k.calculation_key,
          cadence: k.cadence,
          period_start: period.periodStart,
          period_end: period.periodEnd,
          validity_date: period.periodEnd,
          action: "skipped_existing_snapshot",
          reason:
            "Snapshot was created concurrently for this (KPI, project, period).",
          existing_snapshot_id: raceExisting.id,
          calculation_status: calcStatus,
        });
        continue;
      }
    }

    // C3.9a + C3.9b — deterministic, non-AI narrative comment for the
    // automatic snapshot. Failure of the digest RPC must NEVER fail
    // the snapshot itself; we fall back to the calculation-only
    // narrative ("no relevant execution updates" sentence).
    //
    // C3.9b: pass calculation_key-specific allowed target_types so the
    // RPC returns ONLY KPI-relevant updates (e.g. project-only for
    // baseline_slip_days, project+phase for phase_completion_percent).
    let executionDigest: ExecutionUpdateDigestRow[] = [];
    let digestFailed = false;
    const relevantTargetTypes = getRelevantTargetTypesForCalculationKey(
      k.calculation_key,
    );
    try {
      const { data: digestData, error: digestErr } = await adminClient.rpc(
        "get_project_execution_update_digest_for_snapshot_system_v2",
        {
          _project_id: proj.id,
          _period_start: period.periodStart,
          _period_end: period.periodEnd,
          _allowed_target_types: relevantTargetTypes
            ? Array.from(relevantTargetTypes)
            : null,
          _limit: 5,
        },
      );
      if (digestErr) {
        digestFailed = true;
        console.warn(
          `[c3.9b] Execution-update digest RPC v2 failed for project ${proj.id}: ${digestErr.message?.slice(0, 200) ?? "unknown"}`,
        );
      } else if (Array.isArray(digestData)) {
        executionDigest = digestData as ExecutionUpdateDigestRow[];
      }
    } catch (digestThrown) {
      digestFailed = true;
      console.warn(
        `[c3.9b] Execution-update digest RPC v2 threw for project ${proj.id}: ${
          digestThrown instanceof Error ? digestThrown.message.slice(0, 200) : "unknown"
        }`,
      );
    }
    const generatedComment = buildAutomaticSnapshotComment({
      kpiName: k.name,
      calculationKey: k.calculation_key,
      formulaVersion: resolvedFormulaVersion,
      valueType: k.value_type ?? "number",
      valueAmount,
      stringValue,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      calculationStatus: calcStatus,
      sourceSummary: calcSourceSummary,
      executionUpdates: executionDigest,
    });

    const insertPayload = {
      organization_id: k.organization_id,
      workspace_id: k.workspace_id,
      project_id: proj.id,
      kpi_definition_id: k.id,
      snapshot_date: period.periodEnd,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      source_mode: "automatic",
      value_type: k.value_type ?? "number",
      value_amount: valueAmount,
      string_value: stringValue,
      // C3.9a: deterministic generated narrative (was null pre-C3.9a).
      comment: generatedComment,
      // C3.9a: action_plan is INTENTIONALLY left null. Action plans are
      // a management commitment and must NEVER be fabricated by the
      // automatic scheduler.
      action_plan: null,
      calculation_key: k.calculation_key,
      formula_version: resolvedFormulaVersion,
      calculation_status: calcStatus,
      generated_by: "system",
      created_by: null as string | null,
    };
    void digestFailed; // surfaced via console.warn only — not stored.

    const { data: inserted, error: insErr } = await adminClient
      .from("kpi_snapshots")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insErr || !inserted) {
      const isUniqueViolation =
        insErr?.code === "23505" ||
        /duplicate key|unique constraint|idx_kpi_snapshots_unique_system_auto_period/i
          .test(insErr?.message ?? "");
      if (isUniqueViolation) {
        const { data: conflictRows, error: conflictErr } = await adminClient
          .from("kpi_snapshots")
          .select("id")
          .eq("organization_id", k.organization_id)
          .eq("workspace_id", k.workspace_id)
          .eq("project_id", proj.id)
          .eq("kpi_definition_id", k.id)
          .eq("period_start", period.periodStart)
          .eq("period_end", period.periodEnd)
          .limit(1);
        if (!conflictErr && (conflictRows ?? []).length > 0) {
          skippedExisting++;
          items.push({
            organization_id: k.organization_id,
            workspace_id: k.workspace_id,
            project_id: proj.id,
            project_name: proj.name,
            kpi_definition_id: k.id,
            kpi_name: k.name,
            calculation_key: k.calculation_key,
            cadence: k.cadence,
            period_start: period.periodStart,
            period_end: period.periodEnd,
            validity_date: period.periodEnd,
            action: "skipped_existing_snapshot",
            reason:
              "System automatic snapshot already exists for this KPI/period.",
            existing_snapshot_id: conflictRows![0].id,
            calculation_status: calcStatus,
          });
          continue;
        }
      }
      failedCount++;
      items.push({
        organization_id: k.organization_id,
        workspace_id: k.workspace_id,
        project_id: proj.id,
        project_name: proj.name,
        kpi_definition_id: k.id,
        kpi_name: k.name,
        calculation_key: k.calculation_key,
        cadence: k.cadence,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        validity_date: period.periodEnd,
        action: "failed",
        reason: insErr?.message?.slice(0, 200) ?? "Insert failed",
        calculation_status: calcStatus,
      });
      continue;
    }

    createdCount++;
    items.push({
      organization_id: k.organization_id,
      workspace_id: k.workspace_id,
      project_id: proj.id,
      project_name: proj.name,
      kpi_definition_id: k.id,
      kpi_name: k.name,
      calculation_key: k.calculation_key,
      cadence: k.cadence,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      validity_date: period.periodEnd,
      action: "created_snapshot",
      reason:
        "Snapshot created with auto-generated comment (action_plan left null).",
      snapshot_id: inserted.id,
      calculation_status: calcStatus,
    });
  }

  // Reference user-scoped rows so unused-var lints don't drop them; these
  // were intentionally read first as the RLS-respecting authority probe.
  void userScopedProjectRow;
  void userScopedKpiRow;

  // C3.9 + C3.9a — finalize all per-organization audit run rows.
  await finalizeAllRuns(
    (st) =>
      st.items.some((item) => item.action === "failed")
        ? "completed_with_errors"
        : "completed",
    null,
  );

  // For backwards compatibility the response still surfaces a single
  // `run_id`. In user mode this is the (only) run row's id. In system
  // mode multiple per-org runs may exist, so we additionally return
  // `run_ids` (array of all created run row ids) and leave `run_id`
  // null when more than one org run was created.
  const allRunIds = Array.from(runBuckets.values())
    .map((s) => s.runId)
    .filter((x): x is string => !!x);
  const responseRunId =
    allRunIds.length === 1 ? allRunIds[0] : (allRunIds[0] ?? null);

  // C3.9k — surface schedule-policy metadata when system-mode policy
  // gating produced the candidate set. No sensitive data is exposed.
  const processedCadences = duePolicies
    ? Array.from(new Set(duePolicies.map((d) => d.cadence)))
    : undefined;
  const processedWorkspaceCount = duePolicies
    ? new Set(duePolicies.map((d) => d.workspace_id)).size
    : undefined;

  return json(
    {
      request_id: requestId,
      ok: true,
      mode,
      as_of_date: asOfDate,
      as_of_datetime_utc: asOfDateTimeUtc ?? undefined,
      invocation_source: invocationSource,
      activated: invocationSource === "system" ? true : undefined,
      due_policy_count: duePolicies ? duePolicies.length : undefined,
      processed_cadences: processedCadences,
      processed_workspace_count: processedWorkspaceCount,
      run_id: responseRunId,
      run_ids: allRunIds,
      candidate_count: items.length,
      created_count: createdCount,
      skipped_existing_snapshot_count: skippedExisting,
      calculation_not_ready_count: calculationNotReady,
      failed_count: failedCount,
      items,
      summary: {
        would_create: wouldCreate,
        created: createdCount,
        skipped_existing_snapshot: skippedExisting,
        skipped_not_eligible: skippedNotEligible,
        calculation_not_ready: calculationNotReady,
        failed: failedCount,
      },
    },
    cors,
    200,
  );
}

function buildIneligible(
  k: KpiDefinitionRow,
  proj: ProjectRow | null,
  reason: string,
): SchedulerItem {
  return {
    organization_id: k.organization_id,
    workspace_id: k.workspace_id,
    project_id: proj?.id ?? k.target_id,
    project_name: proj?.name ?? null,
    kpi_definition_id: k.id,
    kpi_name: k.name,
    calculation_key: k.calculation_key,
    cadence: k.cadence,
    period_start: null,
    period_end: null,
    validity_date: null,
    action: "skipped_not_eligible",
    reason,
    calculation_status: "not_evaluated",
  };
}
