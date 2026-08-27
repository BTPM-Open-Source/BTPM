// BTPM — Wave C2, Step C2.11d
// Shared internal helper: assemble a PayloadSourceBundle for system-mode
// (scheduler) invocations using a service-role Supabase client.
//
// Why this helper exists
// ----------------------
// The canonical decrypted source bundle is normally produced by the
// SECURITY DEFINER RPC `public.get_kpi_app_payload_source`. That RPC
// hard-gates on `auth.uid()` (Org Admin / Workspace Admin) and therefore
// cannot be called from a system-mode request that has no human JWT.
//
// The scheduler system path satisfies authority via the
// KPI_APP_SCHEDULER_SECRET gate (constant-time, see
// `kpi-app-scheduler-auth.ts`). Once that gate has passed, the scheduler
// uses a service-role client to read exactly the same fields the RPC
// would have returned, and decrypts the sensitive columns via the
// existing `public.btpm_decrypt(text, uuid)` SECURITY DEFINER function.
// Encryption keys remain in `vault.decrypted_secrets` and are never
// surfaced.
//
// Hard rules upheld:
//   - Returns the EXACT same bundle shape as the RPC, so the canonical
//     `buildKpiAppPayload` (C2.5 / C2.5a) consumes it without divergence.
//   - No second payload builder; this helper does not transform values.
//   - No second outbox truth; bundle is a read-only snapshot.
//   - Decrypted comment / action_plan / string_value never leave the
//     server: they are placed only in the bundle that flows directly
//     into the payload builder + submit helper.
//   - This helper is invoked ONLY by `run-kpi-app-scheduler` system mode
//     (after the scheduler-secret gate). The public Edge Functions
//     continue to use the RPC unchanged.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { PayloadSourceBundle } from "./kpi-app-payload-builder.ts";

async function decrypt(
  adminClient: SupabaseClient,
  ciphertext: string | null,
  orgId: string,
): Promise<string | null> {
  if (ciphertext === null || ciphertext === "") return null;
  const { data, error } = await adminClient.rpc("btpm_decrypt", {
    _ciphertext: ciphertext,
    _org_id: orgId,
  });
  if (error) throw new Error(`btpm_decrypt failed: ${error.message}`);
  return (data as string | null) ?? null;
}

/**
 * Build a PayloadSourceBundle for one outbox row using the supplied
 * service-role client. Caller is responsible for having passed the
 * scheduler-secret gate first.
 */
