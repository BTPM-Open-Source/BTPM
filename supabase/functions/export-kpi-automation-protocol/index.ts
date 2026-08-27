// BTPM — C2-FIX.5
// Export KPI Automation Protocol as JSON.
//
// Protected, read-only. Returns a single JSON document describing:
//   - mappings considered in the selected period
//   - snapshot capture runs/items (existing tables, no duplication)
//   - auto-submit scheduler runs/items (kpi_app_scheduler_*)
//   - outbox history + submission attempts
//   - skip / not-reportable / failure reasons
//   - anomalies (superseded rows, stale manual outbox, missing snapshot, upstream failures)
//
// Hard rules:
//   - No credentials in output. No Authorization headers.
//   - No decrypted comments / action plans / string values; only *_present booleans.
//   - Admin auth gate before any service-role read.
//   - POST only.

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDate(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s);
}

Deno.serve(async (req) => {
  const cors = buildBrowserCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, cors, 405);
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ ok: false, error: "Missing authorization" }, cors, 401);

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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ ok: false, error: "Invalid body" }, cors, 400);
    }
    const periodStart = body.period_start;
    const periodEnd = body.period_end;
    if (!isDate(periodStart) || !isDate(periodEnd)) {
      return json({ ok: false, error: "period_start / period_end required (YYYY-MM-DD)" }, cors, 400);
    }
    if (periodStart > periodEnd) {
      return json({ ok: false, error: "period_start must be <= period_end" }, cors, 400);
    }
    const workspaceId = typeof body.workspace_id === "string" && UUID_RE.test(body.workspace_id)
      ? body.workspace_id
      : null;
    let externalKpiIds: number[] | null = null;
    if (Array.isArray(body.external_kpi_ids)) {
      const ids = body.external_kpi_ids
        .filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
        .map((x: number) => Math.trunc(x));
      externalKpiIds = ids.length ? ids : null;
    }
    const includeSnap = body.include_snapshot_protocol !== false;
    const includeSubmit = body.include_submit_protocol !== false;
    const includeOutbox = body.include_outbox_history !== false;
    const includeAttempts = body.include_attempts !== false;

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "Unauthorized" }, cors, 401);
    }
    const callerId = userData.user.id;

    // Resolve caller org and authority
    const { data: orgIdRaw } = await userClient.rpc("get_user_org_id", { _user_id: callerId });
    if (!orgIdRaw) return json({ ok: false, error: "Caller has no organization scope" }, cors, 403);
    const orgId = orgIdRaw as string;

    let isOrgAdmin = false;
    {
      const { data } = await userClient.rpc("is_org_admin", {
        _user_id: callerId,
        _org_id: orgId,
      });
      isOrgAdmin = data === true;
    }

    if (!isOrgAdmin) {
      if (!workspaceId) {
        return json(
          { ok: false, error: "Non-org-admins must specify workspace_id" },
          cors,
          403,
        );
      }
      const { data: isWsAdmin } = await userClient.rpc("is_workspace_admin_or_higher", {
        _user_id: callerId,
        _workspace_id: workspaceId,
      });
      if (isWsAdmin !== true) {
        return json({ ok: false, error: "Workspace admin authority required" }, cors, 403);
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ------- Mappings -------
    let mappingsQ = admin
      .from("kpi_app_mappings")
      .select(
        "id, organization_id, workspace_id, project_id, kpi_definition_id, external_kpi_id, scenario_id, currency_id, reporting_frequency, is_active, auto_submit_enabled, carry_forward_allowed, last_submitted_at, last_submission_status",
      )
      .eq("organization_id", orgId);
    if (workspaceId) mappingsQ = mappingsQ.eq("workspace_id", workspaceId);
    if (externalKpiIds) mappingsQ = mappingsQ.in("external_kpi_id", externalKpiIds);
    const { data: mappings = [] } = await mappingsQ;

    const mappingIds = (mappings ?? []).map((m: any) => m.id);
    const projectIds = Array.from(new Set((mappings ?? []).map((m: any) => m.project_id).filter(Boolean)));
    const kpiDefIds = Array.from(new Set((mappings ?? []).map((m: any) => m.kpi_definition_id).filter(Boolean)));
    const extIds = Array.from(new Set((mappings ?? []).map((m: any) => m.external_kpi_id).filter((x: any) => typeof x === "number")));

    // Lookup projects / kpi defs / external kpis (for readable names)
    const [{ data: projects = [] }, { data: kpiDefs = [] }, { data: externals = [] }] = await Promise.all([
      projectIds.length
        ? admin.from("projects").select("id, name").in("id", projectIds)
        : Promise.resolve({ data: [] as any[] }),
      kpiDefIds.length
        ? admin.from("kpi_definitions").select("id, name, cadence, source_mode, auto_snapshot_enabled, comment_required, action_plan_required").in("id", kpiDefIds)
        : Promise.resolve({ data: [] as any[] }),
      extIds.length
        ? admin.from("kpi_app_external_kpis").select("external_kpi_id, external_kpi_name, value_type, is_active").in("external_kpi_id", extIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const projectName = new Map((projects ?? []).map((p: any) => [p.id, p.name]));
    const kpiDefMap = new Map((kpiDefs ?? []).map((k: any) => [k.id, k]));
    const extMap = new Map((externals ?? []).map((e: any) => [e.external_kpi_id, e]));

    // ------- Snapshot capture protocol -------
    let snapRuns: any[] = [];
    let snapItems: any[] = [];
    if (includeSnap) {
      let runsQ = admin
        .from("kpi_snapshot_capture_runs")
        .select("*")
        .eq("organization_id", orgId)
        .gte("as_of_date", periodStart)
        .lte("as_of_date", periodEnd)
        .order("started_at", { ascending: false })
        .limit(200);
      if (workspaceId) runsQ = runsQ.eq("workspace_id", workspaceId);
      snapRuns = (await runsQ).data ?? [];

      let itemsQ = admin
        .from("kpi_snapshot_capture_run_items")
        .select("*")
        .eq("organization_id", orgId)
        .gte("period_end", periodStart)
        .lte("period_end", periodEnd)
        .limit(2000);
      if (workspaceId) itemsQ = itemsQ.eq("workspace_id", workspaceId);
      if (kpiDefIds.length) itemsQ = itemsQ.in("kpi_definition_id", kpiDefIds);
      snapItems = (await itemsQ).data ?? [];
    }

    // ------- Snapshots for the period (canonical references) -------
    let snapshots: any[] = [];
    if (kpiDefIds.length) {
      let q = admin
        .from("kpi_snapshots")
        .select("id, kpi_definition_id, project_id, workspace_id, organization_id, period_start, period_end, snapshot_date, value_amount, value_type, calculation_status, created_at")
        .eq("organization_id", orgId)
        .in("kpi_definition_id", kpiDefIds)
        .gte("period_end", periodStart)
        .lte("period_end", periodEnd)
        .limit(2000);
      if (workspaceId) q = q.eq("workspace_id", workspaceId);
      snapshots = (await q).data ?? [];
    }

    // ------- Outbox history -------
    let outbox: any[] = [];
    if (includeOutbox && mappingIds.length) {
      const { data } = await admin
        .from("kpi_app_submission_outbox")
        .select(
          "id, mapping_id, project_id, workspace_id, organization_id, status, submission_mode, reporting_period_start, reporting_period_end, validity_date, source_snapshot_id, source_snapshot_period_start, source_snapshot_period_end, carry_forward_used, payload_row_count, payload_summary, retry_count, last_attempt_at, submitted_at, last_http_status, last_upstream_status_text, source_comment, source_action_plan, source_string_value, source_value_amount, source_value_type, superseded_at, superseded_reason, replacement_outbox_id, external_correlation_id, created_at",
        )
        .in("mapping_id", mappingIds)
        .gte("reporting_period_end", periodStart)
        .lte("reporting_period_end", periodEnd)
        .order("created_at", { ascending: false })
        .limit(2000);
      outbox = (data ?? []).map((r: any) => {
        const { source_comment, source_action_plan, source_string_value, ...safe } = r;
        return {
          ...safe,
          comment_present: source_comment != null && source_comment !== "",
          action_plan_present: source_action_plan != null && source_action_plan !== "",
          string_value_present: source_string_value != null && source_string_value !== "",
        };
      });
    }

    // ------- Attempts -------
    let attempts: any[] = [];
    if (includeAttempts && outbox.length) {
      const outboxIds = outbox.map((o: any) => o.id);
      const { data } = await admin
        .from("kpi_app_submission_attempts")
        .select("id, outbox_id, attempt_number, attempted_at, status, http_status, upstream_status_text, elapsed_ms, payload_row_count, request_id, external_correlation_id")
        .in("outbox_id", outboxIds)
        .order("attempted_at", { ascending: false })
        .limit(5000);
      attempts = data ?? [];
    }

    // ------- Submit protocol (new tables) -------
    let submitRuns: any[] = [];
    let submitItems: any[] = [];
    if (includeSubmit) {
      let q = admin
        .from("kpi_app_scheduler_runs")
        .select("*")
        .eq("organization_id", orgId)
        .gte("started_at", periodStart + "T00:00:00Z")
        .lte("started_at", periodEnd + "T23:59:59Z")
        .order("started_at", { ascending: false })
        .limit(200);
      if (workspaceId) q = q.eq("workspace_id", workspaceId);
      submitRuns = (await q).data ?? [];

      if (submitRuns.length) {
        const runIds = submitRuns.map((r: any) => r.id);
        let iq = admin
          .from("kpi_app_scheduler_run_items")
          .select("*")
          .in("run_id", runIds)
          .limit(5000);
        if (externalKpiIds) iq = iq.in("external_kpi_id", externalKpiIds);
        if (mappingIds.length) iq = iq.in("mapping_id", mappingIds);
        submitItems = (await iq).data ?? [];
      }
    }

    // ------- Anomalies / per-mapping rollup -------
    const anomalies: any[] = [];
    const mappingRollups = (mappings ?? []).map((m: any) => {
      const def = kpiDefMap.get(m.kpi_definition_id) ?? {};
      const ext = extMap.get(m.external_kpi_id) ?? {};
      const snap = snapshots.find(
        (s: any) =>
          s.kpi_definition_id === m.kpi_definition_id &&
          s.project_id === m.project_id,
      );
      const mappingOutbox = outbox.filter((o: any) => o.mapping_id === m.id);
      const activeOutbox = mappingOutbox.find((o: any) => o.superseded_at == null);
      const supersededOutboxes = mappingOutbox.filter((o: any) => o.superseded_at != null);
      const mappingSubmitItems = submitItems.filter((i: any) => i.mapping_id === m.id);

      if (supersededOutboxes.length) {
        anomalies.push({
          mapping_id: m.id,
          external_kpi_id: m.external_kpi_id,
          type: "superseded_outbox_history",
          count: supersededOutboxes.length,
          note: "Superseded rows retained as audit history only (post C2-FIX.4).",
        });
      }
      const staleManual = mappingOutbox.find(
        (o: any) =>
          o.submission_mode === "manual" &&
          o.status === "submitting" &&
          o.last_attempt_at &&
          Date.now() - new Date(o.last_attempt_at).getTime() > 30 * 60 * 1000,
      );
      if (staleManual) {
        anomalies.push({
          mapping_id: m.id,
          external_kpi_id: m.external_kpi_id,
          type: "stale_manual_outbox",
          outbox_id: staleManual.id,
          note: "Manual outbox stuck in 'submitting' > 30 min; reconcile from Submission Monitor.",
        });
      }
      if (!snap) {
        anomalies.push({
          mapping_id: m.id,
          external_kpi_id: m.external_kpi_id,
          type: "no_snapshot_for_period",
          note: "No KPI snapshot found for the period; auto-submit cannot proceed without carry-forward.",
        });
      } else if (snap.calculation_status && snap.calculation_status !== "ready" && snap.calculation_status !== "ok") {
        anomalies.push({
          mapping_id: m.id,
          external_kpi_id: m.external_kpi_id,
          type: "snapshot_not_ready",
          snapshot_id: snap.id,
          calculation_status: snap.calculation_status,
          note: "Snapshot calculation_status is not ready; auto-submit will skip.",
        });
      }
      if (mappingOutbox.some((o: any) => o.last_http_status && o.last_http_status >= 400)) {
        anomalies.push({
          mapping_id: m.id,
          external_kpi_id: m.external_kpi_id,
          type: "upstream_failure_history",
          note: "At least one outbox row has an upstream HTTP >= 400 in scope.",
        });
      }

      return {
        mapping_id: m.id,
        project_id: m.project_id,
        project_name: projectName.get(m.project_id) ?? null,
        kpi_definition_id: m.kpi_definition_id,
        btpm_kpi_name: (def as any).name ?? null,
        cadence: (def as any).cadence ?? null,
        source_mode: (def as any).source_mode ?? null,
        auto_snapshot_enabled: (def as any).auto_snapshot_enabled ?? null,
        external_kpi_id: m.external_kpi_id,
        external_kpi_name: (ext as any).external_kpi_name ?? null,
        external_kpi_value_type: (ext as any).value_type ?? null,
        external_kpi_active: (ext as any).is_active ?? null,
        is_active: m.is_active,
        auto_submit_enabled: m.auto_submit_enabled,
        carry_forward_allowed: m.carry_forward_allowed,
        reporting_frequency: m.reporting_frequency,
        last_submitted_at: m.last_submitted_at,
        last_submission_status: m.last_submission_status,
        snapshot_for_period: snap
          ? {
              id: snap.id,
              period_start: snap.period_start,
              period_end: snap.period_end,
              snapshot_date: snap.snapshot_date,
              value_type: snap.value_type,
              calculation_status: snap.calculation_status,
              created_at: snap.created_at,
            }
          : null,
        active_outbox_id: activeOutbox ? activeOutbox.id : null,
        active_outbox_status: activeOutbox ? activeOutbox.status : null,
        outbox_count_in_period: mappingOutbox.length,
        superseded_outbox_count: supersededOutboxes.length,
        scheduler_actions: mappingSubmitItems.map((i: any) => ({
          run_id: i.run_id,
          action: i.action,
          reason: i.reason,
          carry_forward_used: i.carry_forward_used,
          outbox_id: i.outbox_id,
          http_status: i.http_status,
          upstream_status_text: i.upstream_status_text,
          code: i.code,
          created_at: i.created_at,
        })),
      };
    });

    const summary = {
      mappings: mappings?.length ?? 0,
      snapshot_runs: snapRuns.length,
      snapshots_created: snapItems.filter((i: any) => i.action === "created").length,
      snapshot_not_ready: snapItems.filter((i: any) => i.calculation_status === "not_ready").length,
      submit_runs: submitRuns.length,
      outbox_created: submitItems.filter((i: any) => i.action === "outbox_created").length,
      outbox_reused: submitItems.filter((i: any) => i.action === "outbox_reused").length,
      submitted: submitItems.filter((i: any) => i.action === "submitted").length,
      failed: submitItems.filter((i: any) => i.action === "failed").length,
      skipped_no_snapshot: submitItems.filter((i: any) => i.action === "skipped_no_snapshot").length,
      already_submitted: submitItems.filter((i: any) => i.action === "already_submitted").length,
      anomalies: anomalies.length,
    };

    const out = {
      ok: true,
      generated_at: new Date().toISOString(),
      generated_by: callerId,
      filters: {
        organization_id: orgId,
        workspace_id: workspaceId,
        period_start: periodStart,
        period_end: periodEnd,
        external_kpi_ids: externalKpiIds,
        include_snapshot_protocol: includeSnap,
        include_submit_protocol: includeSubmit,
        include_outbox_history: includeOutbox,
        include_attempts: includeAttempts,
      },
      summary,
      mappings: mappingRollups,
      snapshot_protocol: includeSnap ? { runs: snapRuns, items: snapItems } : null,
      submission_protocol: includeSubmit ? { runs: submitRuns, items: submitItems } : null,
      outbox_history: includeOutbox ? outbox : null,
      attempts: includeAttempts ? attempts : null,
      anomalies,
      notes: [
        "Protocol is read-only audit; canonical KPI values remain in kpi_snapshots.",
        "Decrypted comments / action plans / string values are not exported; only *_present indicators.",
      ],
    };

    return json(out, cors, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return json({ ok: false, error: msg }, cors, 500);
  }
});
