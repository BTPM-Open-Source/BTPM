// BTPM — Wave C3, Step C3.8
// Automatic KPI Snapshot Capture — internal signed cron wrapper.
//
// Purpose
// -------
// Thin wrapper that allows pg_cron + pg_net to invoke the canonical
// `run-kpi-snapshot-capture-scheduler` orchestrator on a daily 05:00 UTC
// schedule under the "Internal Signed Scheduler Invocation" authority
// model (mirrors C2.11d for the KPI App scheduler).
//
// Authority model:
//   1) `x-snapshot-scheduler-secret` header MUST match
//      `KPI_SNAPSHOT_SCHEDULER_SECRET` (constant-time compare).
//   2) `KPI_SNAPSHOT_SCHEDULER_ENABLED` MUST equal the literal "true".
//   3) Wrapper forwards to the orchestrator with the SAME scheduler
//      secret + `invocation_source: "system"` and NO `Authorization`
//      header. The orchestrator re-verifies both gates before
//      constructing a service-role client.
//   4) System mode is org-wide only — organization_id / workspace_id /
//      project_id / kpi_definition_id are rejected.
//
// Hard rules upheld:
//   - No second candidate selector, period resolver, eligibility
//     filter, calculation engine call, or kpi_snapshots insert here.
//     All such logic lives in the canonical orchestrator.
//   - kpi_snapshots remains the only reporting source.
//   - kpi_updates is not read or written here.
//   - The KPI calculation engine is NOT called here.
//   - schedule_signal / manual_only / manual / archived / non-eligible
//     filtering is enforced inside the orchestrator (C3.3 freeze).
//   - Existing snapshots are never overwritten (C3.5 partial unique
//     index + orchestrator probe).
//   - Manual snapshot capture remains available via capture-kpi-snapshot.
//   - No MuleSoft / KPI App / outbox / attempts touched.
//   - No Power BI write-back. No direct MS SQL.
//   - No service-role key in frontend; no human JWT in secrets.
//   - No frontend scheduler UI. No monitoring dashboard added here.
//
// Activation — SAFE BY DEFAULT
// ----------------------------
// With either secret missing/incorrect or
// `KPI_SNAPSHOT_SCHEDULER_ENABLED` not equal to "true", the wrapper
// short-circuits to a no-op response and never invokes the
// orchestrator. Live recurring captures therefore require an explicit
// operator opt-in (set both secrets) AND a committed pg_cron schedule.
// The pg_cron schedule itself is intentionally NOT committed in this
// repo and is delivered as an ops runbook only (see
// docs/operations/KPI_SCHEDULER.md).
//
// Scheduler ordering (C3.1 freeze):
//   05:00 UTC — automatic snapshot capture (this wrapper)
//   06:00 UTC — KPI App auto-submit official snapshots (C2 wrapper)

import {
  verifySnapshotSchedulerSecret,
  SnapshotSchedulerAuthError,
  isSnapshotSchedulerEnabled,
} from "../_shared/kpi-snapshot-scheduler-auth.ts";

