// BTPM — Wave C2, Step C2.11e
// Shared internal helper: system-mode outbox create/reuse + payload prepare
// for the run-kpi-app-scheduler system path.
//
// Why this helper exists
// ----------------------
// C2.11d-prep made system-mode submit-only because the canonical C2.9a
// `prepare_kpi_app_report_now_select` and `get_kpi_snapshot_decrypted_for_mapping`
// RPCs are gated on `auth.uid()` and cannot be called from a service-role
// context with no human session. C2.11e adds two minimum SECURITY DEFINER
// RPC variants — `prepare_kpi_app_report_now_select_system` and
// `get_kpi_snapshot_decrypted_for_mapping_system` — that mirror the C2.9a
// rules without `auth.uid()` and are EXEC-revoked from PUBLIC/anon/authenticated
// (service_role only). This helper composes them with:
//   - the existing C2.4 BEFORE INSERT trigger (encrypts source text in place),
//   - the canonical C2.5 `buildKpiAppPayload` (no second builder),
//   - the canonical `loadPayloadSourceBundleSystem` (no parallel decryptor).
//
// Hard rules upheld:
//   - kpi_snapshots is the only source. kpi_updates is NOT read.
//   - KPI calculation engine is NOT called.
//   - schedule_signal / manual_only / inactive / auto_submit_enabled=false /
//     archived are rejected upstream by the system RPC.
//   - failed / retry_pending / submitting / submitted / skipped outbox rows
//     are NEVER mutated by this helper (caller classifies and skips).
//   - cancelled rows are ignored (the C2.4 partial unique index allows a new
//     non-cancelled row to coexist with cancelled history).
//   - System-mode writes use actorId === null (created_by / updated_by /
//     submitted_by left NULL — documented C2.11d audit convention).
//   - No update to kpi_app_mappings.last_*.
//   - No insert into kpi_app_submission_attempts.
//   - No external HTTP. No MuleSoft credentials read. No Power BI. No direct
//     MS SQL.
//   - No full payload body persisted; only payload_hash + payload_summary +
//     payload_row_count.
//   - Decrypted text values are passed as PLAINTEXT into the outbox insert
//     and re-encrypted in place by the existing C2.4 BEFORE INSERT trigger.
//     This helper does NOT call btpm_encrypt directly and does NOT pre-encrypt.
//
// Authority:
//   - This helper is invoked ONLY by `run-kpi-app-scheduler` system mode,
//     after the constant-time `KPI_APP_SCHEDULER_SECRET` gate AND
//     `KPI_APP_SCHEDULER_ENABLED === "true"` AND no `Authorization` header.
//   - The two SECURITY DEFINER system RPCs are EXEC-revoked from PUBLIC,
//     anon, and authenticated; only service_role can invoke them.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildKpiAppPayload,
  type PayloadSourceBundle,
} from "./kpi-app-payload-builder.ts";
import { loadPayloadSourceBundleSystem } from "./kpi-app-payload-source-system.ts";

export type SystemOutboxResult =
  | {
      kind: "ready";
      outbox_id: string;
      reused_existing_outbox: boolean;
      status: "queued" | "payload_ready";
      carry_forward_used: boolean;
      source_snapshot_id: string;
    }
  | {
      kind: "not_reportable";
      reason: string;
    }
  | {
      kind: "conflict";
      outbox_id: string;
      status: string;
      reason: string;
    };

export interface SystemPrepareOutboxArgs {
  adminClient: SupabaseClient;
  mappingId: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  kpiDefinitionId: string;
  reportingPeriodStart: string; // YYYY-MM-DD
  reportingPeriodEnd: string; // YYYY-MM-DD
  validityDate: string; // YYYY-MM-DD
}

const REUSABLE_STATUSES = new Set(["queued", "payload_ready"]);
const BLOCKING_STATUSES = new Set([
  "submitting",
  "submitted",
  "failed",
  "retry_pending",
  "skipped",
]);

/**
 * Create a new queued outbox row, or reuse an existing queued / payload_ready
 * row, for the given mapping + reporting period. Returns a controlled
 * { kind } result; never throws on selection / authority outcomes.
 *
 * Encryption: source_string_value / source_comment / source_action_plan are
 * passed as plaintext and encrypted in place by the existing C2.4 BEFORE
 * INSERT trigger.
 */
