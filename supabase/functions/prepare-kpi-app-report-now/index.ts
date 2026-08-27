// BTPM — Wave C2, Step C2.9a
// Manual Report Now — backend outbox preparation (preview / create only).
//
// Responsibilities:
//   - Authenticated POST.
//   - Caller must be Org Admin or Workspace Admin-or-higher for the mapping
//     workspace (verified by SECURITY DEFINER RPCs).
//   - Accepts only:
//       { mapping_id, reporting_period_start, reporting_period_end,
//         validity_date, action: "preview" | "create" }
//   - "preview": validates mapping + selects an official kpi_snapshots row
//     (with carry-forward when allowed). NO writes.
//   - "create": same validation + selection, then creates exactly one
//     non-cancelled outbox row per (organization_id, mapping_id,
//     reporting_period_start, reporting_period_end), or reuses an existing
//     queued / payload_ready row.
//
// Hard rules (C2.9a):
//   - kpi_snapshots is the only source. kpi_updates is NOT read.
//   - KPI calculation engine is NOT called.
//   - schedule_signal is rejected.
//   - No build-kpi-app-payload call. No submit-kpi-app-payload call.
//   - No insert into kpi_app_submission_attempts.
//   - No MuleSoft secrets read. No external HTTP call.
//   - No full payload body stored.
//   - Sensitive snapshot text/comment/action_plan values are NEVER returned;
//     only *_present booleans.
//   - Sensitive source fields are written to the outbox via service-role
//     and encrypted in-place by the existing C2.4 trigger (no pre-encryption).
//   - kpi_app_mappings.last_* fields are NOT updated (advisory only).

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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type SelectionResult = {
  reportable: boolean;
  reason?: string;
  carry_forward_used?: boolean;
  carry_forward_allowed?: boolean;
  mapping?: {
    id: string;
    organization_id: string;
    workspace_id: string;
    project_id: string;
    kpi_definition_id: string;
    external_kpi_id: number;
    scenario_id: number;
    currency_id: number;
    reporting_frequency: string;
    is_active: boolean;
    carry_forward_allowed: boolean;
  };
  external_kpi?: {
    external_kpi_id: number;
    external_kpi_name: string;
    value_type: string;
  };
  snapshot?: {
    id: string;
    period_start: string;
    period_end: string;
    value_type: "percent" | "number" | "currency" | "text";
    value_amount: number | null;
    text_value_present: boolean;
    comment_present: boolean;
    action_plan_present: boolean;
  };
};

