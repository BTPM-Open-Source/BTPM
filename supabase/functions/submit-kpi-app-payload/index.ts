// BTPM — Wave C2, Step C2.6 (refactored under C2.11d)
// Production MuleSoft KPI App connector (submit-only) — human admin path.
//
// Authentication and authorization are unchanged: this Edge Function still
// requires `auth.getUser()` plus the existing `get_kpi_app_outbox_admin`
// SECURITY DEFINER admin gate. After both gates pass, the actual submission
// lifecycle is delegated to the shared `submitOutboxCore` helper so there
// is exactly ONE submission lifecycle implementation across:
//   - this function (manual / Report Now / Retry callers)
//   - run-kpi-app-scheduler (system-mode, after the scheduler-secret gate)
//
// Hard rules (unchanged):
//   - Service-role write only AFTER admin permission gate.
//   - Does NOT store the full payload body anywhere.
//   - Does NOT log credentials, Authorization header, decrypted comment /
//     action_plan / string_value, or full upstream body.
//   - Does NOT increment retry_count (C2.10).
//   - Does NOT update kpi_app_mappings.last_* fields (advisory only).
//   - schedule_signal stays non-submittable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import type { PayloadSourceBundle } from "../_shared/kpi-app-payload-builder.ts";
import { submitOutboxCore } from "../_shared/kpi-app-submit-service.ts";
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

    // ---- Permission gate (admin RPC) ----
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

    // ---- Decrypted source bundle (admin-gated, human path uses the RPC) ----
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
    const bundle = bundleRaw as PayloadSourceBundle;

    // ---- Service-role client (only used after admin gate) ----
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---- Delegate the entire submission lifecycle to the shared helper ----
    const result = await submitOutboxCore({
      adminClient,
      bundle,
      actorId: callerId,
      requestId,
      auditFunctionName: "submit-kpi-app-payload",
      auditReason: "kpi-app-submit",
    });

    // Preserve the C2.6 public response shape exactly.
    if (result.ok) {
      return json(
        {
          request_id: result.request_id,
          ok: true,
          outbox_id: result.outbox_id,
          status: result.status,
          elapsed_ms: result.elapsed_ms,
          upstream: result.upstream,
          payload_summary: result.payload_summary,
          payload_hash: result.payload_hash,
          payload_row_count: result.payload_row_count,
        },
        cors,
        result.http_status,
      );
    }

    const errorBody: Record<string, unknown> = {
      request_id: result.request_id,
      ok: false,
      outbox_id: result.outbox_id,
      status: result.status,
    };
    if (result.error) errorBody.error = result.error;
    if (result.errors) errorBody.errors = result.errors;
    if (result.elapsed_ms !== undefined) errorBody.elapsed_ms = result.elapsed_ms;
    if (result.upstream) errorBody.upstream = result.upstream;
    if (result.payload_summary !== undefined) errorBody.payload_summary = result.payload_summary;
    if (result.payload_hash !== undefined) errorBody.payload_hash = result.payload_hash;
    if (result.payload_row_count !== undefined) errorBody.payload_row_count = result.payload_row_count;
    if (result.code !== undefined) errorBody.code = result.code;
    if (result.safe_endpoint_summary !== undefined) errorBody.safe_endpoint_summary = result.safe_endpoint_summary;
    return json(errorBody, cors, result.http_status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return json({ request_id: requestId, ok: false, error: msg }, cors, 500);
  }
});