export async function createOrReuseOutboxSystem(
  args: SystemPrepareOutboxArgs,
): Promise<SystemOutboxResult> {
  const {
    adminClient,
    mappingId,
    organizationId,
    reportingPeriodStart,
    reportingPeriodEnd,
    validityDate,
  } = args;

  // Pre-check existing non-cancelled, NON-SUPERSEDED outbox for the same period.
  // C2-FIX.4: Superseded rows are audit history only — they must NEVER be reused,
  // treated as active blockers, or prevent creation of a fresh scheduled outbox.
  const { data: existing, error: existErr } = await adminClient
    .from("kpi_app_submission_outbox")
    .select("id, status, submission_mode, superseded_at")
    .eq("organization_id", organizationId)
    .eq("mapping_id", mappingId)
    .eq("reporting_period_start", reportingPeriodStart)
    .eq("reporting_period_end", reportingPeriodEnd)
    .neq("status", "cancelled")
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existErr) {
    throw new Error(existErr.message);
  }
  if (existing) {
    const status = existing.status as string;
    const submissionMode = (existing.submission_mode as string | null) ?? null;
    if (REUSABLE_STATUSES.has(status)) {
      // C2-FIX.4: Scheduler must not pick up stale manual Report Now outboxes.
      // Old manual rows for the same period must be resolved or reset manually.
      if (submissionMode !== "scheduled") {
        return {
          kind: "conflict",
          outbox_id: existing.id as string,
          status,
          reason: `stale manual outbox (submission_mode='${submissionMode}') in '${status}' — scheduler does not act on manual rows; reset or complete manually`,
        };
      }
      // Re-derive carry_forward + snapshot id from the row we just found,
      // so the caller can report consistent metadata without another RPC.
      const { data: full, error: fullErr } = await adminClient
        .from("kpi_app_submission_outbox")
        .select("id, status, carry_forward_used, source_snapshot_id")
        .eq("id", existing.id as string)
        .is("superseded_at", null)
        .maybeSingle();
      if (fullErr || !full) {
        throw new Error(fullErr?.message ?? "outbox reload failed");
      }
      return {
        kind: "ready",
        outbox_id: full.id as string,
        reused_existing_outbox: true,
        status: full.status as "queued" | "payload_ready",
        carry_forward_used: !!full.carry_forward_used,
        source_snapshot_id: full.source_snapshot_id as string,
      };
    }
    if (BLOCKING_STATUSES.has(status)) {
      return {
        kind: "conflict",
        outbox_id: existing.id as string,
        status,
        reason:
          status === "submitting"
            ? "in_progress"
            : status === "submitted"
              ? "already_submitted"
              : "needs_manual_retry_or_review",
      };
    }
    // Unrecognised status — treat as conflict to stay safe.
    return {
      kind: "conflict",
      outbox_id: existing.id as string,
      status,
      reason: `unrecognized outbox status '${status}'`,
    };
  }

  // No existing row: run system-mode selection (mirrors C2.9a server-side).
  const { data: selRaw, error: selErr } = await adminClient.rpc(
    "prepare_kpi_app_report_now_select_system",
    {
      _mapping_id: mappingId,
      _reporting_period_start: reportingPeriodStart,
      _reporting_period_end: reportingPeriodEnd,
    },
  );
  if (selErr) {
    return { kind: "not_reportable", reason: selErr.message ?? "selection_failed" };
  }
  const sel = (selRaw ?? {}) as {
    reportable?: boolean;
    reason?: string;
    carry_forward_used?: boolean;
    mapping?: {
      organization_id: string;
      workspace_id: string;
      project_id: string;
      kpi_definition_id: string;
    };
    snapshot?: {
      id: string;
      period_start: string;
      period_end: string;
      value_type: "percent" | "number" | "currency" | "text";
      value_amount: number | null;
    };
  };
  if (!sel.reportable || !sel.snapshot || !sel.mapping) {
    return { kind: "not_reportable", reason: sel.reason ?? "not_reportable" };
  }

  // Decrypt the three text fields via the system-mode SECURITY DEFINER RPC
  // (revalidates mapping/snapshot scope and system-eligibility invariants).
  const { data: decRaw, error: decErr } = await adminClient.rpc(
    "get_kpi_snapshot_decrypted_for_mapping_system",
    { _mapping_id: mappingId, _snapshot_id: sel.snapshot.id },
  );
  if (decErr || !decRaw) {
    return {
      kind: "not_reportable",
      reason: decErr?.message ?? "decrypted_snapshot_unavailable",
    };
  }
  const dec = decRaw as {
    string_value: string | null;
    comment: string | null;
    action_plan: string | null;
  };
  const valueType = sel.snapshot.value_type;
  const isText = valueType === "text";
  const nowIso = new Date().toISOString();

  // Insert the outbox row. The C2.4 BEFORE INSERT trigger will encrypt
  // source_string_value / source_comment / source_action_plan in place.
  // System-mode audit convention: created_by / updated_by are NULL.
  const insertRow = {
    organization_id: sel.mapping.organization_id,
    workspace_id: sel.mapping.workspace_id,
    project_id: sel.mapping.project_id,
    mapping_id: mappingId,
    kpi_definition_id: sel.mapping.kpi_definition_id,
    source_snapshot_id: sel.snapshot.id,
    reporting_period_start: reportingPeriodStart,
    reporting_period_end: reportingPeriodEnd,
    validity_date: validityDate,
    source_snapshot_period_start: sel.snapshot.period_start,
    source_snapshot_period_end: sel.snapshot.period_end,
    source_value_type: valueType,
    source_value_amount: isText ? null : sel.snapshot.value_amount,
    source_string_value: isText ? dec.string_value : null,
    source_comment: dec.comment,
    source_action_plan: dec.action_plan,
    submission_mode: "scheduled",
    status: "queued",
    carry_forward_used: !!sel.carry_forward_used,
    retry_count: 0,
    payload_row_count: null,
    payload_hash: null,
    payload_summary: null,
    submitted_by: null,
    submitted_at: null,
    created_by: null,
    updated_by: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data: inserted, error: insErr } = await adminClient
    .from("kpi_app_submission_outbox")
    .insert(insertRow)
    .select("id, status")
    .single();

  if (insErr || !inserted) {
    // Race: another caller created the row between our pre-check and insert.
    // Re-query and reuse / report controlled conflict.
    // C2-FIX.4: Race-condition re-query must also exclude superseded rows.
    const { data: raceRow } = await adminClient
      .from("kpi_app_submission_outbox")
      .select("id, status, carry_forward_used, source_snapshot_id, submission_mode")
      .eq("organization_id", organizationId)
      .eq("mapping_id", mappingId)
      .eq("reporting_period_start", reportingPeriodStart)
      .eq("reporting_period_end", reportingPeriodEnd)
      .neq("status", "cancelled")
      .is("superseded_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      raceRow &&
      REUSABLE_STATUSES.has(raceRow.status as string) &&
      (raceRow.submission_mode as string | null) === "scheduled"
    ) {
      return {
        kind: "ready",
        outbox_id: raceRow.id as string,
        reused_existing_outbox: true,
        status: raceRow.status as "queued" | "payload_ready",
        carry_forward_used: !!raceRow.carry_forward_used,
        source_snapshot_id: raceRow.source_snapshot_id as string,
      };
    }
    if (raceRow) {
      return {
        kind: "conflict",
        outbox_id: raceRow.id as string,
        status: raceRow.status as string,
        reason: `concurrent insert produced status '${raceRow.status}'`,
      };
    }
    throw new Error(insErr?.message ?? "insert failed");
  }

  return {
    kind: "ready",
    outbox_id: inserted.id as string,
    reused_existing_outbox: false,
    status: inserted.status as "queued" | "payload_ready",
    carry_forward_used: !!sel.carry_forward_used,
    source_snapshot_id: sel.snapshot.id,
  };
}