const ALLOWED_BODY_KEYS = new Set(["as_of_date"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return json(
      { request_id: requestId, ok: false, error: "Method not allowed" },
      405,
    );
  }

  // 1. Constant-time secret gate. Generic "Unauthorized" error — never
  //    logs or returns the secret value.
  try {
    verifySnapshotSchedulerSecret(req);
  } catch (e) {
    const status = e instanceof SnapshotSchedulerAuthError ? e.status : 401;
    return json(
      { request_id: requestId, ok: false, error: "Unauthorized" },
      status,
    );
  }

  // 2. Strict body allow-list. The only allowed body field is the
  //    optional `as_of_date`. `mode` is forced to "execute" (the
  //    wrapper never enumerates) and the orchestrator's system-mode
  //    contract rejects any other mode anyway.
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw && raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return json(
          { request_id: requestId, ok: false, error: "Invalid request body" },
          400,
        );
      }
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return json(
      { request_id: requestId, ok: false, error: "Invalid JSON body" },
      400,
    );
  }
  const extraKeys = Object.keys(body).filter((k) => !ALLOWED_BODY_KEYS.has(k));
  if (extraKeys.length > 0) {
    return json(
      {
        request_id: requestId,
        ok: false,
        error: `Unexpected fields: ${extraKeys.join(", ")}`,
      },
      400,
    );
  }

  let asOfDate: string;
  if (body.as_of_date === undefined || body.as_of_date === null) {
    asOfDate = todayUtcIso();
  } else if (!isValidIsoDate(body.as_of_date)) {
    return json(
      { request_id: requestId, ok: false, error: "Invalid as_of_date" },
      400,
    );
  } else {
    asOfDate = body.as_of_date;
  }

  // 3. Activation gate. With ENABLED != "true", short-circuit and
  //    never touch the orchestrator. Deploying this function or
  //    scheduling pg_cron alone cannot cause a snapshot capture.
  if (!isSnapshotSchedulerEnabled()) {
    return json(
      {
        request_id: requestId,
        ok: true,
        mode: "execute",
        as_of_date: asOfDate,
        activated: false,
        invoked_scheduler: false,
        reason:
          "KPI_SNAPSHOT_SCHEDULER_ENABLED is not 'true'; scheduler is inert",
      },
      200,
    );
  }

  // 4. Forward to the canonical orchestrator in SYSTEM mode. The
  //    orchestrator re-verifies the same x-snapshot-scheduler-secret,
  //    rejects any Authorization header, rejects scope filters, and
  //    only then constructs a service-role client. NO duplicate
  //    candidate selection or calculation logic is performed here.
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const schedulerSecret = Deno.env.get("KPI_SNAPSHOT_SCHEDULER_SECRET");
  if (!SUPABASE_URL || !schedulerSecret) {
    return json(
      { request_id: requestId, ok: false, error: "Server misconfigured" },
      500,
    );
  }

  const orchestratorUrl =
    `${SUPABASE_URL}/functions/v1/run-kpi-snapshot-capture-scheduler`;
  let upstreamStatus = 0;
  let upstreamSummary: Record<string, unknown> = {};
  try {
    const resp = await fetch(orchestratorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the same scheduler secret (verified by the
        // orchestrator via constant-time compare). DO NOT forward an
        // Authorization header — system mode is mutually exclusive
        // with the human-admin path. DO NOT substitute the
        // service-role key for a human JWT here.
        "x-snapshot-scheduler-secret": schedulerSecret,
      },
      body: JSON.stringify({
        mode: "execute",
        as_of_date: asOfDate,
        invocation_source: "system",
        // C3.9k — forward "now" UTC ISO so the orchestrator's due-engine
        // (kpi_schedule_policies) evaluates against actual cron firing
        // time, not midnight UTC of as_of_date. Wrapper stays thin: no
        // due logic, no candidate selection, no snapshot writes.
        as_of_datetime_utc: new Date().toISOString(),
      }),
    });
    upstreamStatus = resp.status;
    try {
      const parsed = await resp.json();
      // Pass through ONLY non-sensitive summary counters. We never
      // surface raw operational data, formula payloads, or per-row
      // values from this wrapper.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>;
        upstreamSummary = {
          ok: p.ok ?? null,
          mode: p.mode ?? null,
          as_of_date: p.as_of_date ?? null,
          invocation_source: p.invocation_source ?? null,
          activated: p.activated ?? null,
          candidate_count: p.candidate_count ?? null,
          created_count: p.created_count ?? null,
          skipped_existing_snapshot_count:
            p.skipped_existing_snapshot_count ?? null,
          calculation_not_ready_count: p.calculation_not_ready_count ?? null,
          failed_count: p.failed_count ?? null,
          error:
            typeof p.error === "string"
              ? (p.error as string).slice(0, 200)
              : null,
        };
      }
    } catch {
      upstreamSummary = {};
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return json(
      {
        request_id: requestId,
        ok: false,
        mode: "execute",
        as_of_date: asOfDate,
        activated: true,
        invoked_scheduler: true,
        upstream_status: upstreamStatus,
        error: msg.slice(0, 200),
      },
      502,
    );
  }

  return json(
    {
      request_id: requestId,
      ok: upstreamStatus >= 200 && upstreamStatus < 300,
      mode: "execute",
      as_of_date: asOfDate,
      activated: true,
      invoked_scheduler: true,
      upstream_status: upstreamStatus,
      upstream_summary: upstreamSummary,
    },
    200,
  );
});