export async function loadPayloadSourceBundleSystem(
  adminClient: SupabaseClient,
  outboxId: string,
): Promise<PayloadSourceBundle> {
  const { data: o, error: oErr } = await adminClient
    .from("kpi_app_submission_outbox")
    .select(
      "id, organization_id, workspace_id, project_id, mapping_id, kpi_definition_id, source_snapshot_id, reporting_period_start, reporting_period_end, validity_date, source_value_type, source_value_amount, source_string_value, source_comment, source_action_plan, submission_mode, status, carry_forward_used, submitted_by",
    )
    .eq("id", outboxId)
    .maybeSingle();
  if (oErr) throw new Error(oErr.message);
  if (!o) throw new Error("Outbox row not found");

  const { data: m, error: mErr } = await adminClient
    .from("kpi_app_mappings")
    .select(
      "id, is_active, scenario_id, currency_id, external_kpi_id, reporting_frequency, entered_by_email_source, entered_by_user_id, comment_source, action_plan_source, carry_forward_allowed",
    )
    .eq("id", o.mapping_id)
    .maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!m) throw new Error("Mapping not found");

  const { data: s, error: sErr } = await adminClient
    .from("kpi_snapshots")
    .select(
      "id, period_start, period_end, value_type, value_amount, string_value, comment, action_plan, created_by, calculation_status",
    )
    .eq("id", o.source_snapshot_id)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!s) throw new Error("Snapshot not found");

  const orgId = o.organization_id as string;

  const [
    outboxStringValue,
    outboxComment,
    outboxActionPlan,
    snapshotStringValue,
    snapshotComment,
    snapshotActionPlan,
  ] = await Promise.all([
    decrypt(adminClient, o.source_string_value as string | null, orgId),
    decrypt(adminClient, o.source_comment as string | null, orgId),
    decrypt(adminClient, o.source_action_plan as string | null, orgId),
    decrypt(adminClient, s.string_value as string | null, orgId),
    decrypt(adminClient, s.comment as string | null, orgId),
    decrypt(adminClient, s.action_plan as string | null, orgId),
  ]);

  // C3.10c — Scheduled (system-mode) submissions never act on behalf of a
  // real user. The external KPI App record must reflect that the update
  // was system-generated. We resolve a backend-only system email from
  // KPI_APP_SYSTEM_ENTERED_BY_EMAIL and use it as the EnteredBy_Email
  // regardless of the mapping's entered_by_email_source. This:
  //   - eliminates failures when entered_by_email_source = snapshot_created_by
  //     and snapshot.created_by IS NULL (auto-captured snapshots);
  //   - prevents impersonation of the configured user during automation;
  //   - fails closed with a clear, auditable error if the secret is missing.
  // Manual paths (prepare-kpi-app-report-now, build-kpi-app-payload manual,
  // submit-kpi-app-payload manual) DO NOT call this loader and remain
  // entirely unchanged.
  const rawSystemEmail = (Deno.env.get("KPI_APP_SYSTEM_ENTERED_BY_EMAIL") ?? "")
    .trim();
  const systemEmailValid =
    rawSystemEmail.length > 0 &&
    rawSystemEmail.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawSystemEmail);
  if (!systemEmailValid) {
    // Fail-closed diagnostic surfaced in scheduler last_error_message and
    // visible in the Submission Monitor. Never echo the (possibly bad)
    // value itself.
    throw new Error("system_entered_by_email_unconfigured");
  }
  const systemEnteredByEmail = rawSystemEmail;

  const bundle: PayloadSourceBundle = {
    outbox: {
      id: o.id as string,
      organization_id: orgId,
      workspace_id: o.workspace_id as string,
      project_id: o.project_id as string,
      mapping_id: o.mapping_id as string,
      kpi_definition_id: o.kpi_definition_id as string,
      source_snapshot_id: o.source_snapshot_id as string,
      reporting_period_start: o.reporting_period_start as string,
      reporting_period_end: o.reporting_period_end as string,
      validity_date: o.validity_date as string,
      source_value_type: o.source_value_type as PayloadSourceBundle["outbox"]["source_value_type"],
      source_value_amount: (o.source_value_amount as number | null) ?? null,
      source_string_value: outboxStringValue,
      source_comment: outboxComment,
      source_action_plan: outboxActionPlan,
      submission_mode: o.submission_mode as string,
      status: o.status as string,
      carry_forward_used: !!o.carry_forward_used,
      submitted_by: (o.submitted_by as string | null) ?? null,
    },
    mapping: {
      id: m.id as string,
      is_active: !!m.is_active,
      scenario_id: m.scenario_id as number,
      currency_id: m.currency_id as number,
      external_kpi_id: m.external_kpi_id as number,
      reporting_frequency: m.reporting_frequency as string,
      entered_by_email_source: m.entered_by_email_source as PayloadSourceBundle["mapping"]["entered_by_email_source"],
      entered_by_user_id: (m.entered_by_user_id as string | null) ?? null,
      comment_source: m.comment_source as PayloadSourceBundle["mapping"]["comment_source"],
      action_plan_source: m.action_plan_source as PayloadSourceBundle["mapping"]["action_plan_source"],
      carry_forward_allowed: !!m.carry_forward_allowed,
    },
    snapshot: {
      id: s.id as string,
      period_start: s.period_start as string,
      period_end: s.period_end as string,
      value_type: s.value_type as PayloadSourceBundle["snapshot"]["value_type"],
      value_amount: (s.value_amount as number | null) ?? null,
      string_value: snapshotStringValue,
      comment: snapshotComment,
      action_plan: snapshotActionPlan,
      created_by: (s.created_by as string | null) ?? null,
      calculation_status: (s.calculation_status as string | null) ?? null,
    },
    // C3.10c — for system-mode every entered_by_email_source resolves to
    // the BTPM system identity. Populating all three buckets means the
    // canonical resolveEnteredByEmail() in the shared builder succeeds
    // unchanged regardless of mapping.entered_by_email_source value.
    snapshot_created_by_email: systemEnteredByEmail,
    configured_user_email: systemEnteredByEmail,
    caller_email: systemEnteredByEmail,
  };

  return bundle;
}
