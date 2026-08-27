// BTPM — Wave C2, Step C2.11d
// Scheduled KPI App Reporting — internal signed cron wrapper.
//
// Purpose
// -------
// Thin wrapper that allows pg_cron + pg_net to invoke the canonical
// `run-kpi-app-scheduler` orchestrator on a recurring schedule under the
// C2.11c-frozen "Internal Signed Scheduler Invocation" authority model
// implemented in C2.11d.
//
// Authority model:
//   1) `x-scheduler-secret` header MUST match `KPI_APP_SCHEDULER_SECRET`
//      in the Supabase function environment (constant-time compare).
//   2) `KPI_APP_SCHEDULER_ENABLED` MUST equal the literal string "true".
//   3) Wrapper forwards to the orchestrator with the SAME scheduler
//      secret + `invocation_source: "system"` and NO `Authorization`
//      header. The orchestrator re-verifies both gates before
//      constructing a service-role client.
//   4) System mode is org-scoped only — `mapping_id` is rejected.
//
// Hard rules upheld:
//   - No second candidate selector, payload builder, MuleSoft connector,
//     or outbox/attempt audit lifecycle is implemented here.
//   - kpi_snapshots remains the only reporting source.
//   - kpi_updates is not read here.
//   - The KPI calculation engine is not called here.
//   - schedule_signal / manual_only / inactive / auto_submit_enabled=false
//     filtering is enforced inside `run-kpi-app-scheduler`.
//   - failed / retry_pending rows remain manual-retry only (C2.10).
//   - stale `submitting` rows are not recovered here (deferred to C2.12).
//   - kpi_app_mappings.last_* is not updated.
//   - No frontend access. No service-role key in frontend.
//   - No MuleSoft credentials read here.
//   - No full payload body persisted or returned.
//   - No Power BI write-back. No direct MS SQL.
//   - No scheduler UI, no monitoring dashboard added by this step.
//
// Activation — SAFE BY DEFAULT
// ----------------------------
// With either secret missing/incorrect or `KPI_APP_SCHEDULER_ENABLED` not
// equal to "true", the wrapper short-circuits to a no-op response and
// never invokes the orchestrator. Live recurring submissions therefore
// require an explicit operator opt-in (set both secrets) AND a committed
// pg_cron schedule. The cron schedule itself is intentionally NOT
// committed in this repo and is delivered as an ops runbook only.

import {
  verifySchedulerSecret,
  SchedulerAuthError,
  isSchedulerEnabled,
} from "../_shared/kpi-app-scheduler-auth.ts";

