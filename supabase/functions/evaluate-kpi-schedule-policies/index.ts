// BTPM — Wave C3, Step C3.9i
// evaluate-kpi-schedule-policies — read-only, dry-run only.
//
// Evaluates whether configured KPI schedule policies (kpi_schedule_policies)
// are due at a given UTC datetime, and which completed reporting period
// each policy refers to. Performs NO writes, NO snapshots, NO submissions,
// NO outbox/attempt rows, NO MuleSoft/KPI App calls, NO scheduler activation.
//
// Authority sequencing (mirrors C3.3a):
//   - identify caller via user-scoped client (RLS-respecting)
//   - resolve caller organization
//   - apply admin authority gate BEFORE constructing service-role client
//     - if workspace_id provided: caller must be Org Admin OR
//       Workspace Admin-or-higher for that workspace
//     - if workspace_id omitted: caller must be Org Admin
//   - service-role client constructed only after the gate, used solely
//     to read kpi_schedule_policies in caller's authorized scope
//
// Request contract (POST):
//   {
//     "mode": "dry_run",
//     "as_of_datetime_utc"?: ISO datetime (default: now UTC),
//     "workspace_id"?: uuid,
//     "process_type"?: "automatic_snapshot_capture" | "kpi_app_auto_submit",
//     "cadence"?: "weekly" | "monthly" | "quarterly" | "yearly"
//   }
// Extra fields => 400. Unsupported mode => 400.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { buildBrowserCorsHeaders } from "../_shared/browserCors.ts";
import {
  evaluateKpiSchedulePolicyDue,
  type SchedulePolicyCadence,
  type SchedulePolicyProcessType,
} from "../_shared/kpi/kpiScheduleDue.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

