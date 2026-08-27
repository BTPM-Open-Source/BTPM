// BTPM — Wave C2, Step C2.5
// Build-only protected backend function.
//
// Responsibilities:
//   - Authenticated POST.
//   - Caller must be Org Admin or Workspace Admin or higher for the
//     outbox row's workspace (verified by the SECURITY DEFINER RPCs).
//   - Accepts only { outbox_id, action } in body. Rejects any other fields.
//   - action = "dry_run": builds payload in memory and returns it.
//   - action = "prepare": builds payload in memory and updates ONLY the
//     same outbox row's payload metadata (status, payload_row_count,
//     payload_hash, payload_summary, updated_by, updated_at).
//
// Hard rules (C2.5):
//   - No external fetch, no MuleSoft credentials/endpoints used.
//   - No insert into kpi_app_submission_attempts.
//   - No update to kpi_app_mappings.last_* fields.
//   - No write to kpi_snapshots, kpi_updates, kpi_definitions.
//   - Full payload body is never persisted in DB.
//   - schedule_signal cannot be bypassed (outbox validator already blocks
//     it; builder also defends in depth).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { buildBrowserCorsHeaders } from "../_shared/browserCors.ts";
import {
  buildKpiAppPayload,
  type PayloadSourceBundle,
} from "../_shared/kpi-app-payload-builder.ts";
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

const PREPARE_ALLOWED_STATUSES = new Set(["queued", "payload_ready"]);

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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Caller-scoped client to authenticate the user and run admin-gated RPCs.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, cors);
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return json({ request_id: requestId, ok: false, error: "Invalid request body" }, cors, 400);
    }
    // Strict allow-list: only outbox_id and action are accepted. Any other
    // top-level field is rejected to make C2.5's "no arbitrary client payload
    // rows" rule structurally enforced.
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
    if (action !== "dry_run" && action !== "prepare") {
      return json({ request_id: requestId, ok: false, error: "Invalid action" }, cors, 400);
    }

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ request_id: requestId, ok: false, error: "Unauthorized" }, cors, 401);
    }
    const callerId = userData.user.id;

    // 2) Permission gate via lightweight admin lookup. Throws on access denial.
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

    // 3) Pull the decrypted payload-source bundle (admin-gated again inside).
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

    // 4) Status gate: only queued / payload_ready may be prepared in C2.5.
    const currentStatus = bundle.outbox.status;
    if (action === "prepare" && !PREPARE_ALLOWED_STATUSES.has(currentStatus)) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: `Outbox status '${currentStatus}' not eligible for prepare`,
        },
        cors,
        409,
      );
    }

    // 5) Build the payload (pure, in-memory).
    let built;
    try {
      built = await buildKpiAppPayload(bundle);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Builder failed";
      return json({ request_id: requestId, ok: false, action, outbox_id: outboxId, errors: [msg] }, cors, 422);
    }

    // 6) dry_run: return payload + summary, never write.
    if (action === "dry_run") {
      return json(
        {
          request_id: requestId,
          ok: true,
          action,
          outbox_id: outboxId,
          payload: built.payload,
          payload_summary: built.payload_summary,
          payload_hash: built.payload_hash,
          payload_row_count: built.payload_row_count,
          carry_forward_used: built.carry_forward_used,
        },
        cors,
        200,
      );
    }

    // 7) prepare: update only payload metadata on the same outbox row.
    //    Service-role write is used ONLY after the admin permission gate above.
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: updErr } = await adminClient
      .from("kpi_app_submission_outbox")
      .update({
        status: "payload_ready",
        payload_row_count: built.payload_row_count,
        payload_hash: built.payload_hash,
        payload_summary: built.payload_summary,
        updated_by: callerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);

    if (updErr) {
      return json(
        { request_id: requestId, ok: false, action, outbox_id: outboxId, errors: [updErr.message] },
        cors,
        500,
      );
    }

    return json(
      {
        request_id: requestId,
        ok: true,
        action,
        outbox_id: outboxId,
        payload_summary: built.payload_summary,
        payload_hash: built.payload_hash,
        payload_row_count: built.payload_row_count,
        carry_forward_used: built.carry_forward_used,
      },
      cors,
      200,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return json({ request_id: requestId, ok: false, error: msg }, cors, 500);
  }
});
