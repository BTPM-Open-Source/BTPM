// BTPM — Wave C2, Step C2.11a
// Scheduled KPI App Reporting — backend orchestrator (no cron activation).
//
// Responsibilities:
//   - Authenticated POST.
//   - Accepts ONLY { mode, as_of_date?, mapping_id? }. Extra fields => 400.
//   - mode = "dry_run": evaluates due candidates, returns intended actions,
//     performs NO writes and NO external calls.
//   - mode = "execute": for each due candidate, creates/reuses outbox via
//     prepare-kpi-app-report-now, prepares payload via build-kpi-app-payload,
//     and submits via submit-kpi-app-payload. Reuses the same outbox/audit
//     contract as C2.9a/C2.5/C2.6. Does NOT retry failed/retry_pending rows.
//
// Hard rules (C2.11a):
//   - kpi_snapshots is the only source. kpi_updates is NOT read.
//   - The KPI calculation engine is NOT called.
//   - schedule_signal is excluded.
//   - manual_only mappings are excluded.
//   - is_active=false / auto_submit_enabled=false are excluded.
//   - No duplicate outbox rows: relies on C2.9a's existing-row reuse logic
//     and the C2.4 unique index.
//   - No retry of failed / retry_pending rows.
//   - No update to kpi_app_mappings.last_* fields (advisory only).
//   - No second payload builder. No second MuleSoft connector.
//   - No cron / pg_cron / scheduled-function activation in this step.
//   - dry_run reads no MuleSoft secrets and makes no external calls.
//   - No ProjectKpis / Power BI / direct MS SQL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { buildBrowserCorsHeaders } from "../_shared/browserCors.ts";
import { resolvePreviousCompletedKpiPeriod } from "../_shared/kpi/kpiPreviousPeriod.ts";
import {
  verifySchedulerSecret,
  SchedulerAuthError,
} from "../_shared/kpi-app-scheduler-auth.ts";
import { loadPayloadSourceBundleSystem } from "../_shared/kpi-app-payload-source-system.ts";
import { submitOutboxCore } from "../_shared/kpi-app-submit-service.ts";
import {
  createOrReuseOutboxSystem,
  preparePayloadSystem,
} from "../_shared/kpi-app-outbox-system-service.ts";
import { evaluateKpiSchedulePolicyDue } from "../_shared/kpi/kpiScheduleDue.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

function json(data: unknown, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type CandidateMapping = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  kpi_definition_id: string;
  external_kpi_id: number;
  reporting_frequency: string;
  is_active: boolean;
  auto_submit_enabled: boolean;
  carry_forward_allowed: boolean;
  kpi_definitions: {
    id: string;
    is_archived: boolean;
    cadence: string;
    calculation_key: string | null;
    value_type: string;
  } | null;
};

type SupportedFreq = "weekly" | "monthly" | "quarterly" | "yearly";
const SUPPORTED_FREQS = new Set<SupportedFreq>(["weekly", "monthly", "quarterly", "yearly"]);

type DryRunAction =
  | "would_create_outbox"
  | "would_reuse_queued"
  | "would_prepare_payload"
  | "would_submit_payload_ready"
  | "already_submitted"
  | "in_progress"
  | "not_reportable"
  | "skipped_manual_only"
  | "skipped_inactive"
  | "needs_manual_retry_or_review"
  | "skipped_schedule_signal"
  | "skipped_unsupported_frequency"
  | "skipped_kpi_archived"
  | "concurrency_conflict"
  | "error";

type DryRunItem = {
  mapping_id: string;
  project_id: string;
  kpi_definition_id: string;
  external_kpi_id: number;
  reporting_frequency: string;
  period_start: string | null;
  period_end: string | null;
  validity_date: string | null;
  action: DryRunAction;
  reason?: string;
  carry_forward_used?: boolean | null;
  source_snapshot_id?: string | null;
};

type ExecuteAction =
  | "submitted"
  | "failed"
  | "skipped"
  | "not_reportable"
  | "concurrency_conflict"
  | "error";

type ExecuteItem = {
  mapping_id: string;
  outbox_id?: string | null;
  action_taken: ExecuteAction;
  final_status?: string | null;
  reason?: string;
  request_id?: string | null;
  upstream_status?: number | null;
  upstream_status_text?: string | null;
  carry_forward_used?: boolean | null;
  payload_summary?: unknown;
};