function json(data: unknown, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_PROCESS_TYPES = new Set<SchedulePolicyProcessType>([
  "automatic_snapshot_capture",
  "kpi_app_auto_submit",
]);
const ALLOWED_CADENCES = new Set<SchedulePolicyCadence>([
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

type PolicyRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  process_type: string;
  cadence: string;
  delay_days_after_period_close: number;
  run_time_utc: string;
  is_active: boolean;
};

Deno.serve(async (req) => {
  const cors = buildBrowserCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return json(
      { request_id: requestId, ok: false, error: "Method not allowed" },
      cors,
      405,
    );
  }

  try {
    // ---------- Authentication setup (hoisted above body parsing) ----------

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json(
        { request_id: requestId, ok: false, error: "Missing authorization" },
        cors,
        401,
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // ---------- Browser-session-only OAuth denial guard (API-E.R4AB) ----------
    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, cors);
    }

    // ---------- Parse + validate request body ----------
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return json(
        { request_id: requestId, ok: false, error: "Invalid request body" },
        cors,
        400,
      );
    }

    const ALLOWED_KEYS = new Set([
      "mode",
      "as_of_datetime_utc",
      "workspace_id",
      "process_type",
      "cadence",
    ]);
    const extraKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
    if (extraKeys.length > 0) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: `Unexpected fields: ${extraKeys.join(", ")}`,
        },
        cors,
        400,
      );
    }

    const b = body as Record<string, unknown>;

    if (b.mode !== "dry_run") {
      return json(
        { request_id: requestId, ok: false, error: "mode must be 'dry_run'" },
        cors,
        400,
      );
    }

    // as_of_datetime_utc — default to now UTC, validate ISO if provided
    let asOfDateTimeUtc: string;
    if (b.as_of_datetime_utc === undefined || b.as_of_datetime_utc === null) {
      asOfDateTimeUtc = new Date().toISOString();
    } else if (typeof b.as_of_datetime_utc !== "string") {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: "Invalid as_of_datetime_utc",
        },
        cors,
        400,
      );
    } else {
      const parsed = new Date(b.as_of_datetime_utc);
      if (Number.isNaN(parsed.getTime())) {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "Invalid as_of_datetime_utc (not parseable as ISO datetime)",
          },
          cors,
          400,
        );
      }
      asOfDateTimeUtc = parsed.toISOString();
    }

    // workspace_id — optional uuid
    let workspaceFilter: string | null = null;
    if (b.workspace_id !== undefined && b.workspace_id !== null) {
      if (typeof b.workspace_id !== "string" || !UUID_RE.test(b.workspace_id)) {
        return json(
          { request_id: requestId, ok: false, error: "Invalid workspace_id" },
          cors,
          400,
        );
      }
      workspaceFilter = b.workspace_id;
    }

    // process_type — optional, allow-listed
    let processTypeFilter: SchedulePolicyProcessType | null = null;
    if (b.process_type !== undefined && b.process_type !== null) {
      if (
        typeof b.process_type !== "string" ||
        !ALLOWED_PROCESS_TYPES.has(b.process_type as SchedulePolicyProcessType)
      ) {
        return json(
          { request_id: requestId, ok: false, error: "Invalid process_type" },
          cors,
          400,
        );
      }
      processTypeFilter = b.process_type as SchedulePolicyProcessType;
    }

    // cadence — optional, allow-listed
    let cadenceFilter: SchedulePolicyCadence | null = null;
    if (b.cadence !== undefined && b.cadence !== null) {
      if (
        typeof b.cadence !== "string" ||
        !ALLOWED_CADENCES.has(b.cadence as SchedulePolicyCadence)
      ) {
        return json(
          { request_id: requestId, ok: false, error: "Invalid cadence" },
          cors,
          400,
        );
      }
      cadenceFilter = b.cadence as SchedulePolicyCadence;
    }

    // ---------- Step 1: identify caller (user-scoped client) ----------
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json(
        { request_id: requestId, ok: false, error: "Unauthorized" },
        cors,
        401,
      );
    }
    const callerId = userData.user.id;

    const { data: callerOrgRaw, error: callerOrgErr } = await userClient.rpc(
      "get_user_org_id",
      { _user_id: callerId },
    );
    if (callerOrgErr || !callerOrgRaw) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: "Caller has no organization scope",
        },
        cors,
        403,
      );
    }
    const effectiveOrgId = callerOrgRaw as string;

    // ---------- Step 2: AUTHORITY GATE (before service-role) ----------
    const { data: isOrgAdmin, error: isOrgAdminErr } = await userClient.rpc(
      "is_org_admin",
      { _user_id: callerId, _organization_id: effectiveOrgId },
    );
    if (isOrgAdminErr) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: "Authorization check failed",
        },
        cors,
        500,
      );
    }
    const isOrgAdminBool = isOrgAdmin === true;

    if (!workspaceFilter) {
      // Org-wide dry-run: must be Org Admin BEFORE any service-role read.
      if (!isOrgAdminBool) {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "Org-wide dry-run requires Org Admin authority",
          },
          cors,
          403,
        );
      }
    } else if (!isOrgAdminBool) {
      const { data: wsAdmin, error: wsErr } = await userClient.rpc(
        "is_workspace_admin_or_higher",
        { _user_id: callerId, _workspace_id: workspaceFilter },
      );
      if (wsErr) {
        return json(
          {
            request_id: requestId,
            ok: false,
            error: "Authorization check failed",
          },
          cors,
          500,
        );
      }
      if (wsAdmin !== true) {
        return json(
          { request_id: requestId, ok: false, error: "Not found or not authorized" },
          cors,
          403,
        );
      }
    }

    // ---------- Step 3: service-role read of policies in scope ----------
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let policyQuery = adminClient
      .from("kpi_schedule_policies")
      .select(
        "id, organization_id, workspace_id, process_type, cadence, delay_days_after_period_close, run_time_utc, is_active",
      )
      .eq("organization_id", effectiveOrgId);

    if (workspaceFilter) {
      policyQuery = policyQuery.eq("workspace_id", workspaceFilter);
    }
    if (processTypeFilter) {
      policyQuery = policyQuery.eq("process_type", processTypeFilter);
    }
    if (cadenceFilter) {
      policyQuery = policyQuery.eq("cadence", cadenceFilter);
    }

    const { data: policiesRaw, error: policiesErr } = await policyQuery;
    if (policiesErr) {
      return json(
        {
          request_id: requestId,
          ok: false,
          error: "Failed to read schedule policies",
        },
        cors,
        500,
      );
    }
    const policies = (policiesRaw ?? []) as PolicyRow[];

    // ---------- Workspace name lookup (best-effort) ----------
    const workspaceIds = Array.from(
      new Set(policies.map((p) => p.workspace_id)),
    );
    const workspaceNameById = new Map<string, string | null>();
    if (workspaceIds.length > 0) {
      const { data: wsRows } = await adminClient
        .from("workspaces")
        .select("id, name")
        .in("id", workspaceIds);
      for (const w of (wsRows ?? []) as Array<{ id: string; name: string | null }>) {
        workspaceNameById.set(w.id, w.name ?? null);
      }
    }

    // ---------- Step 4: evaluate due-ness for each policy ----------
    const items = policies.map((p) => {
      const evalRes = evaluateKpiSchedulePolicyDue(
        {
          cadence: p.cadence,
          delay_days_after_period_close: p.delay_days_after_period_close,
          run_time_utc: p.run_time_utc,
          is_active: p.is_active,
        },
        asOfDateTimeUtc,
      );
      return {
        policy_id: p.id,
        organization_id: p.organization_id,
        workspace_id: p.workspace_id,
        workspace_name: workspaceNameById.get(p.workspace_id) ?? null,
        process_type: p.process_type,
        cadence: p.cadence,
        is_active: p.is_active,
        delay_days_after_period_close: p.delay_days_after_period_close,
        run_time_utc: p.run_time_utc,
        period_start: evalRes.period_start,
        period_end: evalRes.period_end,
        scheduled_run_at: evalRes.scheduled_run_at,
        is_due: evalRes.is_due,
        due_status: evalRes.due_status,
        reason: evalRes.reason,
      };
    });

    const summary = {
      due: items.filter((i) => i.due_status === "due").length,
      inactive: items.filter((i) => i.due_status === "inactive").length,
      not_due: items.filter(
        (i) =>
          i.due_status === "not_due_time_not_reached" ||
          i.due_status === "not_due_scheduled_date_in_future" ||
          i.due_status === "not_due_scheduled_date_passed",
      ).length,
      invalid: items.filter((i) => i.due_status === "invalid_policy").length,
    };

    return json(
      {
        request_id: requestId,
        ok: true,
        mode: "dry_run",
        as_of_datetime_utc: asOfDateTimeUtc,
        policy_count: items.length,
        due_count: summary.due,
        items,
        summary,
      },
      cors,
      200,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json(
      { request_id: requestId, ok: false, error: msg.slice(0, 300) },
      cors,
      500,
    );
  }
});
