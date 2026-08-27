// BTPM — Wave C2, Step C2.11d
// Shared internal SUBMIT helper.
//
// Extracted from supabase/functions/submit-kpi-app-payload/index.ts so the
// EXACT same submission lifecycle is reused by:
//   - the public submit-kpi-app-payload Edge Function (human admin path),
//   - the run-kpi-app-scheduler system-mode path (post-secret-gate).
//
// There is NO second MuleSoft connector and NO second payload builder.
// The payload is rebuilt via the canonical C2.5/C2.5a `buildKpiAppPayload`
// and submitted via the canonical C2.6 `submitKpiAppPayload` MuleSoft
// client. This helper does NOT increment retry_count and does NOT update
// kpi_app_mappings.last_*.
//
// Hard rules upheld (C2.6):
//   - Service-role write is the caller's responsibility — this helper
//     accepts an admin Supabase client and uses it for all writes.
//   - Eligibility = outbox.status === "payload_ready". Anything else
//     returns { ok:false, http_status: 409, ... } with no external call.
//   - Rebuilt payload_hash + payload_row_count must match persisted
//     metadata. Mismatch => 409, no external call.
//   - Conditional payload_ready -> submitting transition for concurrency.
//   - Exactly one append-only kpi_app_submission_attempts row inserted
//     ONLY after an external call is actually attempted.
//   - Outbox is updated to submitted (ok) or failed (not ok).
//   - Full payload body is never persisted (only payload_hash +
//     payload_summary + non-sensitive body_summary).
//   - No credentials, Authorization, decrypted source text, or full
//     upstream body are logged or returned.
//   - actorId === null is permitted for system-mode invocations; in that
//     case submitted_by / attempted_by / updated_by are written as NULL.
//     This is the documented C2.11d audit convention for non-human
//     scheduled writes.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildKpiAppPayload,
  type PayloadSourceBundle,
} from "./kpi-app-payload-builder.ts";
import { submitKpiAppPayload } from "./kpi-app-mulesoft-client.ts";
import {
  resolveTenantMulesoftKpiRuntimeConfig,
  toSafeMulesoftKpiPublicError,
} from "./tenantMulesoftKpi.ts";


export interface SubmitCoreResult {
  ok: boolean;
  http_status: number;
  outbox_id: string;
  status: "submitted" | "failed" | "unknown" | string;
  request_id: string;
  elapsed_ms?: number;
  upstream?: {
    status: number | null;
    status_text: string | null;
    body: unknown; // body_summary only — never the full body
  };
  payload_summary?: unknown;
  payload_hash?: string;
  payload_row_count?: number;
  error?: string;
  errors?: string[];
  /** C2-FIX.1: machine-readable error code for the UI (e.g. KPI_API_ENDPOINT_NOT_FOUND). */
  code?: string;
  /** C2-FIX.1: host + pathname only — no credential, no header, no query. */
  safe_endpoint_summary?: { host: string | null; pathname: string | null };
}

export interface SubmitCoreInput {
  adminClient: SupabaseClient;
  bundle: PayloadSourceBundle;
  /** Human caller user id, or null for system-mode (scheduler) writes. */
  actorId: string | null;
  /** Pre-generated request id used both for the MuleSoft helper correlation
   *  and for the kpi_app_submission_attempts.request_id column. */
  requestId: string;
  /** Server-controlled audit attribution — MUST NOT be sourced from a
   *  browser request body. Distinguishes manual vs scheduler secret-access
   *  audit rows written by the Vault value resolver. */
  auditFunctionName: "submit-kpi-app-payload" | "run-kpi-app-scheduler";
  auditReason: "kpi-app-submit" | "kpi-app-scheduler-submit";
}

/**
 * Submit one outbox row through the existing MuleSoft connector. This is
 * the single source of truth for the submission lifecycle. Both the
 * public manual function and the scheduler system-mode path delegate to
 * this helper after their respective authority gates pass.
 */