Deno.serve(async (req) => {
  const cors = buildBrowserCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return json({ request_id: requestId, ok: false, error: "Method not allowed" }, cors, 405);
  }

  try {
    const authHeader = req.headers.get("authorization");
    const schedulerSecretHeader = req.headers.get("x-scheduler-secret");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // API-E.R4Y — Browser-session-only OAuth denial guard for the human-admin
    // path. Requests without an Authorization header are the disjoint
    // system-mode path (protected by x-scheduler-secret) and must NOT run
    // the guard or construct a caller-scoped client here.
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
      return json({ request_id: requestId, ok: false, error: "Invalid request body" }, cors, 400);
    }
    const ALLOWED_KEYS = new Set([
      "mode",
      "as_of_date",
      "mapping_id",
      "invocation_source",
      "as_of_datetime_utc",
    ]);
    const extraKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
    if (extraKeys.length > 0) {
      return json(
        { request_id: requestId, ok: false, error: `Unexpected fields: ${extraKeys.join(", ")}` },
        cors,
        400,
      );
    }
    const b = body as Record<string, unknown>;
    const mode = b.mode;
    const asOfDateInput = b.as_of_date;
    const mappingIdInput = b.mapping_id;
    const invocationSourceInput = b.invocation_source;
    const asOfDateTimeUtcInput = b.as_of_datetime_utc;

    if (mode !== "dry_run" && mode !== "execute") {
      return json({ request_id: requestId, ok: false, error: "Invalid mode" }, cors, 400);
    }
    let asOfDate: string;
    if (asOfDateInput === undefined || asOfDateInput === null) {
      asOfDate = todayUtcIso();
    } else if (!isValidIsoDate(asOfDateInput)) {
      return json({ request_id: requestId, ok: false, error: "Invalid as_of_date" }, cors, 400);
    } else {
      asOfDate = asOfDateInput;
    }
    let mappingFilter: string | null = null;
    if (mappingIdInput !== undefined && mappingIdInput !== null) {
      if (typeof mappingIdInput !== "string" || !UUID_RE.test(mappingIdInput)) {
        return json({ request_id: requestId, ok: false, error: "Invalid mapping_id" }, cors, 400);
      }
      mappingFilter = mappingIdInput;
    }

    // C2.11d: invocation_source distinguishes the human-admin path
    // ("user", default) from the internal scheduled invocation path
    // ("system"). System mode is mutually exclusive with both a human JWT
    // and a mapping_id filter — system runs are org-scoped only.
    let invocationSource: "user" | "system" = "user";
    if (invocationSourceInput !== undefined && invocationSourceInput !== null) {
      if (invocationSourceInput !== "user" && invocationSourceInput !== "system") {
        return json(
          { request_id: requestId, ok: false, error: "Invalid invocation_source" },
          cors,
          400,
        );
      }
      invocationSource = invocationSourceInput;
    }

    // C3.9l — as_of_datetime_utc is a system-mode-only input, used by the
    // schedule-policy due engine. User/admin paths must remain on the
    // existing as_of_date contract to avoid ambiguity.
    let asOfDateTimeUtc: string | null = null;
    if (asOfDateTimeUtcInput !== undefined && asOfDateTimeUtcInput !== null) {
      if (invocationSource !== "system") {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "as_of_datetime_utc is only allowed in system mode",
          },
          cors,
          400,
        );
      }
      if (typeof asOfDateTimeUtcInput !== "string") {
        return json(
          { request_id: requestId, ok: false, error: "Invalid as_of_datetime_utc" },
          cors,
          400,
        );
      }
      const parsed = new Date(asOfDateTimeUtcInput);
      if (Number.isNaN(parsed.getTime())) {
        return json(
          { request_id: requestId, ok: false, error: "Invalid as_of_datetime_utc" },
          cors,
          400,
        );
      }
      asOfDateTimeUtc = parsed.toISOString();
    }

    // (SUPABASE_URL / ANON_KEY / SERVICE_KEY resolved above, before the
    // conditional human-path browser-session-only guard.)

    let callerOrgId: string | null = null;
    let systemModeEnabled = false;

    if (invocationSource === "system") {
      // System-mode authority gate (C2.11c freeze + C2.11d-correction):
      //   1. Authorization header MUST NOT be present (mutually exclusive
      //      with the human-admin path).
      //   2. x-scheduler-secret MUST match KPI_APP_SCHEDULER_SECRET via
      //      constant-time compare.
      //   3. KPI_APP_SCHEDULER_ENABLED MUST equal "true".
      //   4. mapping_id is rejected — system runs are org-wide only.
      //   5. mode MUST equal "execute". System mode does not support
      //      dry_run; recurring system invocations are submission-only
      //      and must not be used to enumerate due candidates.
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
      if (mappingFilter) {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "system mode does not accept mapping_id",
          },
          cors,
          400,
        );
      }
      try {
        verifySchedulerSecret(req);
      } catch (e) {
        const status = e instanceof SchedulerAuthError ? e.status : 401;
        return json(
          { request_id: requestId, ok: false, error: "Unauthorized" },
          cors,
          status,
        );
      }
      const enabled = (Deno.env.get("KPI_APP_SCHEDULER_ENABLED") ?? "")
        .trim()
        .toLowerCase();
      if (enabled !== "true") {
        return json(
          {
            request_id: requestId,
            ok: true,
            mode,
            as_of_date: asOfDate,
            invocation_source: "system",
            activated: false,
            reason: "KPI_APP_SCHEDULER_ENABLED is not 'true'",
            candidate_count: 0,
            items: [],
          },
          cors,
          200,
        );
      }
      systemModeEnabled = true;
      // System mode iterates ALL orgs that have eligible mappings. We do
      // not derive a single callerOrgId — the candidate query below filters
      // by is_active + auto_submit_enabled only, and existing per-mapping
      // mapping/snapshot/outbox validation enforces org consistency.
      // (No mapping_id is permitted here.)
    } else {
      // Human-admin path (unchanged).
      if (!authHeader) {
        return json({ request_id: requestId, ok: false, error: "Missing authorization" }, cors, 401);
      }
      if (schedulerSecretHeader) {
        // Defense-in-depth: do not allow a request to mix human JWT with
        // the scheduler secret. The two authority models are disjoint.
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "user mode rejects x-scheduler-secret header",
          },
          cors,
          400,
        );
      }

      // Reuse the caller-scoped userClient created before body parsing
      // (constructed only when an Authorization header was present, then
      // vetted by the browser-session-only guard). Do not construct a
      // second caller-scoped client here.
      if (!userClient) {
        return json({ request_id: requestId, ok: false, error: "Unauthorized" }, cors, 401);
      }


      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return json({ request_id: requestId, ok: false, error: "Unauthorized" }, cors, 401);
      }
      const callerId = userData.user.id;

      if (!mappingFilter) {
        const { data: orgIdRaw, error: orgErr } = await userClient.rpc("get_user_org_id", {
          _user_id: callerId,
        });
        if (orgErr || !orgIdRaw) {
          return json(
            { request_id: requestId, ok: false, error: "Caller has no organization scope" },
            cors,
            403,
          );
        }
        callerOrgId = orgIdRaw as string;
        const { data: isOrgAdmin, error: isOrgAdminErr } = await userClient.rpc("is_org_admin", {
          _user_id: callerId,
          _org_id: callerOrgId,
        });
        if (isOrgAdminErr || isOrgAdmin !== true) {
          return json(
            {
              request_id: requestId,
              ok: false,
              error: "Org-wide scheduler runs require Org Admin authority",
            },
            cors,
            403,
          );
        }
      } else {
        // Per-mapping authority gate (C2.11a-correction): enforce mapping admin
        // BEFORE any service-role read of kpi_app_mappings / outbox / snapshots.
        const { data: gateData, error: gateErr } = await userClient.rpc(
          "get_kpi_app_mapping_admin",
          { _mapping_id: mappingFilter },
        );
        if (gateErr) {
          const msg = (gateErr.message ?? "").toLowerCase();
          const status =
            msg.includes("not found") || msg.includes("does not exist") ? 404 : 403;
          return json(
            {
              request_id: requestId,
              ok: false,
              error:
                status === 404
                  ? "Mapping not found"
                  : "Not authorized for this mapping",
            },
            cors,
            status,
          );
        }
        if (!gateData) {
          return json(
            { request_id: requestId, ok: false, error: "Mapping not found" },
            cors,
            404,
          );
        }
      }
    }

    // Service-role client is constructed ONLY after one of the two
    // authority gates (human-admin OR system-secret) has passed.
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---------------------------------------------------------------
    // C3.9l — Schedule policy gating (system + execute only).
    //
    // System scheduled auto-submit consumes kpi_schedule_policies
    // (process_type='kpi_app_auto_submit', is_active=true) and uses the
    // C3.9i due engine to determine which (workspace, cadence) pairs
    // are due at `as_of_datetime_utc`. The completed reporting period is
    // taken from the due-policy evaluation, NOT recomputed from
    // `as_of_date` — keeping submissions aligned with C3 snapshot capture.
    //
    // User/admin paths and dry_run runs are unchanged and remain
    // policy-independent (manual Report Now, retry, reconciliation,
    // mapping-specific test runner).
    // ---------------------------------------------------------------
    type DuePolicyEntry = {
      workspace_id: string;
      cadence: SupportedFreq;
      period_start: string;
      period_end: string;
      scheduled_run_at: string;
    };
    const duePolicyByKey = new Map<string, DuePolicyEntry>();
    let duePolicyCount = 0;
    let processedCadences: string[] = [];
    let processedWorkspaceIds: string[] = [];
    let asOfDateTimeUtcResolved: string | null = null;

    if (invocationSource === "system" && mode === "execute") {
      asOfDateTimeUtcResolved = asOfDateTimeUtc ?? new Date().toISOString();

      const { data: policiesRaw, error: policiesErr } = await adminClient
        .from("kpi_schedule_policies")
        .select(
          "workspace_id, cadence, delay_days_after_period_close, run_time_utc, is_active, process_type",
        )
        .eq("process_type", "kpi_app_auto_submit")
        .eq("is_active", true);
      if (policiesErr) {
        return json(
          { request_id: requestId, ok: false, error: policiesErr.message },
          cors,
          500,
        );
      }
      const policies = (policiesRaw ?? []) as Array<{
        workspace_id: string;
        cadence: string;
        delay_days_after_period_close: number;
        run_time_utc: string;
        is_active: boolean;
        process_type: string;
      }>;

      for (const p of policies) {
        if (!SUPPORTED_FREQS.has(p.cadence as SupportedFreq)) continue;
        const evalRes = evaluateKpiSchedulePolicyDue(
          {
            cadence: p.cadence,
            delay_days_after_period_close: p.delay_days_after_period_close,
            run_time_utc: p.run_time_utc,
            is_active: p.is_active,
          },
          asOfDateTimeUtcResolved,
        );
        if (
          evalRes.is_due &&
          evalRes.period_start &&
          evalRes.period_end &&
          evalRes.scheduled_run_at
        ) {
          const key = `${p.workspace_id}::${p.cadence}`;
          if (!duePolicyByKey.has(key)) {
            duePolicyByKey.set(key, {
              workspace_id: p.workspace_id,
              cadence: p.cadence as SupportedFreq,
              period_start: evalRes.period_start,
              period_end: evalRes.period_end,
              scheduled_run_at: evalRes.scheduled_run_at,
            });
          }
        }
      }
      duePolicyCount = duePolicyByKey.size;

      if (duePolicyCount === 0) {
        return json(
          {
            request_id: requestId,
            ok: true,
            mode: "execute",
            as_of_date: asOfDate,
            as_of_datetime_utc: asOfDateTimeUtcResolved,
            invocation_source: "system",
            activated: systemModeEnabled,
            due_policy_count: 0,
            processed_cadences: [],
            processed_workspace_count: 0,
            candidate_count: 0,
            processed_count: 0,
            submitted_count: 0,
            failed_count: 0,
            skipped_count: 0,
            mapping_id_filter: null,
            items: [],
            reason: "no_due_policies",
          },
          cors,
          200,
        );
      }

      const wsSet = new Set<string>();
      const cadSet = new Set<string>();
      for (const v of duePolicyByKey.values()) {
        wsSet.add(v.workspace_id);
        cadSet.add(v.cadence);
      }
      processedWorkspaceIds = Array.from(wsSet);
      processedCadences = Array.from(cadSet);
    }

    let mappingsQuery = adminClient
      .from("kpi_app_mappings")
      .select(
        "id, organization_id, workspace_id, project_id, kpi_definition_id, external_kpi_id, reporting_frequency, is_active, auto_submit_enabled, carry_forward_allowed, kpi_definitions:kpi_definition_id ( id, is_archived, cadence, calculation_key, value_type )",
      )
      .eq("is_active", true)
      .eq("auto_submit_enabled", true);

    if (mappingFilter) {
      mappingsQuery = mappingsQuery.eq("id", mappingFilter);
    } else if (callerOrgId) {
      mappingsQuery = mappingsQuery.eq("organization_id", callerOrgId);
    }

    if (invocationSource === "system" && mode === "execute" && duePolicyCount > 0) {
      mappingsQuery = mappingsQuery
        .in("workspace_id", processedWorkspaceIds)
        .in("reporting_frequency", processedCadences);
    }

    const { data: mappingsRaw, error: mappingsErr } = await mappingsQuery;
    if (mappingsErr) {
      return json(
        { request_id: requestId, ok: false, error: mappingsErr.message },
        cors,
        500,
      );
    }
    let candidates = (mappingsRaw ?? []) as unknown as CandidateMapping[];

    // Strict per-row gate: only mappings whose (workspace, cadence) is
    // a due policy survive in system+execute.
    if (invocationSource === "system" && mode === "execute" && duePolicyCount > 0) {
      candidates = candidates.filter((m) =>
        duePolicyByKey.has(`${m.workspace_id}::${m.reporting_frequency}`),
      );
    }

    if (mode === "dry_run") {
      const items: DryRunItem[] = [];
      for (const m of candidates) {
        const item = await evaluateDryRun(adminClient, m, asOfDate);
        items.push(item);
      }
      return json(
        {
          request_id: requestId,
          ok: true,
          mode: "dry_run",
          as_of_date: asOfDate,
          invocation_source: invocationSource,
          activated: invocationSource === "system" ? systemModeEnabled : undefined,
          candidate_count: items.length,
          mapping_id_filter: mappingFilter,
          items,
        },
        cors,
        200,
      );
    }

    const items: ExecuteItem[] = [];
    let submittedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let notReportableCount = 0;
    let concurrencyConflictCount = 0;
    let processedCount = 0;

    for (const m of candidates) {
      processedCount++;
      try {
        let result: ExecuteItem;
        if (invocationSource === "system") {
          const due = duePolicyByKey.get(`${m.workspace_id}::${m.reporting_frequency}`);
          result = await executeForMappingSystem({
            mapping: m,
            asOfDate,
            adminClient,
            // C3.9l — period comes from due-policy evaluation; the system
            // path must NOT recompute period from as_of_date.
            periodOverride: due
              ? {
                  period_start: due.period_start,
                  period_end: due.period_end,
                  validity_date: due.period_end,
                }
              : null,
          });
        } else {
          result = await executeForMapping({
            mapping: m,
            asOfDate,
            authHeader: authHeader as string,
            adminClient,
            supabaseUrl: SUPABASE_URL,
          });
        }
        items.push(result);
        // C3.10b — Bucketing rules:
        //   submitted              → submitted_count
        //   failed | error         → failed_count (genuine failures, incl.
        //                            prepare_payload_failed and uncaught errors)
        //   not_reportable         → not_reportable_count + skipped_count
        //   concurrency_conflict   → concurrency_conflict_count + skipped_count
        //   skipped                → skipped_count (genuine skip states only:
        //                            already_submitted / in_progress /
        //                            needs_manual_retry_or_review / pre-filter)
        if (result.action_taken === "submitted") {
          submittedCount++;
        } else if (result.action_taken === "failed" || result.action_taken === "error") {
          failedCount++;
        } else if (result.action_taken === "not_reportable") {
          notReportableCount++;
          skippedCount++;
        } else if (result.action_taken === "concurrency_conflict") {
          concurrencyConflictCount++;
          skippedCount++;
        } else {
          skippedCount++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        items.push({
          mapping_id: m.id,
          action_taken: "error",
          reason: msg.slice(0, 300),
        });
        failedCount++;
      }
    }

    // ---------------------------------------------------------------
    // C2-FIX.5 — Append-only automation protocol logging.
    // Best-effort: failures here MUST NOT break the scheduler response.
    // ---------------------------------------------------------------
    try {
      const orgForRun =
        invocationSource === "system"
          ? (candidates[0]?.organization_id ?? null)
          : (callerOrgId ?? candidates[0]?.organization_id ?? null);
      const wsForRun =
        invocationSource === "system"
          ? (processedWorkspaceIds.length === 1 ? processedWorkspaceIds[0] : null)
          : (candidates[0]?.workspace_id ?? null);
      if (orgForRun) {
        const periodStartForRun = candidates[0]
          ? periodForMapping(candidates[0].reporting_frequency, asOfDate).period_start
          : null;
        const periodEndForRun = candidates[0]
          ? periodForMapping(candidates[0].reporting_frequency, asOfDate).period_end
          : null;
        const cadenceForRun = candidates[0]?.reporting_frequency ?? "mixed";
        const runStatus = failedCount > 0 ? "completed_with_warnings" : "completed";
        const { data: runRow } = await adminClient
          .from("kpi_app_scheduler_runs")
          .insert({
            organization_id: orgForRun,
            workspace_id: wsForRun,
            cadence: cadenceForRun,
            invocation_source: invocationSource,
            mode,
            as_of_date: asOfDate,
            reporting_period_start: periodStartForRun,
            reporting_period_end: periodEndForRun,
            status: runStatus,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            candidate_count: candidates.length,
            submitted_count: submittedCount,
            failed_count: failedCount,
            skipped_count: skippedCount,
            not_reportable_count: notReportableCount,
            request_id: requestId,
            summary: {
              processed_count: processedCount,
              concurrency_conflict_count: concurrencyConflictCount,
              due_policy_count: invocationSource === "system" ? duePolicyCount : undefined,
              processed_cadences: invocationSource === "system" ? processedCadences : undefined,
              processed_workspace_count:
                invocationSource === "system" ? processedWorkspaceIds.length : undefined,
            },
          })
          .select("id")
          .single();
        const runId = runRow?.id as string | undefined;
        if (runId) {
          const itemRows = items.map((it, idx) => {
            const m = candidates[idx];
            const period = m ? periodForMapping(m.reporting_frequency, asOfDate) : { period_start: null, period_end: null, validity_date: null };
            const actionMap: Record<string, string> = {
              submitted: "submitted",
              failed: "failed",
              error: "failed",
              not_reportable: "skipped_not_reportable",
              concurrency_conflict: "skipped_in_progress",
              skipped: "skipped",
            };
            return {
              run_id: runId,
              organization_id: m?.organization_id ?? orgForRun,
              workspace_id: m?.workspace_id ?? null,
              mapping_id: it.mapping_id,
              project_id: m?.project_id ?? null,
              kpi_definition_id: m?.kpi_definition_id ?? null,
              external_kpi_id: m?.external_kpi_id ?? null,
              reporting_period_start: period.period_start,
              reporting_period_end: period.period_end,
              validity_date: period.validity_date,
              action: actionMap[it.action_taken] ?? it.action_taken,
              reason: it.reason ?? null,
              carry_forward_used: it.carry_forward_used ?? null,
              outbox_id: it.outbox_id ?? null,
              outbox_status: it.final_status ?? null,
              http_status: it.upstream_status ?? null,
              upstream_status_text: it.upstream_status_text ?? null,
              payload_summary: (it.payload_summary as Record<string, unknown>) ?? {},
            };
          });
          if (itemRows.length) {
            await adminClient.from("kpi_app_scheduler_run_items").insert(itemRows);
          }
        }
      }
    } catch (logErr) {
      console.warn("[scheduler-protocol] logging failed", logErr);
    }

    return json(
      {
        request_id: requestId,
        ok: true,
        mode: "execute",
        as_of_date: asOfDate,
        as_of_datetime_utc:
          invocationSource === "system" ? asOfDateTimeUtcResolved : undefined,
        invocation_source: invocationSource,
        activated: invocationSource === "system" ? systemModeEnabled : undefined,
        mapping_id_filter: mappingFilter,
        due_policy_count:
          invocationSource === "system" ? duePolicyCount : undefined,
        processed_cadences:
          invocationSource === "system" ? processedCadences : undefined,
        processed_workspace_count:
          invocationSource === "system" ? processedWorkspaceIds.length : undefined,
        candidate_count: candidates.length,
        processed_count: processedCount,
        submitted_count: submittedCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
        not_reportable_count: notReportableCount,
        concurrency_conflict_count: concurrencyConflictCount,
        items,
      },
      cors,
      200,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return json({ request_id: requestId, ok: false, error: msg }, cors, 500);
  }
});

