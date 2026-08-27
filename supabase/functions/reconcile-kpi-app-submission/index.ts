// BTPM — Wave C2, Step C2.12a
// Stale-submitting reconciliation handler for KPI App submissions.
//
// Hard rules:
//   - Authenticated POST only.
//   - Strict body allow-list: { outbox_id, action }.
//     action ∈ { "mark_retry_pending", "mark_failed" }.
//   - Authority: Org Admin OR Workspace Admin-or-higher for the outbox row's
//     workspace (validated via get_kpi_app_outbox_admin).
//   - Service-role client is only constructed AFTER the admin gate passes.
//   - Operates ONLY on rows whose current status = 'submitting' AND that
//     are stale (last_attempt_at older than 30 minutes; if NULL, updated_at
//     older than 30 minutes).
//   - Does NOT call MuleSoft.
//   - Does NOT insert kpi_app_submission_attempts rows.
//   - Does NOT increment retry_count.
//   - Does NOT mutate source_snapshot_id, payload_hash, payload_summary,
//     payload_row_count, source_* fields, or any other payload metadata.
//   - Does NOT update kpi_app_mappings.last_* fields.
//   - Does NOT log credentials, payload, or full upstream body.
//
// Allowed mutations on the same kpi_app_submission_outbox row only:
//   - status                (submitting -> retry_pending | failed)
//   - last_error_message    (controlled, encrypted automatically by trigger)
//   - updated_by, updated_at

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { buildBrowserCorsHeaders } from "../_shared/browserCors.ts";
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
const STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes
const ALLOWED_ACTIONS = new Set(["mark_retry_pending", "mark_failed"]);

const MSG_RETRY_PENDING =
  "Marked retry pending by admin reconciliation after stale submitting state.";
const MSG_FAILED =
  "Marked failed by admin reconciliation after stale submitting state.";

Deno.serve(async (req) => {
  const cors = buildBrowserCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return json({ request_id: requestId, ok: false, error: "Method not allowed" }, cors, 405);
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json({ request_id: requestId, ok: false, error: "Missing authorization" }, cors, 401);
    }

    // ---- Supabase clients ----
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
      return toSafeErrorResponse(guardError, cors);
    }

    // ---- Parse + strict body allow-list ----
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return json({ request_id: requestId, ok: false, error: "Invalid request body" }, cors, 400);
    }
    const ALLOWED_KEYS = new Set(["outbox_id", "action"]);
    const extraKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
    if (extraKeys.length > 0) {
      return json(
        { request_id: requestId, ok: false, error: `Unexpected fields: ${extraKeys.join(", ")}` },
        cors,
        400,
      );
    }
    const outboxId = (body as Record<string, unknown>).outbox_id;
    const action = (body as Record<string, unknown>).action;
    if (typeof outboxId !== "string" || !UUID_RE.test(outboxId)) {
      return json({ request_id: requestId, ok: false, error: "Invalid outbox_id" }, cors, 400);
    }
    if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
      return json(
        { request_id: requestId, ok: false, error: "Invalid action" },
        cors,
        400,
      );
    }

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ request_id: requestId, ok: false, error: "Unauthorized" }, cors, 401);
    }
    const callerId = userData.user.id;

    // ---- Authority gate (same pattern as C2.10 retry) ----
    const { error: gateErr } = await userClient.rpc("get_kpi_app_outbox_admin", {
      _outbox_id: outboxId,
    });
    if (gateErr) {
      return json(
        { request_id: requestId, ok: false, error: gateErr.message || "Access denied" },
        cors,
        403,
      );
    }

    // ---- Service-role client (only after admin gate) ----
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---- Load minimal row state for stale evaluation ----
    const { data: row, error: rowErr } = await adminClient
      .from("kpi_app_submission_outbox")
      .select("id, status, last_attempt_at, updated_at")
      .eq("id", outboxId)
      .maybeSingle();
    if (rowErr || !row) {
      return json(
        { request_id: requestId, ok: false, error: rowErr?.message || "Outbox not found" },
        cors,
        404,
      );
    }

    if (row.status !== "submitting") {
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          status: row.status,
          error: "Reconciliation only applies to rows currently in 'submitting' state.",
        },
        cors,
        409,
      );
    }

    const refTimestamp =
      (row.last_attempt_at as string | null) ??
      (row.updated_at as string | null) ??
      null;
    if (!refTimestamp) {
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          error: "Outbox has no timestamp to evaluate staleness.",
        },
        cors,
        409,
      );
    }
    const ageMs = Date.now() - new Date(refTimestamp).getTime();
    if (!Number.isFinite(ageMs) || ageMs < STALE_AFTER_MS) {
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          error:
            "Outbox is not yet stale. Reconciliation requires no progress for at least 30 minutes.",
        },
        cors,
        409,
      );
    }

    // ---- Conditional update: submitting -> retry_pending | failed ----
    const nextStatus = action === "mark_retry_pending" ? "retry_pending" : "failed";
    const message = action === "mark_retry_pending" ? MSG_RETRY_PENDING : MSG_FAILED;
    const nowIso = new Date().toISOString();

    const { data: updated, error: updErr } = await adminClient
      .from("kpi_app_submission_outbox")
      .update({
        status: nextStatus,
        last_error_message: message, // encrypted by existing trigger
        updated_by: callerId,
        updated_at: nowIso,
      })
      .eq("id", outboxId)
      .eq("status", "submitting")
      .select("id, status, updated_at");
    if (updErr) {
      return json(
        { request_id: requestId, ok: false, outbox_id: outboxId, error: updErr.message },
        cors,
        500,
      );
    }
    if (!updated || updated.length === 0) {
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          error: "Outbox no longer in 'submitting' state (concurrent change).",
        },
        cors,
        409,
      );
    }

    return json(
      {
        request_id: requestId,
        ok: true,
        outbox_id: outboxId,
        action,
        status: nextStatus,
      },
      cors,
      200,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return json({ request_id: requestId, ok: false, error: msg }, cors, 500);
  }
});
