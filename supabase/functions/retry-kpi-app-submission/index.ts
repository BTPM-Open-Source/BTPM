// BTPM — Wave C2, Step C2.10
// Manual retry handler for failed / retry_pending KPI App submissions.
//
// Responsibilities:
//   - Authenticated POST (org/workspace admin authority).
//   - Accepts ONLY { outbox_id }. Any other top-level field => 400.
//   - Verifies the latest outbox status is failed or retry_pending.
//     queued/payload_ready -> 409 (use Report Now flow).
//     submitting -> 409 (stale recovery deferred to C2.12).
//     submitted/skipped/cancelled -> 409.
//   - Reuses the SAME outbox row and SAME source_snapshot_id.
//   - Reuses the C2.5 shared payload builder. No client-supplied rows.
//   - Verifies rebuilt payload_hash + payload_row_count match the
//     persisted outbox metadata. Mismatch / missing => 409 (re-prepare).
//   - Reuses the C2.6 shared MuleSoft helper for the external call.
//   - Conditionally transitions failed/retry_pending -> submitting.
//   - Inserts EXACTLY ONE attempt row per actual external retry call.
//   - Updates the same outbox row to submitted (success) or failed (failure)
//     and increments retry_count.
//   - Does NOT update kpi_app_mappings.last_* fields.
//   - Does NOT store the full payload body anywhere.
//   - Does NOT log credentials, payload, or full upstream body.
//   - Does NOT auto-retry. No scheduler. No backoff.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { buildBrowserCorsHeaders } from "../_shared/browserCors.ts";
import {
  buildKpiAppPayload,
  type PayloadSourceBundle,
} from "../_shared/kpi-app-payload-builder.ts";
import { submitKpiAppPayload } from "../_shared/kpi-app-mulesoft-client.ts";
import { loadPayloadSourceBundleSystem } from "../_shared/kpi-app-payload-source-system.ts";
import {
  resolveTenantMulesoftKpiRuntimeConfig,
  toSafeMulesoftKpiPublicError,
} from "../_shared/tenantMulesoftKpi.ts";
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
const RETRY_ELIGIBLE = new Set(["failed", "retry_pending"]);

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
    const ALLOWED_KEYS = new Set(["outbox_id"]);
    const extraKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
    if (extraKeys.length > 0) {
      return json(
        { request_id: requestId, ok: false, error: `Unexpected fields: ${extraKeys.join(", ")}` },
        cors,
        400,
      );
    }
    const outboxId = (body as Record<string, unknown>).outbox_id;
    if (typeof outboxId !== "string" || !UUID_RE.test(outboxId)) {
      return json({ request_id: requestId, ok: false, error: "Invalid outbox_id" }, cors, 400);
    }

    const { data: userData, error: userErr } = await userClient.auth.getUser();

    if (userErr || !userData?.user) {
      return json({ request_id: requestId, ok: false, error: "Unauthorized" }, cors, 401);
    }
    const callerId = userData.user.id;

    // ---- Permission gate (admin RPC, same pattern as C2.6) ----
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

    // ---- Service-role client (only used after admin gate) ----
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---- Decrypted source bundle ----
    // For manual submissions we use the admin-gated RPC (caller identity).
    // For scheduled submissions (C3.10c) we MUST use the system-mode loader
    // so that EnteredBy_Email resolves to the configured BTPM system email
    // regardless of mapping.entered_by_email_source. Without this, retrying
    // a scheduled row whose mapping uses snapshot_created_by + a NULL
    // snapshot.created_by fails with "entered_by_email could not be resolved".
    const { data: modeRow, error: modeErr } = await adminClient
      .from("kpi_app_submission_outbox")
      .select("submission_mode")
      .eq("id", outboxId)
      .maybeSingle();
    if (modeErr || !modeRow) {
      return json(
        { request_id: requestId, ok: false, error: modeErr?.message || "Outbox not found" },
        cors,
        404,
      );
    }
    const isScheduled = modeRow.submission_mode === "scheduled";

    let bundle: PayloadSourceBundle;
    if (isScheduled) {
      try {
        bundle = await loadPayloadSourceBundleSystem(adminClient, outboxId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "System bundle load failed";
        return json(
          { request_id: requestId, ok: false, outbox_id: outboxId, errors: [msg] },
          cors,
          422,
        );
      }
    } else {
      const { data: bundleRaw, error: srcErr } = await userClient.rpc(
        "get_kpi_app_payload_source",
        { _outbox_id: outboxId },
      );
      if (srcErr || !bundleRaw) {
        return json(
          { request_id: requestId, ok: false, error: srcErr?.message || "Source not available" },
          cors,
          400,
        );
      }
      bundle = bundleRaw as PayloadSourceBundle;
    }

    // ---- Eligibility ----
    const currentStatus = bundle.outbox.status;
    if (!RETRY_ELIGIBLE.has(currentStatus)) {
      const code = currentStatus;
      let msg = `Outbox status '${currentStatus}' is not retryable.`;
      if (currentStatus === "submitting") {
        msg =
          "Outbox is currently submitting. Stale-submitting recovery is not handled by retry; reconciliation belongs to C2.12.";
      } else if (currentStatus === "submitted") {
        msg = "Outbox is already submitted; nothing to retry.";
      } else if (currentStatus === "queued" || currentStatus === "payload_ready") {
        msg = "Outbox has not been submitted yet; use the normal Report Now flow.";
      } else if (currentStatus === "skipped" || currentStatus === "cancelled") {
        msg = `Outbox is ${currentStatus}; not retryable.`;
      }
      return json(
        { request_id: requestId, ok: false, outbox_id: outboxId, status: code, error: msg },
        cors,
        409,
      );
    }

    // ---- Pull persisted payload metadata + retry_count + source_snapshot_id ----
    const { data: outboxMeta, error: metaErr } = await adminClient
      .from("kpi_app_submission_outbox")
      .select(
        "id, status, payload_hash, payload_row_count, retry_count, source_snapshot_id",
      )
      .eq("id", outboxId)
      .maybeSingle();
    if (metaErr || !outboxMeta) {
      return json(
        { request_id: requestId, ok: false, error: metaErr?.message || "Outbox not found" },
        cors,
        404,
      );
    }
    const payloadMetaMissing =
      !outboxMeta.payload_hash || outboxMeta.payload_row_count == null;
    // Note: when the row was marked failed at prepare-time (C3.10b scheduler
    // path), payload_hash / payload_row_count are NULL. We back-fill them
    // below from the canonical builder result against the SAME source bundle
    // — no second prepare path is introduced.

    // Defensive: source_snapshot_id must remain stable across retry.
    if (
      outboxMeta.source_snapshot_id &&
      bundle.outbox.source_snapshot_id &&
      outboxMeta.source_snapshot_id !== bundle.outbox.source_snapshot_id
    ) {
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          error: "Source snapshot drift detected; aborting retry.",
        },
        cors,
        409,
      );
    }

    // ---- Rebuild payload via C2.5 shared builder (no reimplementation) ----
    let built;
    try {
      built = await buildKpiAppPayload(bundle);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Builder failed";
      return json(
        { request_id: requestId, ok: false, outbox_id: outboxId, errors: [msg] },
        cors,
        422,
      );
    }

    if (
      !payloadMetaMissing &&
      (built.payload_hash !== outboxMeta.payload_hash ||
        built.payload_row_count !== outboxMeta.payload_row_count)
    ) {
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          error:
            "Payload metadata is stale or missing. Re-run prepare before retry.",
        },
        cors,
        409,
      );
    }

    const previousRetryCount =
      typeof outboxMeta.retry_count === "number" ? outboxMeta.retry_count : 0;

    // ---- Resolve MuleSoft KPI runtime configuration BEFORE any status
    //      transition, attempt row, or retry count increment. If Tenant
    //      integration resolution is blocked/disabled/incomplete/invalid,
    //      the outbox stays in its existing failed/retry_pending state.
    //      There is NO Global env-secret fallback.
    let connectorConfig;
    try {
      connectorConfig = await resolveTenantMulesoftKpiRuntimeConfig({
        organizationId: bundle.outbox.organization_id,
        action: "external_api_write",
        reason: "kpi-app-retry",
        functionName: "retry-kpi-app-submission",
        requestId,
      });
    } catch (e) {
      const safe = toSafeMulesoftKpiPublicError(e);
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          status: currentStatus,
          code: safe.code,
          error: safe.message,
        },
        cors,
        200,
      );
    }

    // ---- Concurrency: conditional failed/retry_pending -> submitting ----
    const transitionAt = new Date().toISOString();
    const transitionUpdate: Record<string, unknown> = {
      status: "submitting",
      last_attempt_at: transitionAt,
      updated_by: callerId,
      updated_at: transitionAt,
    };
    if (payloadMetaMissing) {
      transitionUpdate.payload_hash = built.payload_hash;
      transitionUpdate.payload_row_count = built.payload_row_count;
    }
    const { data: transitioned, error: transErr } = await adminClient
      .from("kpi_app_submission_outbox")
      .update(transitionUpdate)
      .eq("id", outboxId)
      .in("status", ["failed", "retry_pending"])
      .select("id");
    if (transErr) {
      return json(
        { request_id: requestId, ok: false, outbox_id: outboxId, error: transErr.message },
        cors,
        500,
      );
    }
    if (!transitioned || transitioned.length === 0) {
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          error: "Outbox no longer eligible for retry (concurrent change).",
        },
        cors,
        409,
      );
    }

    // ---- External retry call (after status=submitting) ----
    let connectorResult;
    try {
      connectorResult = await submitKpiAppPayload(built.payload, connectorConfig, {
        request_id: requestId,
      });

    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connector crashed";
      connectorResult = {
        ok: false,
        outcome: "transport_error" as const,
        elapsed_ms: 0,
        status: null,
        status_text: null,
        body: null,
        body_summary: null,
        error_message: msg.slice(0, 500),
        external_correlation_id: null,
        safe_endpoint_summary: { host: null, pathname: null },
      };
    }

    // ---- Compute next attempt_number (append-only audit) ----
    const { data: maxRow, error: maxErr } = await adminClient
      .from("kpi_app_submission_attempts")
      .select("attempt_number")
      .eq("outbox_id", outboxId)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxErr) {
      console.error("attempt_number lookup failed", maxErr.message);
    }
    const nextAttemptNumber =
      (maxRow && typeof maxRow.attempt_number === "number" ? maxRow.attempt_number : 0) + 1;

    const attemptedAt = new Date().toISOString();
    const attemptStatus = connectorResult.ok ? "submitted" : "failed";

    // ---- Insert exactly one attempt row (mandatory after external call) ----
    const { error: attemptErr } = await adminClient
      .from("kpi_app_submission_attempts")
      .insert({
        outbox_id: outboxId,
        attempt_number: nextAttemptNumber,
        attempted_by: callerId,
        attempted_at: attemptedAt,
        request_id: requestId,
        status: attemptStatus,
        elapsed_ms: connectorResult.elapsed_ms,
        http_status: connectorResult.status,
        upstream_status_text: connectorResult.status_text,
        upstream_body_summary: connectorResult.body_summary
          ? JSON.stringify(connectorResult.body_summary)
          : null,
        error_message: connectorResult.error_message,
        payload_row_count: built.payload_row_count,
        payload_hash: built.payload_hash,
        payload_summary: built.payload_summary,
        external_correlation_id: connectorResult.external_correlation_id,
      });
    if (attemptErr) {
      // External call already happened; audit row could not be persisted.
      const failedAt = new Date().toISOString();
      await adminClient
        .from("kpi_app_submission_outbox")
        .update({
          status: "failed",
          submitted_by: callerId,
          submitted_at: failedAt,
          last_attempt_at: failedAt,
          last_http_status: connectorResult.status,
          last_upstream_status_text: connectorResult.status_text,
          last_error_message:
            "Retry external call attempted but attempt audit insert failed; see server logs.",
          retry_count: previousRetryCount + 1,
          updated_by: callerId,
          updated_at: failedAt,
        })
        .eq("id", outboxId);
      console.error("attempt insert failed", attemptErr.message);
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          status: "failed",
          error:
            "Retry external call was attempted but attempt audit insert failed; outbox marked failed.",
        },
        cors,
        500,
      );
    }

    // ---- Update outbox result (increment retry_count for actual retry) ----
    const finishedAt = new Date().toISOString();
    const outboxUpdate: Record<string, unknown> = {
      status: connectorResult.ok ? "submitted" : "failed",
      submitted_by: callerId,
      submitted_at: finishedAt,
      last_attempt_at: finishedAt,
      last_http_status: connectorResult.status,
      last_upstream_status_text: connectorResult.status_text,
      last_upstream_body_summary: connectorResult.body_summary
        ? JSON.stringify(connectorResult.body_summary)
        : null,
      last_error_message: connectorResult.ok ? null : connectorResult.error_message,
      external_correlation_id: connectorResult.external_correlation_id,
      retry_count: previousRetryCount + 1,
      updated_by: callerId,
      updated_at: finishedAt,
    };

    const { error: outboxUpdErr } = await adminClient
      .from("kpi_app_submission_outbox")
      .update(outboxUpdate)
      .eq("id", outboxId);
    if (outboxUpdErr) {
      console.error("outbox retry result update failed", outboxUpdErr.message);
      return json(
        {
          request_id: requestId,
          ok: false,
          outbox_id: outboxId,
          status: "unknown",
          error:
            "Retry external call attempted and audited, but authoritative outbox update failed; manual reconciliation required.",
        },
        cors,
        500,
      );
    }

    // NOTE: kpi_app_mappings.last_* fields are intentionally NOT updated (advisory only).

    return json(
      {
        request_id: requestId,
        ok: connectorResult.ok,
        outbox_id: outboxId,
        status: connectorResult.ok ? "submitted" : "failed",
        retry_count: previousRetryCount + 1,
        elapsed_ms: connectorResult.elapsed_ms,
        upstream: {
          status: connectorResult.status,
          status_text: connectorResult.status_text,
          body: connectorResult.body_summary, // never the full body
        },
        payload_summary: built.payload_summary,
        payload_hash: built.payload_hash,
        payload_row_count: built.payload_row_count,
        ...(connectorResult.ok
          ? {}
          : (() => {
              let code = "UPSTREAM_REQUEST_FAILED";
              let message = "Submission failed upstream. No automatic retry was run.";
              if (connectorResult.outcome === "transport_error") {
                code = "UPSTREAM_TRANSPORT_ERROR";
                message = "Could not reach the KPI App. Submission was not delivered.";
              } else if (connectorResult.status === 404) {
                code = "KPI_API_ENDPOINT_NOT_FOUND";
                message =
                  "Upstream endpoint returned 404 Not Found. Check the MuleSoft KPI Tenant integration API URL.";
              } else if (connectorResult.status === 401 || connectorResult.status === 403) {
                code = "KPI_API_AUTH_FAILED";
                message =
                  "The upstream service rejected the configured MuleSoft KPI credentials.";
              }
              return {
                error: message,
                code,
                safe_endpoint_summary: connectorResult.safe_endpoint_summary,
              };
            })()),
      },
      cors,
      200,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return json({ request_id: requestId, ok: false, error: msg }, cors, 500);
  }
});