function periodForMapping(
  freq: string,
  asOfDate: string,
): { period_start: string | null; period_end: string | null; validity_date: string | null; supported: boolean } {
  if (!SUPPORTED_FREQS.has(freq as SupportedFreq)) {
    return { period_start: null, period_end: null, validity_date: null, supported: false };
  }
  // C3.9f — Auto-submit scheduler MUST resolve the most recently *completed*
  // reporting period (aligned with automatic snapshot capture in C3.3/C3.4).
  // Using `resolveKpiPeriod` here would resolve the in-progress period
  // containing as_of_date, for which no official snapshot can yet exist.
  // Manual Report Now is unaffected — it lives in
  // `prepare-kpi-app-report-now` and accepts explicit period inputs.
  const { periodStart, periodEnd } = resolvePreviousCompletedKpiPeriod(freq, asOfDate);
  return {
    period_start: periodStart,
    period_end: periodEnd,
    validity_date: periodEnd,
    supported: !!(periodStart && periodEnd),
  };
}

function preFilterMapping(m: CandidateMapping, asOfDate: string): DryRunItem | null {
  const def = m.kpi_definitions;

  if (!m.is_active) {
    return {
      mapping_id: m.id,
      project_id: m.project_id,
      kpi_definition_id: m.kpi_definition_id,
      external_kpi_id: m.external_kpi_id,
      reporting_frequency: m.reporting_frequency,
      period_start: null,
      period_end: null,
      validity_date: null,
      action: "skipped_inactive",
      reason: "mapping is inactive",
    };
  }
  if (!m.auto_submit_enabled) {
    return {
      mapping_id: m.id,
      project_id: m.project_id,
      kpi_definition_id: m.kpi_definition_id,
      external_kpi_id: m.external_kpi_id,
      reporting_frequency: m.reporting_frequency,
      period_start: null,
      period_end: null,
      validity_date: null,
      action: "skipped_inactive",
      reason: "auto_submit_enabled is false",
    };
  }
  if (def?.is_archived) {
    return {
      mapping_id: m.id,
      project_id: m.project_id,
      kpi_definition_id: m.kpi_definition_id,
      external_kpi_id: m.external_kpi_id,
      reporting_frequency: m.reporting_frequency,
      period_start: null,
      period_end: null,
      validity_date: null,
      action: "skipped_kpi_archived",
      reason: "kpi definition is archived",
    };
  }
  if (def?.calculation_key === "schedule_signal") {
    return {
      mapping_id: m.id,
      project_id: m.project_id,
      kpi_definition_id: m.kpi_definition_id,
      external_kpi_id: m.external_kpi_id,
      reporting_frequency: m.reporting_frequency,
      period_start: null,
      period_end: null,
      validity_date: null,
      action: "skipped_schedule_signal",
      reason: "schedule_signal KPIs are not externally submittable",
    };
  }
  if (m.reporting_frequency === "manual_only") {
    return {
      mapping_id: m.id,
      project_id: m.project_id,
      kpi_definition_id: m.kpi_definition_id,
      external_kpi_id: m.external_kpi_id,
      reporting_frequency: m.reporting_frequency,
      period_start: null,
      period_end: null,
      validity_date: null,
      action: "skipped_manual_only",
      reason: "manual_only mappings are not scheduler candidates",
    };
  }

  const period = periodForMapping(m.reporting_frequency, asOfDate);
  if (!period.supported) {
    return {
      mapping_id: m.id,
      project_id: m.project_id,
      kpi_definition_id: m.kpi_definition_id,
      external_kpi_id: m.external_kpi_id,
      reporting_frequency: m.reporting_frequency,
      period_start: null,
      period_end: null,
      validity_date: null,
      action: "skipped_unsupported_frequency",
      reason: `unsupported reporting_frequency '${m.reporting_frequency}'`,
    };
  }
  return null;
}

