// BTPM — Wave C1, Step C1.6a
// Server-authoritative KPI snapshot capture.
//
// Authority model:
//   1. Frontend can REQUEST a capture but cannot supply value, calculation_key,
//      formula_version, source_mode, generated_by, period, or source data.
//   2. This function:
//        a) Authenticates the caller (user JWT).
//        b) Verifies capture authority via SECURITY DEFINER RPC
//           `can_capture_kpi_snapshot` (mirrors prior kpi_snap_insert_pm RLS).
//        c) Loads the kpi_definition server-side (service-role).
//        d) Resolves the period server-side.
//        e) Sources the value:
//             - manual    → latest kpi_updates via get_latest_manual_kpi_value RPC
//             - automatic → C1.4 calculation engine using stored calculation_key
//        f) Inserts ONE kpi_snapshots row using the service-role client.
//   3. Direct authenticated INSERT into kpi_snapshots is blocked at the DB layer
//      (kpi_snap_insert_pm dropped in C1.6a migration).
//
// Shared code: imports the same C1.4 engine the app uses, via relative .ts
// paths. No formula logic is duplicated.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { buildBrowserCorsHeaders } from "../_shared/browserCors.ts";
import { calculateAutomaticKpi } from "../_shared/kpi/kpiCalculationEngine.ts";
import { buildKpiCalculationInput } from "../_shared/kpi/kpiCalculationDataAdapter.ts";
import { resolveKpiPeriod, type KpiCadence } from "../_shared/kpi/kpiPeriod.ts";
import {
  getAutomaticKpiDefinition,
  type AutomaticKpiCalculationKey,
} from "../_shared/kpi/automaticKpiLibrary.ts";
import type { KpiCompletionMethod } from "../_shared/kpi/kpiCalculationTypes.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