export type SystemPreparePayloadResult =
  | {
      kind: "ready";
      outbox_id: string;
      payload_row_count: number;
      payload_hash: string;
      carry_forward_used: boolean;
    }
  | {
      kind: "error";
      outbox_id: string;
      reason: string;
    };

/**
 * System-mode payload prepare (mirrors `build-kpi-app-payload` action="prepare"
 * exactly, but without the human-admin RPC gates). Loads the decrypted source
 * bundle via `loadPayloadSourceBundleSystem` (service-role + btpm_decrypt),
 * runs the canonical `buildKpiAppPayload`, and updates ONLY payload metadata
 * on the same outbox row to status='payload_ready'.
 *
 * Caller MUST have ensured outbox.status === 'queued' before calling.
 */
export async function preparePayloadSystem(
  adminClient: SupabaseClient,
  outboxId: string,
): Promise<SystemPreparePayloadResult> {
  let bundle: PayloadSourceBundle;
  try {
    bundle = await loadPayloadSourceBundleSystem(adminClient, outboxId);
  } catch (e) {
    return {
      kind: "error",
      outbox_id: outboxId,
      reason: e instanceof Error ? e.message : "bundle load failed",
    };
  }

  if (bundle.outbox.status !== "queued" && bundle.outbox.status !== "payload_ready") {
    return {
      kind: "error",
      outbox_id: outboxId,
      reason: `outbox status '${bundle.outbox.status}' not eligible for prepare`,
    };
  }

  let built;
  try {
    built = await buildKpiAppPayload(bundle);
  } catch (e) {
    return {
      kind: "error",
      outbox_id: outboxId,
      reason: e instanceof Error ? e.message : "builder failed",
    };
  }

  // System-mode audit convention: updated_by = NULL.
  const { error: updErr } = await adminClient
    .from("kpi_app_submission_outbox")
    .update({
      status: "payload_ready",
      payload_row_count: built.payload_row_count,
      payload_hash: built.payload_hash,
      payload_summary: built.payload_summary,
      updated_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", outboxId);

  if (updErr) {
    return {
      kind: "error",
      outbox_id: outboxId,
      reason: updErr.message,
    };
  }

  return {
    kind: "ready",
    outbox_id: outboxId,
    payload_row_count: built.payload_row_count,
    payload_hash: built.payload_hash,
    carry_forward_used: built.carry_forward_used,
  };
}