async function classifyExistingOutbox(
  adminClient: ReturnType<typeof createClient<any, "public", any>>,
  mapping: CandidateMapping,
  periodStart: string,
  periodEnd: string,
): Promise<{
  exists: boolean;
  id: string | null;
  status: string | null;
  submission_mode: string | null;
  superseded_at: string | null;
}> {
  // C2-FIX.4: Active scheduler classification MUST exclude superseded rows.
  // Superseded rows are audit history only and never block scheduler activity
  // (they cannot be reused, prepared, submitted, or treated as already_submitted).
  const { data, error } = await adminClient
    .from("kpi_app_submission_outbox")
    .select("id, status, submission_mode, superseded_at")
    .eq("organization_id", mapping.organization_id)
    .eq("mapping_id", mapping.id)
    .eq("reporting_period_start", periodStart)
    .eq("reporting_period_end", periodEnd)
    .neq("status", "cancelled")
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return { exists: false, id: null, status: null, submission_mode: null, superseded_at: null };
  }
  return {
    exists: true,
    id: data.id as string,
    status: data.status as string,
    submission_mode: (data.submission_mode as string | null) ?? null,
    superseded_at: (data.superseded_at as string | null) ?? null,
  };
}

async function evaluateDryRun(
  adminClient: ReturnType<typeof createClient<any, "public", any>>,
  m: CandidateMapping,
  asOfDate: string,
): Promise<DryRunItem> {
  const pre = preFilterMapping(m, asOfDate);
  if (pre) return pre;

  const period = periodForMapping(m.reporting_frequency, asOfDate);
  const periodStart = period.period_start as string;
  const periodEnd = period.period_end as string;
  const validityDate = period.validity_date as string;

  const existing = await classifyExistingOutbox(adminClient, m, periodStart, periodEnd);

  if (existing.exists) {
    if (existing.status === "submitted") {
      return baseItem(m, periodStart, periodEnd, validityDate, "already_submitted", "outbox already submitted for this period");
    }
    if (existing.status === "submitting") {
      return baseItem(m, periodStart, periodEnd, validityDate, "in_progress", "outbox currently submitting");
    }
    if (existing.status === "queued") {
      return baseItem(m, periodStart, periodEnd, validityDate, "would_prepare_payload", "queued outbox would be prepared and submitted");
    }
    if (existing.status === "payload_ready") {
      return baseItem(m, periodStart, periodEnd, validityDate, "would_submit_payload_ready", "payload_ready outbox would be submitted after hash verification");
    }
    if (
      existing.status === "failed" ||
      existing.status === "retry_pending" ||
      existing.status === "skipped"
    ) {
      return baseItem(
        m,
        periodStart,
        periodEnd,
        validityDate,
        "needs_manual_retry_or_review",
        `outbox in '${existing.status}' state; scheduler does not retry`,
      );
    }
    return baseItem(m, periodStart, periodEnd, validityDate, "skipped_inactive", `unrecognized outbox status '${existing.status}'`);
  }

  const probe = await probeSnapshotAvailability(adminClient, m, periodStart, periodEnd);
  if (!probe.available) {
    return baseItem(
      m,
      periodStart,
      periodEnd,
      validityDate,
      "not_reportable",
      probe.reason ?? "no snapshot available",
      probe.carry_forward_used,
      probe.snapshot_id,
    );
  }
  return baseItem(
    m,
    periodStart,
    periodEnd,
    validityDate,
    "would_create_outbox",
    probe.carry_forward_used ? "would create outbox using carry-forward snapshot" : "would create outbox from current-period snapshot",
    probe.carry_forward_used,
    probe.snapshot_id,
  );
}