const ALLOWED_BODY_KEYS = new Set(["mode", "as_of_date", "as_of_datetime_utc"]);

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
    return json({ request_id: requestId, ok: false, error: "Method not allowed" }, 405);
  }

  // 1. Shared-secret gate via constant-time comparison helper
  //    (C2.11d-correction). The helper reads KPI_APP_SCHEDULER_SECRET from
  //    the function environment, refuses missing/empty configuration, and
  //    rejects any header mismatch in constant time. Secret values are
  //    never logged or returned in errors.
  try {
    verifySchedulerSecret(req);
  } catch (e) {
    const status = e instanceof SchedulerAuthError ? e.status : 401;
    return json(
      { request_id: requestId, ok: false, error: "Unauthorized" },
      status,
    );
  }

  // 2. Strict body allow-list (mode optional; defaults to dry_run for safety).
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw && raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
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

  // The wrapper is system-only and the orchestrator (C2.11d-correction)
  // rejects any non-execute mode under invocation_source="system". We
  // therefore default to "execute" here. Activation remains gated by
  // KPI_APP_SCHEDULER_ENABLED, so the default is still inert until an
  // operator explicitly opts in.
  const modeInput = body.mode;
  const mode: "dry_run" | "execute" =
    modeInput === "dry_run" ? "dry_run" : "execute";

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

  // C3.9l — forward as_of_datetime_utc so the orchestrator's schedule-policy
  // due engine evaluates against the cron's actual firing instant. If the
  // caller did not supply one, default to "now" UTC. Wrapper does no due
  // logic itself.
  let asOfDateTimeUtc: string;
  if (
    body.as_of_datetime_utc === undefined ||
    body.as_of_datetime_utc === null
  ) {
    asOfDateTimeUtc = new Date().toISOString();
  } else if (typeof body.as_of_datetime_utc !== "string") {
    return json(
      { request_id: requestId, ok: false, error: "Invalid as_of_datetime_utc" },
      400,
    );
  } else {
    const parsed = new Date(body.as_of_datetime_utc);
    if (Number.isNaN(parsed.getTime())) {
      return json(
        { request_id: requestId, ok: false, error: "Invalid as_of_datetime_utc" },
        400,
      );
    }
    asOfDateTimeUtc = parsed.toISOString();
  }

  // 3. Activation gate. With ENABLED != "true", we short-circuit and never
  //    touch the orchestrator. This guarantees that merely deploying this
  //    function or scheduling pg_cron cannot cause an external submission.
  if (!isSchedulerEnabled()) {
    return json(
      {
        request_id: requestId,
        ok: true,
        mode,
        as_of_date: asOfDate,
        activated: false,
        reason: "KPI_APP_SCHEDULER_ENABLED is not 'true'; scheduler is inert",
        invoked_orchestrator: false,
      },
      200,
    );
  }

  // 4. Forward to the canonical C2.11a orchestrator in SYSTEM mode
  //    (C2.11d). The orchestrator verifies the same x-scheduler-secret,
  //    rejects any Authorization header, and only then constructs a
  //    service-role client to iterate eligible mappings org-wide. NO
  //    duplicate candidate selection, payload building, or MuleSoft
  //    submission is performed here.
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const schedulerSecret = Deno.env.get("KPI_APP_SCHEDULER_SECRET");
  if (!SUPABASE_URL || !schedulerSecret) {
    return json(
      { request_id: requestId, ok: false, error: "Server misconfigured" },
      500,
    );
  }

  const orchestratorUrl = `${SUPABASE_URL}/functions/v1/run-kpi-app-scheduler`;
  let upstreamStatus = 0;
  let upstreamSummary: Record<string, unknown> = {};
  try {
    const resp = await fetch(orchestratorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Internal Signed Scheduler Invocation (C2.11c freeze):
        //   - Forward the same scheduler secret. The orchestrator verifies
        //     it via constant-time compare in `verifySchedulerSecret`.
        //   - DO NOT forward an Authorization header — system mode is
        //     mutually exclusive with the human-admin path.
        //   - DO NOT substitute the service-role key for a human JWT here.
        "x-scheduler-secret": schedulerSecret,
      },
      body: JSON.stringify({
        mode,
        as_of_date: asOfDate,
        as_of_datetime_utc: asOfDateTimeUtc,
        invocation_source: "system",
      }),
    });
    upstreamStatus = resp.status;
    try {
      const parsed = await resp.json();
      // Pass through ONLY non-sensitive summary counters. We never
      // surface decrypted text, payload bodies, or upstream MuleSoft
      // bodies from this wrapper.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>;
        upstreamSummary = {
          ok: p.ok ?? null,
          mode: p.mode ?? null,
          as_of_date: p.as_of_date ?? null,
          as_of_datetime_utc: p.as_of_datetime_utc ?? null,
          invocation_source: p.invocation_source ?? null,
          activated: p.activated ?? null,
          due_policy_count: p.due_policy_count ?? null,
          processed_cadences: p.processed_cadences ?? null,
          processed_workspace_count: p.processed_workspace_count ?? null,
          candidate_count: p.candidate_count ?? null,
          processed_count: p.processed_count ?? null,
          submitted_count: p.submitted_count ?? null,
          failed_count: p.failed_count ?? null,
          skipped_count: p.skipped_count ?? null,
          error: typeof p.error === "string" ? (p.error as string).slice(0, 200) : null,
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
        mode,
        as_of_date: asOfDate,
        activated: true,
        invoked_orchestrator: true,
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
      mode,
      as_of_date: asOfDate,
      activated: true,
      invoked_orchestrator: true,
      upstream_status: upstreamStatus,
      upstream_summary: upstreamSummary,
    },
    200,
  );
});