const BLOCKING_REUSE_STATUSES = new Set([
  "submitting",
  "submitted",
  "failed",
  "retry_pending",
  "skipped",
]);
const REUSABLE_STATUSES = new Set(["queued", "payload_ready"]);

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

    // ---- Strict body allow-list ----
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return json({ request_id: requestId, ok: false, error: "Invalid request body" }, cors, 400);
    }
    const ALLOWED_KEYS = new Set([
      "mapping_id",
      "reporting_period_start",
      "reporting_period_end",
      "validity_date",
      "action",
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
    const mappingId = b.mapping_id;
    const periodStart = b.reporting_period_start;
    const periodEnd = b.reporting_period_end;
    const validityDate = b.validity_date;
    const action = b.action;

    if (typeof mappingId !== "string" || !UUID_RE.test(mappingId)) {
      return json({ request_id: requestId, ok: false, error: "Invalid mapping_id" }, cors, 400);
    }
    if (!isValidIsoDate(periodStart) || !isValidIsoDate(periodEnd) || !isValidIsoDate(validityDate)) {
      return json({ request_id: requestId, ok: false, error: "Invalid date(s)" }, cors, 400);
    }
    if ((periodEnd as string) < (periodStart as string)) {
      return json(
        { request_id: requestId, ok: false, error: "reporting_period_end < reporting_period_start" },
        cors,
        400,
      );
    }
    if (action !== "preview" && action !== "create") {
      return json({ request_id: requestId, ok: false, error: "Invalid action" }, cors, 400);
    }

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ request_id: requestId, ok: false, error: "Unauthorized" }, cors, 401);
    }
    const callerId = userData.user.id;

    // ---- Mapping admin gate (RAISES on missing/denied) ----
    const { error: gateErr } = await userClient.rpc("get_kpi_app_mapping_admin", {
      _mapping_id: mappingId,
    });
    if (gateErr) {
      const msg = (gateErr.message || "").toLowerCase();
      const status = msg.includes("not found")
        ? 404
        : msg.includes("access denied")
        ? 403
        : 400;
      return json(
        { request_id: requestId, ok: false, error: gateErr.message || "Access denied" },
        cors,
        status,
      );
    }

    // ---- Snapshot selection (admin-gated, returns NON-sensitive metadata) ----
    const { data: selRaw, error: selErr } = await userClient.rpc(
      "prepare_kpi_app_report_now_select",
      {
        _mapping_id: mappingId,
        _reporting_period_start: periodStart,
        _reporting_period_end: periodEnd,
      },
    );
    if (selErr) {
      return json(
        { request_id: requestId, ok: false, error: selErr.message || "Selection failed" },
        cors,
        400,
      );
    }
    const sel = (selRaw ?? {}) as SelectionResult;

    // ---- Not reportable: HTTP 200, ok=true, reportable=false ----
    if (!sel.reportable) {
      return json(
        {
          request_id: requestId,
          ok: true,
          action,
          mapping_id: mappingId,
          reportable: false,
          reason: sel.reason ?? "not_reportable",
          carry_forward_allowed: sel.carry_forward_allowed ?? null,
          reporting_period_start: periodStart,
          reporting_period_end: periodEnd,
        },
        cors,
        200,
      );
    }

    if (!sel.mapping || !sel.snapshot) {
      return json(
        { request_id: requestId, ok: false, error: "Selection result malformed" },
        cors,
        500,
      );
    }

    // ---- Preview: no writes ----
    if (action === "preview") {
      return json(
        {
          request_id: requestId,
          ok: true,
          action: "preview",
          mapping_id: mappingId,
          reportable: true,
          carry_forward_used: !!sel.carry_forward_used,
          reporting_period_start: periodStart,
          reporting_period_end: periodEnd,
          validity_date: validityDate,
          source_snapshot_id: sel.snapshot.id,
          source_snapshot_period_start: sel.snapshot.period_start,
          source_snapshot_period_end: sel.snapshot.period_end,
          source_value_type: sel.snapshot.value_type,
          source_value_amount:
            sel.snapshot.value_type === "text" ? null : sel.snapshot.value_amount,
          text_value_present: sel.snapshot.text_value_present,
          comment_present: sel.snapshot.comment_present,
          action_plan_present: sel.snapshot.action_plan_present,
          external_kpi_id: sel.external_kpi?.external_kpi_id ?? null,
          external_kpi_name: sel.external_kpi?.external_kpi_name ?? null,
          scenario_id: sel.mapping.scenario_id,
          currency_id: sel.mapping.currency_id,
        },
        cors,
        200,
      );
    }

    // ---- Create action: service-role writes only after admin gate ----
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Check existing non-cancelled, non-superseded outbox for the same period.
    // Rows superseded via reset_kpi_app_outbox (C2-FIX.1) are intentionally
    // ignored so a new Report Now attempt can proceed.
    const { data: existing, error: existErr } = await adminClient
      .from("kpi_app_submission_outbox")
      .select("id, status, superseded_at")
      .eq("organization_id", sel.mapping.organization_id)
      .eq("mapping_id", sel.mapping.id)
      .eq("reporting_period_start", periodStart)
      .eq("reporting_period_end", periodEnd)
      .neq("status", "cancelled")
      .is("superseded_at", null)
      .limit(1)
      .maybeSingle();

    if (existErr) {
      return json(
        { request_id: requestId, ok: false, error: existErr.message },
        cors,
        500,
      );
    }

    if (existing) {
      if (BLOCKING_REUSE_STATUSES.has(existing.status)) {
        const isSubmitted = existing.status === "submitted";
        const isInFlight = existing.status === "submitting";
        const isFailed =
          existing.status === "failed" || existing.status === "retry_pending";
        const code = isSubmitted
          ? "PERIOD_ALREADY_SUBMITTED"
          : isInFlight
          ? "OUTBOX_IN_PROGRESS"
          : "OUTBOX_NOT_REUSABLE";
        const message = isSubmitted
          ? "This period was already submitted. Duplicate submission is blocked."
          : isInFlight
          ? "A submission is already in progress for this mapping and period."
          : "A previous attempt is blocking this mapping. Reset it from the mapping row to create a new Report Now attempt.";
        // C2-FIX.2: return HTTP 200 with ok:false for expected lifecycle
        // blocks so the platform runtime overlay does not fire on what is a
        // controlled business-rule outcome. The frontend hook + dialog read
        // `code` and render the friendly message inline.
        return json(
          {
            request_id: requestId,
            ok: false,
            code,
            mapping_id: mappingId,
            outbox_id: existing.id,
            latest_status: existing.status,
            status: existing.status,
            can_reset: !isSubmitted,
            can_retry: isFailed,
            action_available: isSubmitted ? null : isFailed ? "retry" : "reset",
            error: message,
          },
          cors,
          200,
        );
      }
      if (REUSABLE_STATUSES.has(existing.status)) {
        return json(
          {
            request_id: requestId,
            ok: true,
            action: "create",
            outbox_id: existing.id,
            reused_existing_outbox: true,
            status: existing.status,
            mapping_id: mappingId,
            source_snapshot_id: sel.snapshot.id,
            carry_forward_used: !!sel.carry_forward_used,
            reporting_period_start: periodStart,
            reporting_period_end: periodEnd,
            validity_date: validityDate,
            source_snapshot_period_start: sel.snapshot.period_start,
            source_snapshot_period_end: sel.snapshot.period_end,
            next_step: "run build-kpi-app-payload prepare before submit",
          },
          cors,
          200,
        );
      }
      // Unknown status: treat as block. C2-FIX.2 returns HTTP 200 with
      // ok:false so the platform runtime overlay does not fire on a
      // controlled lifecycle outcome.
      return json(
        {
          request_id: requestId,
          ok: false,
          code: "OUTBOX_NOT_REUSABLE",
          mapping_id: mappingId,
          outbox_id: existing.id,
          latest_status: existing.status,
          status: existing.status,
          can_reset: true,
          can_retry: false,
          action_available: "reset",
          error: "Existing outbox in an unrecognized state.",
        },
        cors,
        200,
      );
    }

    // Fetch decrypted snapshot text fields via an admin-gated SECURITY DEFINER
    // RPC that re-validates snapshot/mapping scope server-side. We use the
    // user-scoped client so the RPC's auth.uid() reflects the caller; its own
    // admin gate enforces authority. No raw ciphertext or btpm_decrypt is
    // called from the Edge Function.
    const { data: decRaw, error: decErr } = await userClient.rpc(
      "get_kpi_snapshot_decrypted_for_mapping",
      { _mapping_id: mappingId, _snapshot_id: sel.snapshot.id },
    );
    if (decErr || !decRaw) {
      const msg = decErr?.message || "Decrypted snapshot read failed";
      const lower = msg.toLowerCase();
      const status = lower.includes("access denied")
        ? 403
        : lower.includes("not found") || lower.includes("scope mismatch")
        ? 409
        : 500;
      return json({ request_id: requestId, ok: false, error: msg }, cors, status);
    }
    const dec = decRaw as {
      string_value: string | null;
      comment: string | null;
      action_plan: string | null;
    };
    const plainStringValue = dec.string_value;
    const plainComment = dec.comment;
    const plainActionPlan = dec.action_plan;

    const valueType = sel.snapshot.value_type;
    const isText = valueType === "text";

    // Insert the outbox row. The C2.4 BEFORE INSERT trigger will encrypt
    // source_string_value / source_comment / source_action_plan in place.
    const nowIso = new Date().toISOString();
    const insertRow = {
      organization_id: sel.mapping.organization_id,
      workspace_id: sel.mapping.workspace_id,
      project_id: sel.mapping.project_id,
      mapping_id: sel.mapping.id,
      kpi_definition_id: sel.mapping.kpi_definition_id,
      source_snapshot_id: sel.snapshot.id,
      reporting_period_start: periodStart,
      reporting_period_end: periodEnd,
      validity_date: validityDate,
      source_snapshot_period_start: sel.snapshot.period_start,
      source_snapshot_period_end: sel.snapshot.period_end,
      source_value_type: valueType,
      source_value_amount: isText ? null : sel.snapshot.value_amount,
      source_string_value: isText ? plainStringValue : null,
      source_comment: plainComment,
      source_action_plan: plainActionPlan,
      submission_mode: "manual",
      status: "queued",
      carry_forward_used: !!sel.carry_forward_used,
      retry_count: 0,
      payload_row_count: null,
      payload_hash: null,
      payload_summary: null,
      submitted_by: null,
      submitted_at: null,
      created_by: callerId,
      updated_by: callerId,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data: inserted, error: insErr } = await adminClient
      .from("kpi_app_submission_outbox")
      .insert(insertRow)
      .select("id, status")
      .single();

    if (insErr || !inserted) {
      // C2-FIX.2: detect duplicate-unique-violation specifically.
      // The active-period unique index excludes superseded rows, so a
      // unique violation here either means a real race condition (another
      // caller created a queued/payload_ready row) or that the index is
      // out of sync with the supersede contract.
      const errCode = (insErr as unknown as { code?: string })?.code;
      const errMsg = insErr?.message || "";
      const isUniqueViolation =
        errCode === "23505" ||
        /duplicate key value/i.test(errMsg) ||
        /kpi_app_outbox_active_period_uniq/i.test(errMsg);

      if (isUniqueViolation) {
        const { data: raceRow } = await adminClient
          .from("kpi_app_submission_outbox")
          .select("id, status")
          .eq("organization_id", sel.mapping.organization_id)
          .eq("mapping_id", sel.mapping.id)
          .eq("reporting_period_start", periodStart)
          .eq("reporting_period_end", periodEnd)
          .neq("status", "cancelled")
          .is("superseded_at", null)
          .maybeSingle();
        if (raceRow && REUSABLE_STATUSES.has(raceRow.status)) {
          return json(
            {
              request_id: requestId,
              ok: true,
              action: "create",
              outbox_id: raceRow.id,
              reused_existing_outbox: true,
              status: raceRow.status,
              mapping_id: mappingId,
              source_snapshot_id: sel.snapshot.id,
              carry_forward_used: !!sel.carry_forward_used,
              reporting_period_start: periodStart,
              reporting_period_end: periodEnd,
              validity_date: validityDate,
              source_snapshot_period_start: sel.snapshot.period_start,
              source_snapshot_period_end: sel.snapshot.period_end,
              next_step: "run build-kpi-app-payload prepare before submit",
            },
            cors,
            200,
          );
        }
        if (raceRow) {
          const isSubmitted = raceRow.status === "submitted";
          const isInFlight = raceRow.status === "submitting";
          const isFailed =
            raceRow.status === "failed" || raceRow.status === "retry_pending";
          const code = isSubmitted
            ? "PERIOD_ALREADY_SUBMITTED"
            : isInFlight
            ? "OUTBOX_IN_PROGRESS"
            : "OUTBOX_BLOCKING_ATTEMPT";
          return json(
            {
              request_id: requestId,
              ok: false,
              code,
              mapping_id: mappingId,
              outbox_id: raceRow.id,
              latest_status: raceRow.status,
              status: raceRow.status,
              can_reset: !isSubmitted,
              can_retry: isFailed,
              action_available: isSubmitted
                ? null
                : isFailed
                ? "retry"
                : "reset",
              error:
                isSubmitted
                  ? "This period was already submitted. Duplicate submission is blocked."
                  : isInFlight
                  ? "A submission is already in progress for this mapping and period."
                  : "A previous attempt is blocking this mapping. Reset it from the mapping row to create a new Report Now attempt.",
            },
            cors,
            200,
          );
        }
        // Unique violation but no active non-superseded row found =>
        // index predicate is out of sync with the supersede contract.
        return json(
          {
            request_id: requestId,
            ok: false,
            code: "OUTBOX_UNIQUE_INDEX_MISMATCH",
            mapping_id: mappingId,
            error:
              "Outbox unique index blocked creation but no active non-superseded row was found. Verify the active-period unique index excludes superseded rows.",
          },
          cors,
          200,
        );
      }
      return json(
        { request_id: requestId, ok: false, error: insErr?.message || "Insert failed" },
        cors,
        500,
      );
    }

    return json(
      {
        request_id: requestId,
        ok: true,
        action: "create",
        outbox_id: inserted.id,
        reused_existing_outbox: false,
        status: inserted.status,
        mapping_id: mappingId,
        source_snapshot_id: sel.snapshot.id,
        carry_forward_used: !!sel.carry_forward_used,
        reporting_period_start: periodStart,
        reporting_period_end: periodEnd,
        validity_date: validityDate,
        source_snapshot_period_start: sel.snapshot.period_start,
        source_snapshot_period_end: sel.snapshot.period_end,
        next_step: "run build-kpi-app-payload prepare before submit",
      },
      cors,
      200,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return json({ request_id: requestId, ok: false, error: msg }, cors, 500);
  }
});