function baseItem(
  m: CandidateMapping,
  periodStart: string,
  periodEnd: string,
  validityDate: string,
  action: DryRunAction,
  reason: string,
  carry_forward_used: boolean | null = null,
  source_snapshot_id: string | null = null,
): DryRunItem {
  return {
    mapping_id: m.id,
    project_id: m.project_id,
    kpi_definition_id: m.kpi_definition_id,
    external_kpi_id: m.external_kpi_id,
    reporting_frequency: m.reporting_frequency,
    period_start: periodStart,
    period_end: periodEnd,
    validity_date: validityDate,
    action,
    reason,
    carry_forward_used,
    source_snapshot_id,
  };
}

async function probeSnapshotAvailability(
  adminClient: ReturnType<typeof createClient<any, "public", any>>,
  m: CandidateMapping,
  periodStart: string,
  periodEnd: string,
): Promise<{
  available: boolean;
  carry_forward_used: boolean;
  snapshot_id: string | null;
  reason?: string;
}> {
  // C2.11a-correction: current-period match must be EXACT on
  // (period_start, period_end) to align with the C2.9a create-path
  // selection rule (`prepare_kpi_app_report_now_select`). Using a
  // period_end range can cause dry_run to disagree with execute/create.
  const { data: current, error: curErr } = await adminClient
    .from("kpi_snapshots")
    .select("id, period_start, period_end, value_type")
    .eq("organization_id", m.organization_id)
    .eq("project_id", m.project_id)
    .eq("kpi_definition_id", m.kpi_definition_id)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (curErr) throw new Error(curErr.message);
  if (current) {
    if (m.kpi_definitions?.value_type && current.value_type !== m.kpi_definitions.value_type) {
      return {
        available: false,
        carry_forward_used: false,
        snapshot_id: null,
        reason: "value_type mismatch between snapshot and KPI definition",
      };
    }
    return { available: true, carry_forward_used: false, snapshot_id: current.id as string };
  }
  if (!m.carry_forward_allowed) {
    return {
      available: false,
      carry_forward_used: false,
      snapshot_id: null,
      reason: "no current-period snapshot and carry_forward not allowed",
    };
  }
  const { data: prior, error: priorErr } = await adminClient
    .from("kpi_snapshots")
    .select("id, period_start, period_end, value_type")
    .eq("organization_id", m.organization_id)
    .eq("project_id", m.project_id)
    .eq("kpi_definition_id", m.kpi_definition_id)
    .lte("period_end", periodEnd)
    .order("period_end", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorErr) throw new Error(priorErr.message);
  if (!prior) {
    return {
      available: false,
      carry_forward_used: false,
      snapshot_id: null,
      reason: "no current-period snapshot and no prior snapshot for carry-forward",
    };
  }
  if (m.kpi_definitions?.value_type && prior.value_type !== m.kpi_definitions.value_type) {
    return {
      available: false,
      carry_forward_used: false,
      snapshot_id: null,
      reason: "value_type mismatch between prior snapshot and KPI definition",
    };
  }
  return { available: true, carry_forward_used: true, snapshot_id: prior.id as string };
}