function json(data: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIsoUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  const corsHeaders = buildBrowserCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, corsHeaders, 405);
  }

  try {
    // 1) Auth header.
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, corsHeaders, 401);

    // 2) Resolve environment and construct caller-scoped client (pre-guard).
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json(
        { error: "Edge Function is not configured (missing Supabase env vars)" },
        corsHeaders,
        500,
      );
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // 3) Browser-session-only OAuth denial guard (API-E.R4AA).
    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    // 4) Parse and validate body. Only allowed fields are accepted.
    const body = await req.json().catch(() => ({}));
    const kpiDefinitionId: unknown = body?.kpi_definition_id;
    const snapshotDateRaw: unknown = body?.snapshot_date;
    const commentRaw: unknown = body?.comment;
    const actionPlanRaw: unknown = body?.action_plan;

    if (typeof kpiDefinitionId !== "string" || !UUID_RE.test(kpiDefinitionId)) {
      return json({ error: "Invalid kpi_definition_id" }, corsHeaders, 400);
    }
    let snapshotDate: string = todayIsoUtc();
    if (snapshotDateRaw != null) {
      if (typeof snapshotDateRaw !== "string" || !ISO_DATE_RE.test(snapshotDateRaw)) {
        return json({ error: "snapshot_date must be YYYY-MM-DD" }, corsHeaders, 400);
      }
      snapshotDate = snapshotDateRaw;
    }
    const comment: string | null =
      typeof commentRaw === "string" && commentRaw.trim() ? commentRaw.trim() : null;
    const actionPlan: string | null =
      typeof actionPlanRaw === "string" && actionPlanRaw.trim() ? actionPlanRaw.trim() : null;

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized" }, corsHeaders, 401);
    }
    const userId = userData.user.id;

    // 4) Permission check via SECURITY DEFINER RPC (mirrors prior RLS predicate).
    const { data: canCapture, error: permErr } = await userClient.rpc(
      // @ts-ignore — RPC name not in generated types yet
      "can_capture_kpi_snapshot",
      { _kpi_definition_id: kpiDefinitionId },
    );
    if (permErr) {
      return json({ error: "Permission check failed" }, corsHeaders, 500);
    }
    if (canCapture !== true) {
      return json({ error: "Forbidden" }, corsHeaders, 403);
    }

    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // 5) Load KPI definition server-side (service-role; can_capture already passed).
    const { data: defRow, error: defErr } = await serviceClient
      .from("kpi_definitions")
      .select(
        "id,name,target_type,target_id,workspace_id,organization_id,source_mode,value_type,cadence,calculation_key,formula_version,completion_method,comment_required,action_plan_required,is_archived",
      )
      .eq("id", kpiDefinitionId)
      .maybeSingle();
    if (defErr) return json({ error: defErr.message }, corsHeaders, 500);
    if (!defRow) return json({ error: "KPI definition not found" }, corsHeaders, 404);
    if (defRow.is_archived) {
      return json({ error: "Cannot capture snapshot for an archived KPI" }, corsHeaders, 409);
    }
    if (defRow.target_type !== "project") {
      return json({ error: "Only project-scoped KPIs are supported in v1" }, corsHeaders, 400);
    }
    const projectId: string = defRow.target_id;

    // 6) Enforce required narrative fields.
    if (defRow.comment_required && !comment) {
      return json({ error: "This KPI requires a comment" }, corsHeaders, 400);
    }
    if (defRow.action_plan_required && !actionPlan) {
      return json({ error: "This KPI requires an action plan" }, corsHeaders, 400);
    }

    // 7) Resolve period.
    const { periodStart, periodEnd } = resolveKpiPeriod(
      (defRow.cadence ?? "manual_only") as KpiCadence,
      snapshotDate,
    );

    let valueAmount: number | null = null;
    let stringValue: string | null = null;
    let calculationStatus: string;
    let generatedBy: "user" | "system";
    let calculationKey: string | null = defRow.calculation_key;
    let formulaVersion: number | null = defRow.formula_version;

    if (defRow.source_mode === "manual") {
      // 7a) Manual KPI: source from latest kpi_updates row via SECURITY DEFINER RPC.
      generatedBy = "user";
      calculationKey = null;
      formulaVersion = null;
      const { data: latest, error: latestErr } = await userClient.rpc(
        "get_latest_manual_kpi_value",
        { _kpi_definition_id: kpiDefinitionId },
      );
      if (latestErr) return json({ error: latestErr.message }, corsHeaders, 500);
      if (!latest) {
        calculationStatus = "no_source_data";
      } else {
        const v = (latest as any).value;
        if (defRow.value_type === "text") {
          stringValue = v != null ? String(v) : null;
          valueAmount = null;
        } else {
          valueAmount = typeof v === "number" ? v : v != null ? Number(v) : null;
          stringValue = null;
        }
        calculationStatus = "manual_entry";
      }
    } else if (defRow.source_mode === "automatic") {
      // 7b) Automatic KPI: use stored calculation_key with the C1.4 engine.
      generatedBy = "system";
      if (!defRow.calculation_key) {
        return json({ error: "Automatic KPI is missing a calculation_key" }, corsHeaders, 409);
      }
      const meta = getAutomaticKpiDefinition(
        defRow.calculation_key as AutomaticKpiCalculationKey,
      );
      if (!meta) {
        return json(
          { error: `Unknown calculation_key: ${defRow.calculation_key}` },
          corsHeaders,
          409,
        );
      }
      const calcInput = await buildKpiCalculationInput(
        serviceClient as any,
        projectId,
        { snapshotDate },
      );
      const result = calculateAutomaticKpi(
        defRow.calculation_key as AutomaticKpiCalculationKey,
        calcInput,
        {
          completionMethod: (defRow.completion_method as KpiCompletionMethod | null) ?? null,
          formulaVersion: defRow.formula_version ?? undefined,
        },
      );
      if (result.calculationStatus === "error") {
        return json(
          { error: result.calculationMessage ?? "Calculation failed" },
          corsHeaders,
          422,
        );
      }
      valueAmount = result.valueAmount;
      stringValue = result.stringValue;
      calculationStatus = result.calculationStatus;
      formulaVersion = result.formulaVersion;
    } else {
      return json(
        { error: `Unsupported source_mode: ${defRow.source_mode}` },
        corsHeaders,
        400,
      );
    }

    // 8) Insert the snapshot (service-role bypasses RLS; encryption trigger encrypts narratives).
    const insertPayload = {
      organization_id: defRow.organization_id,
      workspace_id: defRow.workspace_id,
      project_id: projectId,
      kpi_definition_id: defRow.id,
      snapshot_date: snapshotDate,
      period_start: periodStart,
      period_end: periodEnd,
      source_mode: defRow.source_mode,
      value_type: defRow.value_type ?? "number",
      value_amount: valueAmount,
      string_value: stringValue,
      comment,
      action_plan: actionPlan,
      calculation_key: calculationKey,
      formula_version: formulaVersion,
      calculation_status: calculationStatus,
      generated_by: generatedBy,
      created_by: userId,
    };

    const { data: inserted, error: insErr } = await serviceClient
      .from("kpi_snapshots")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insErr) return json({ error: insErr.message }, corsHeaders, 500);

    return json(
      {
        snapshot_id: inserted!.id,
        calculation_status: calculationStatus,
        value_amount: valueAmount,
        string_value: stringValue,
      },
      corsHeaders,
      200,
    );
  } catch (e) {
    return json({ error: "Internal error: " + (e as Error).message }, corsHeaders, 500);
  }
});