export async function submitOutboxCore(
  input: SubmitCoreInput,
): Promise<SubmitCoreResult> {
  const { adminClient, bundle, actorId, requestId, auditFunctionName, auditReason } = input;
  const outboxId = bundle.outbox.id;

  // ---- Eligibility: must be payload_ready ----
  if (bundle.outbox.status !== "payload_ready") {
    return {
      ok: false,
      http_status: 409,
      outbox_id: outboxId,
      status: bundle.outbox.status,
      request_id: requestId,
      error: `Outbox status '${bundle.outbox.status}' not eligible for submit`,
    };
  }

  // ---- Pull persisted payload metadata to compare hash + row count ----
  // C2-FIX.4: also fetch superseded_at to enforce a hard submit guard:
  // a superseded outbox row MUST NEVER be submitted externally, even if
  // an earlier caller passed validation. This protects against the
  // observed case where a previously-superseded row was later mutated
  // to 'submitted'.
  const { data: outboxMeta, error: metaErr } = await adminClient
    .from("kpi_app_submission_outbox")
    .select("id, status, payload_hash, payload_row_count, superseded_at")
    .eq("id", outboxId)
    .maybeSingle();
  if (metaErr || !outboxMeta) {
    return {
      ok: false,
      http_status: 404,
      outbox_id: outboxId,
      status: "unknown",
      request_id: requestId,
      error: metaErr?.message || "Outbox not found",
    };
  }
  if (outboxMeta.superseded_at) {
    return {
      ok: false,
      http_status: 409,
      outbox_id: outboxId,
      status: outboxMeta.status as string,
      request_id: requestId,
      code: "OUTBOX_SUPERSEDED_NOT_SUBMITTABLE",
      error: "This outbox attempt was reset/superseded and cannot be submitted.",
    };
  }
  if (!outboxMeta.payload_hash || outboxMeta.payload_row_count == null) {
    return {
      ok: false,
      http_status: 409,
      outbox_id: outboxId,
      status: outboxMeta.status as string,
      request_id: requestId,
      error: "Payload metadata missing; run prepare first.",
    };
  }

  // ---- Rebuild payload via C2.5 shared builder (no reimplementation) ----
  let built;
  try {
    built = await buildKpiAppPayload(bundle);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Builder failed";
    return {
      ok: false,
      http_status: 422,
      outbox_id: outboxId,
      status: bundle.outbox.status,
      request_id: requestId,
      errors: [msg],
    };
  }

  if (
    built.payload_hash !== outboxMeta.payload_hash ||
    built.payload_row_count !== outboxMeta.payload_row_count
  ) {
    return {
      ok: false,
      http_status: 409,
      outbox_id: outboxId,
      status: outboxMeta.status as string,
      request_id: requestId,
      error: "Payload metadata is stale; run prepare again.",
    };
  }

  // ---- Resolve MuleSoft KPI runtime configuration BEFORE the outbox
  //      transitions to `submitting` and BEFORE we insert an attempt row.
  //      A configuration failure here MUST NOT change the outbox status
  //      and MUST NOT create an attempt audit row. There is no Global
  //      env-secret fallback.
  let connectorConfig;
  try {
    connectorConfig = await resolveTenantMulesoftKpiRuntimeConfig({
      organizationId: bundle.outbox.organization_id,
      action: "external_api_write",
      reason: auditReason,
      functionName: auditFunctionName,
      requestId,
    });
  } catch (e) {
    const safe = toSafeMulesoftKpiPublicError(e);
    return {
      ok: false,
      http_status: 200, // controlled failure — no upstream call made
      outbox_id: outboxId,
      status: bundle.outbox.status,
      request_id: requestId,
      code: safe.code,
      error: safe.message,
    };
  }

  // ---- Concurrency: conditional payload_ready -> submitting ----
  const transitionAt = new Date().toISOString();
  const { data: transitioned, error: transErr } = await adminClient
    .from("kpi_app_submission_outbox")
    .update({
      status: "submitting",
      last_attempt_at: transitionAt,
      updated_by: actorId,
      updated_at: transitionAt,
    })
    .eq("id", outboxId)
    .eq("status", "payload_ready")
    .is("superseded_at", null)
    .select("id");
  if (transErr) {
    return {
      ok: false,
      http_status: 500,
      outbox_id: outboxId,
      status: "unknown",
      request_id: requestId,
      error: transErr.message,
    };
  }
  if (!transitioned || transitioned.length === 0) {
    return {
      ok: false,
      http_status: 409,
      outbox_id: outboxId,
      status: "unknown",
      request_id: requestId,
      error: "Outbox no longer eligible (concurrent change).",
    };
  }

  // ---- External call (after status=submitting) ----
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

  // ---- Insert exactly one attempt row ----
  const { error: attemptErr } = await adminClient
    .from("kpi_app_submission_attempts")
    .insert({
      outbox_id: outboxId,
      attempt_number: nextAttemptNumber,
      attempted_by: actorId,
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
    const failedAt = new Date().toISOString();
    await adminClient
      .from("kpi_app_submission_outbox")
      .update({
        status: "failed",
        submitted_by: actorId,
        submitted_at: failedAt,
        last_attempt_at: failedAt,
        last_http_status: connectorResult.status,
        last_upstream_status_text: connectorResult.status_text,
        last_error_message:
          "External call attempted but attempt audit insert failed; see server logs.",
        updated_by: actorId,
        updated_at: failedAt,
      })
      .eq("id", outboxId);
    console.error("attempt insert failed", attemptErr.message);
    return {
      ok: false,
      http_status: 500,
      outbox_id: outboxId,
      status: "failed",
      request_id: requestId,
      error:
        "External call was attempted but attempt audit insert failed; outbox marked failed.",
    };
  }

  // ---- Update outbox result ----
  const finishedAt = new Date().toISOString();
  const outboxUpdate: Record<string, unknown> = {
    status: connectorResult.ok ? "submitted" : "failed",
    submitted_by: actorId,
    submitted_at: finishedAt,
    last_attempt_at: finishedAt,
    last_http_status: connectorResult.status,
    last_upstream_status_text: connectorResult.status_text,
    last_upstream_body_summary: connectorResult.body_summary
      ? JSON.stringify(connectorResult.body_summary)
      : null,
    last_error_message: connectorResult.ok ? null : connectorResult.error_message,
    external_correlation_id: connectorResult.external_correlation_id,
    updated_by: actorId,
    updated_at: finishedAt,
  };

  const { error: outboxUpdErr } = await adminClient
    .from("kpi_app_submission_outbox")
    .update(outboxUpdate)
    .eq("id", outboxId);
  if (outboxUpdErr) {
    console.error("outbox result update failed", outboxUpdErr.message);
    return {
      ok: false,
      http_status: 500,
      outbox_id: outboxId,
      status: "unknown",
      request_id: requestId,
      error:
        "External call attempted and audited, but authoritative outbox update failed; manual reconciliation required.",
    };
  }

  // Machine-readable code + safe endpoint summary on upstream failure.
  let failureCode: string | undefined;
  let failureMessage = "Upstream request failed";
  if (!connectorResult.ok) {
    if (connectorResult.outcome === "transport_error") {
      failureCode = "UPSTREAM_TRANSPORT_ERROR";
      failureMessage =
        "Could not reach the KPI App. Submission was not delivered.";
    } else if (connectorResult.status === 404) {
      failureCode = "KPI_API_ENDPOINT_NOT_FOUND";
      failureMessage =
        "The KPI API endpoint returned 404 Not Found. Check the MuleSoft KPI Tenant integration API URL.";
    } else if (connectorResult.status === 401 || connectorResult.status === 403) {
      failureCode = "KPI_API_AUTH_FAILED";
      failureMessage =
        "The upstream service rejected the configured MuleSoft KPI credentials.";
    } else {
      failureCode = "UPSTREAM_REQUEST_FAILED";
      failureMessage = "Submission failed upstream. No automatic retry was run.";
    }
  }


  // C2-FIX.3: Expected upstream failures (HTTP errors from MuleSoft, transport
  // failures) are controlled outcomes — return HTTP 200 with ok:false so the
  // Lovable runtime overlay does not fire. The outbox row is already marked
  // failed above and the modal renders the inline failure from the JSON body.
  return {
    ok: connectorResult.ok,
    http_status: 200,
    outbox_id: outboxId,
    status: connectorResult.ok ? "submitted" : "failed",
    request_id: requestId,
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
      : {
          error: failureMessage,
          message: failureMessage,
          code: failureCode,
          safe_endpoint_summary: connectorResult.safe_endpoint_summary,
        }),
  };
}