interface ExecuteCtx {
  mapping: CandidateMapping;
  asOfDate: string;
  authHeader: string;
  adminClient: ReturnType<typeof createClient<any, "public", any>>;
  supabaseUrl: string;
}

async function invokeFunction(
  supabaseUrl: string,
  authHeader: string,
  fnName: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(payload),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = await resp.json();
  } catch {
    parsed = {};
  }
  return { status: resp.status, body: parsed };
}

async function executeForMapping(ctx: ExecuteCtx): Promise<ExecuteItem> {
  const { mapping: m, asOfDate, authHeader, adminClient, supabaseUrl } = ctx;

  const pre = preFilterMapping(m, asOfDate);
  if (pre) {
    return {
      mapping_id: m.id,
      action_taken: "skipped",
      reason: pre.reason ?? pre.action,
      final_status: pre.action,
    };
  }

  const period = periodForMapping(m.reporting_frequency, asOfDate);
  const periodStart = period.period_start as string;
  const periodEnd = period.period_end as string;
  const validityDate = period.validity_date as string;

  const existing = await classifyExistingOutbox(adminClient, m, periodStart, periodEnd);

  let outboxId: string | null = null;
  let carryForwardUsed: boolean | null = null;
  let needPrepare = true;

  if (existing.exists) {
    if (existing.status === "submitted") {
      return {
        mapping_id: m.id,
        outbox_id: existing.id,
        action_taken: "skipped",
        final_status: existing.status,
        reason: "already_submitted",
      };
    }
    if (existing.status === "submitting") {
      return {
        mapping_id: m.id,
        outbox_id: existing.id,
        action_taken: "skipped",
        final_status: existing.status,
        reason: "in_progress",
      };
    }
    if (
      existing.status === "failed" ||
      existing.status === "retry_pending" ||
      existing.status === "skipped"
    ) {
      return {
        mapping_id: m.id,
        outbox_id: existing.id,
        action_taken: "skipped",
        final_status: existing.status,
        reason: "needs_manual_retry_or_review",
      };
    }
    if (existing.status === "queued" || existing.status === "payload_ready") {
      // C2-FIX.4: Scheduler must not act on stale manual Report Now outboxes.
      if (existing.submission_mode !== "scheduled") {
        return {
          mapping_id: m.id,
          outbox_id: existing.id,
          action_taken: "skipped",
          final_status: existing.status,
          reason: `stale manual outbox (submission_mode='${existing.submission_mode ?? "null"}'); scheduler does not process manual rows`,
        };
      }
      outboxId = existing.id;
      needPrepare = existing.status === "queued";
    } else {
      return {
        mapping_id: m.id,
        outbox_id: existing.id,
        action_taken: "skipped",
        final_status: existing.status,
        reason: `unrecognized status '${existing.status}'`,
      };
    }
  } else {
    const prep = await invokeFunction(supabaseUrl, authHeader, "prepare-kpi-app-report-now", {
      mapping_id: m.id,
      reporting_period_start: periodStart,
      reporting_period_end: periodEnd,
      validity_date: validityDate,
      action: "create",
    });
    if (prep.status === 409) {
      return {
        mapping_id: m.id,
        outbox_id: (prep.body.outbox_id as string) ?? null,
        action_taken: "concurrency_conflict",
        final_status: (prep.body.status as string) ?? null,
        reason: (prep.body.error as string) ?? "conflict during outbox create",
      };
    }
    if (prep.status >= 400 || prep.body.ok !== true) {
      return {
        mapping_id: m.id,
        action_taken: "error",
        reason: (prep.body.error as string) ?? `prepare failed (HTTP ${prep.status})`,
      };
    }
    if (prep.body.reportable === false) {
      return {
        mapping_id: m.id,
        action_taken: "not_reportable",
        reason: (prep.body.reason as string) ?? "not_reportable",
      };
    }
    outboxId = (prep.body.outbox_id as string) ?? null;
    carryForwardUsed = (prep.body.carry_forward_used as boolean) ?? null;
    if (prep.body.status === "payload_ready") needPrepare = false;
  }

  if (!outboxId) {
    return {
      mapping_id: m.id,
      action_taken: "error",
      reason: "no outbox_id returned",
    };
  }

  if (needPrepare) {
    const prep = await invokeFunction(supabaseUrl, authHeader, "build-kpi-app-payload", {
      outbox_id: outboxId,
      action: "prepare",
    });
    if (prep.status >= 400 || prep.body.ok !== true) {
      return {
        mapping_id: m.id,
        outbox_id: outboxId,
        action_taken: "error",
        reason: (prep.body.error as string) ??
          ((prep.body.errors as string[] | undefined)?.[0]) ??
          `prepare payload failed (HTTP ${prep.status})`,
      };
    }
  }

  const sub = await invokeFunction(supabaseUrl, authHeader, "submit-kpi-app-payload", {
    outbox_id: outboxId,
  });
  const subBody = sub.body;
  const upstream = (subBody.upstream as Record<string, unknown> | undefined) ?? {};
  if (subBody.ok === true) {
    return {
      mapping_id: m.id,
      outbox_id: outboxId,
      action_taken: "submitted",
      final_status: "submitted",
      request_id: (subBody.request_id as string) ?? null,
      upstream_status: (upstream.status as number) ?? null,
      upstream_status_text: (upstream.status_text as string) ?? null,
      carry_forward_used: carryForwardUsed,
      payload_summary: subBody.payload_summary,
    };
  }
  if (sub.status === 409) {
    return {
      mapping_id: m.id,
      outbox_id: outboxId,
      action_taken: "concurrency_conflict",
      final_status: (subBody.status as string) ?? null,
      reason: (subBody.error as string) ?? "conflict during submit",
    };
  }
  return {
    mapping_id: m.id,
    outbox_id: outboxId,
    action_taken: "failed",
    final_status: (subBody.status as string) ?? "failed",
    request_id: (subBody.request_id as string) ?? null,
    upstream_status: (upstream.status as number) ?? null,
    upstream_status_text: (upstream.status_text as string) ?? null,
    reason: (subBody.error as string) ?? "upstream submit failed",
    carry_forward_used: carryForwardUsed,
    payload_summary: subBody.payload_summary,
  };
}

// ===========================================================================
// C2.11e — System-mode execute path (full lifecycle).
//
// Scope:
//   - When no outbox row exists for the resolved current period, the scheduler
//     creates one via `createOrReuseOutboxSystem` (which uses the
//     C2.11e SECURITY DEFINER RPCs `prepare_kpi_app_report_now_select_system`
//     and `get_kpi_snapshot_decrypted_for_mapping_system`, both EXEC-revoked
//     from PUBLIC/anon/authenticated and only callable by service_role).
//   - For an existing `queued` row, the scheduler prepares the payload via
//     `preparePayloadSystem` (loads the canonical decrypted bundle through
//     `loadPayloadSourceBundleSystem` and runs the canonical
//     `buildKpiAppPayload`).
//   - For `payload_ready` rows (newly prepared or reused), the scheduler
//     submits via `submitOutboxCore` — the SAME submission lifecycle reused
//     by `submit-kpi-app-payload` and `retry-kpi-app-submission`.
//   - `submitted` / `submitting` / `failed` / `retry_pending` / `skipped`
//     remain skipped exactly as in C2.11d-prep. `cancelled` is ignored.
//
// Authority:
//   - Reachable only after the C2.11d secret gate
//     (`verifySchedulerSecret` + `KPI_APP_SCHEDULER_ENABLED === "true"`,
//     no Authorization header, no mapping_id, mode === "execute").
//
// Audit convention:
//   - actorId === null is written into kpi_app_submission_attempts and into
//     kpi_app_submission_outbox (submitted_by/updated_by/created_by) — the
//     documented C2.11d / C2.11e system-mode marker.
//
// Hard rules:
//   - kpi_snapshots only. kpi_updates not read. KPI calculation engine not
//     called. `schedule_signal` / `manual_only` / inactive /
//     `auto_submit_enabled=false` / archived KPI excluded by the system RPC.
//   - No retry of failed/retry_pending. No stale-`submitting` recovery.
//   - No update to `kpi_app_mappings.last_*` (advisory).
//   - No second payload builder; no second MuleSoft connector; no parallel
//     submission lifecycle.
// ===========================================================================

interface ExecuteSystemCtx {
  mapping: CandidateMapping;
  asOfDate: string;
  adminClient: ReturnType<typeof createClient<any, "public", any>>;
  /**
   * C3.9l — when scheduled execution is gated by a due
   * `kpi_schedule_policies` row, the period MUST come from the due-policy
   * evaluation (C3.9i helper) rather than be recomputed from `asOfDate`.
   * This keeps system auto-submit aligned with C3 snapshot capture.
   */
  periodOverride?: {
    period_start: string;
    period_end: string;
    validity_date: string;
  } | null;
}

async function executeForMappingSystem(ctx: ExecuteSystemCtx): Promise<ExecuteItem> {
  const { mapping: m, asOfDate, adminClient, periodOverride } = ctx;

  const pre = preFilterMapping(m, asOfDate);
  if (pre) {
    return {
      mapping_id: m.id,
      action_taken: "skipped",
      reason: pre.reason ?? pre.action,
      final_status: pre.action,
    };
  }

  let periodStart: string;
  let periodEnd: string;
  let validityDate: string;
  if (periodOverride) {
    periodStart = periodOverride.period_start;
    periodEnd = periodOverride.period_end;
    validityDate = periodOverride.validity_date;
  } else {
    const period = periodForMapping(m.reporting_frequency, asOfDate);
    periodStart = period.period_start as string;
    periodEnd = period.period_end as string;
    validityDate = period.validity_date as string;
  }

  const existing = await classifyExistingOutbox(adminClient, m, periodStart, periodEnd);

  let outboxId: string | null = null;
  let outboxStatus: string | null = null;
  let carryForwardUsed: boolean | null = null;

  if (existing.exists) {
    if (existing.status === "submitted") {
      return {
        mapping_id: m.id,
        outbox_id: existing.id,
        action_taken: "skipped",
        final_status: existing.status,
        reason: "already_submitted",
      };
    }
    if (existing.status === "submitting") {
      return {
        mapping_id: m.id,
        outbox_id: existing.id,
        action_taken: "skipped",
        final_status: existing.status,
        reason: "in_progress",
      };
    }
    if (
      existing.status === "failed" ||
      existing.status === "retry_pending" ||
      existing.status === "skipped"
    ) {
      return {
        mapping_id: m.id,
        outbox_id: existing.id,
        action_taken: "skipped",
        final_status: existing.status,
        reason: "needs_manual_retry_or_review",
      };
    }
    if (existing.status === "queued" || existing.status === "payload_ready") {
      // C2-FIX.4: Scheduler must NOT submit stale manual Report Now outboxes.
      // Manual rows must be resolved or reset through the manual flow.
      if (existing.submission_mode !== "scheduled") {
        return {
          mapping_id: m.id,
          outbox_id: existing.id,
          action_taken: "skipped",
          final_status: existing.status,
          reason: `stale manual outbox (submission_mode='${existing.submission_mode ?? "null"}'); scheduler does not process manual rows`,
        };
      }
      outboxId = existing.id;
      outboxStatus = existing.status;
    } else {
      return {
        mapping_id: m.id,
        outbox_id: existing.id,
        action_taken: "skipped",
        final_status: existing.status,
        reason: `unsupported outbox status '${existing.status}'`,
      };
    }
  } else {
    // No row: create/reuse via system-mode helper.
    let createResult;
    try {
      createResult = await createOrReuseOutboxSystem({
        adminClient,
        mappingId: m.id,
        organizationId: m.organization_id,
        workspaceId: m.workspace_id,
        projectId: m.project_id,
        kpiDefinitionId: m.kpi_definition_id,
        reportingPeriodStart: periodStart,
        reportingPeriodEnd: periodEnd,
        validityDate,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "outbox create failed";
      return {
        mapping_id: m.id,
        action_taken: "error",
        reason: msg.slice(0, 300),
      };
    }
    if (createResult.kind === "not_reportable") {
      return {
        mapping_id: m.id,
        action_taken: "not_reportable",
        reason: createResult.reason.slice(0, 300),
      };
    }
    if (createResult.kind === "conflict") {
      return {
        mapping_id: m.id,
        outbox_id: createResult.outbox_id,
        action_taken: "concurrency_conflict",
        final_status: createResult.status,
        reason: createResult.reason,
      };
    }
    outboxId = createResult.outbox_id;
    outboxStatus = createResult.status;
    carryForwardUsed = createResult.carry_forward_used;
  }

  if (!outboxId || !outboxStatus) {
    return {
      mapping_id: m.id,
      action_taken: "error",
      reason: "no outbox_id resolved",
    };
  }

  // Prepare payload if still queued.
  if (outboxStatus === "queued") {
    const prepResult = await preparePayloadSystem(adminClient, outboxId);
    if (prepResult.kind === "error") {
      // C3.10b — Do not let queued scheduled rows remain silently stuck.
      // Mark the outbox as failed with a diagnosable last_error_message
      // so the Submission Monitor surfaces the row and admins can act.
      // System-mode audit convention: submitted_by/updated_by = NULL.
      const failedAt = new Date().toISOString();
      const safeReason = prepResult.reason.slice(0, 500);
      try {
        await adminClient
          .from("kpi_app_submission_outbox")
          .update({
            status: "failed",
            last_attempt_at: failedAt,
            last_error_message: `prepare_payload_failed: ${safeReason}`,
            updated_by: null,
            updated_at: failedAt,
          })
          .eq("id", outboxId)
          .eq("status", "queued");
      } catch (_e) {
        // best-effort diagnostic write; do not mask the original error
      }
      return {
        mapping_id: m.id,
        outbox_id: outboxId,
        action_taken: "failed",
        final_status: "failed",
        reason: `prepare_payload_failed: ${safeReason}`,
      };
    }
    if (typeof prepResult.carry_forward_used === "boolean") {
      carryForwardUsed = prepResult.carry_forward_used;
    }
    outboxStatus = "payload_ready";
  }

  // Submit via canonical submitOutboxCore (no second connector, no second
  // submission lifecycle). Decrypted bundle is loaded via the canonical
  // system-mode helper.
  const requestId = crypto.randomUUID();
  let bundle;
  try {
    bundle = await loadPayloadSourceBundleSystem(adminClient, outboxId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "bundle load failed";
    return {
      mapping_id: m.id,
      outbox_id: outboxId,
      action_taken: "error",
      reason: msg.slice(0, 300),
    };
  }

  let result;
  try {
    result = await submitOutboxCore({
      adminClient,
      bundle,
      actorId: null, // C2.11d/C2.11e system-mode audit marker
      requestId,
      auditFunctionName: "run-kpi-app-scheduler",
      auditReason: "kpi-app-scheduler-submit",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "submitOutboxCore crashed";
    return {
      mapping_id: m.id,
      outbox_id: outboxId,
      action_taken: "error",
      reason: msg.slice(0, 300),
    };
  }

  if (result.ok) {
    return {
      mapping_id: m.id,
      outbox_id: result.outbox_id,
      action_taken: "submitted",
      final_status: "submitted",
      request_id: result.request_id,
      upstream_status: result.upstream?.status ?? null,
      upstream_status_text: result.upstream?.status_text ?? null,
      carry_forward_used: carryForwardUsed,
      payload_summary: result.payload_summary,
    };
  }
  if (result.http_status === 409) {
    return {
      mapping_id: m.id,
      outbox_id: result.outbox_id,
      action_taken: "concurrency_conflict",
      final_status: result.status,
      reason: result.error ?? "conflict during system submit",
    };
  }
  return {
    mapping_id: m.id,
    outbox_id: result.outbox_id,
    action_taken: "failed",
    final_status: result.status,
    request_id: result.request_id,
    upstream_status: result.upstream?.status ?? null,
    upstream_status_text: result.upstream?.status_text ?? null,
    reason: result.error ?? "upstream submit failed",
    carry_forward_used: carryForwardUsed,
    payload_summary: result.payload_summary,
  };
}

