// BTPM — Wave C2, Step C2.9b
// Manual Report Now — frontend orchestration hook.
//
// Responsibilities:
//   - Invoke the protected Edge Functions only:
//       * prepare-kpi-app-report-now (action: preview | create)
//       * build-kpi-app-payload      (action: dry_run | prepare)
//       * submit-kpi-app-payload     ({ outbox_id })
//
// Hard rules (C2.9b):
//   - Never construct payload rows on the frontend.
//   - Never read MuleSoft secrets / KPI_API_*.
//   - Never write directly to kpi_app_submission_outbox or
//     kpi_app_submission_attempts from the frontend.
//   - Never display decrypted comments / action_plans / string values.
//   - Never display the full payload body or full upstream response body.
//   - Never update kpi_app_mappings.last_* fields.
//   - No retry, no scheduler, no monitoring here.

import { supabase } from "@/integrations/supabase/client";

export type PreviewArgs = {
  mapping_id: string;
  reporting_period_start: string;
  reporting_period_end: string;
  validity_date: string;
};

export type PreviewResult = {
  ok: boolean;
  request_id?: string;
  action?: "preview";
  mapping_id?: string;
  reportable?: boolean;
  reason?: string;
  carry_forward_used?: boolean;
  carry_forward_allowed?: boolean | null;
  reporting_period_start?: string;
  reporting_period_end?: string;
  validity_date?: string;
  source_snapshot_id?: string;
  source_snapshot_period_start?: string;
  source_snapshot_period_end?: string;
  source_value_type?: "percent" | "number" | "currency" | "text";
  source_value_amount?: number | null;
  text_value_present?: boolean;
  comment_present?: boolean;
  action_plan_present?: boolean;
  external_kpi_id?: number | null;
  external_kpi_name?: string | null;
  scenario_id?: number;
  currency_id?: number;
  error?: string;
  status?: number;
};

export type CreateResult = {
  ok: boolean;
  request_id?: string;
  action?: "create";
  outbox_id?: string;
  reused_existing_outbox?: boolean;
  status?: string;
  source_snapshot_id?: string;
  carry_forward_used?: boolean;
  reporting_period_start?: string;
  reporting_period_end?: string;
  validity_date?: string;
  error?: string;
  http_status?: number;
};

export type DryRunResult = {
  ok: boolean;
  request_id?: string;
  action?: "dry_run";
  outbox_id?: string;
  payload_summary?: Record<string, unknown> | null;
  payload_hash?: string | null;
  payload_row_count?: number | null;
  carry_forward_used?: boolean;
  errors?: string[];
  error?: string;
};

export type PrepareResult = {
  ok: boolean;
  request_id?: string;
  action?: "prepare";
  outbox_id?: string;
  payload_summary?: Record<string, unknown> | null;
  payload_hash?: string | null;
  payload_row_count?: number | null;
  carry_forward_used?: boolean;
  errors?: string[];
  error?: string;
};

export type SubmitResult = {
  ok: boolean;
  request_id?: string;
  outbox_id?: string;
  status?: string;
  elapsed_ms?: number;
  upstream?: {
    status: number | null;
    status_text: string | null;
    body: unknown; // body_summary only — never full body
  };
  payload_summary?: Record<string, unknown> | null;
  payload_hash?: string | null;
  payload_row_count?: number | null;
  error?: string;
};

async function invokeFn<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // supabase-js wraps non-2xx as FunctionsHttpError. The JSON body lives on
    // error.context (a Response). Read it so governed errors (e.g. C2.10
    // "Outbox exists in a non-reusable state") surface to the UI instead of
    // bubbling up as a runtime error / blank screen.
    let payload: Record<string, unknown> = {};
    const ctx = (error as unknown as { context?: Response }).context;
    if (ctx && typeof ctx.clone === "function") {
      try {
        payload = (await ctx.clone().json()) as Record<string, unknown>;
      } catch {
        try {
          const txt = await ctx.clone().text();
          if (txt) payload = { error: txt };
        } catch {
          /* ignore */
        }
      }
    } else if (data && typeof data === "object") {
      payload = data as Record<string, unknown>;
    }
    const message =
      (payload.error as string | undefined) || error.message || "Function invocation failed";
    return {
      ...(payload as object),
      ok: false,
      error: message,
    } as T;
  }
  return data as T;
}

export function useKpiAppReportNow() {
  return {
    preview: (args: PreviewArgs) =>
      invokeFn<PreviewResult>("prepare-kpi-app-report-now", {
        ...args,
        action: "preview",
      }),
    createOutbox: (args: PreviewArgs) =>
      invokeFn<CreateResult>("prepare-kpi-app-report-now", {
        ...args,
        action: "create",
      }),
    dryRun: (outbox_id: string) =>
      invokeFn<DryRunResult>("build-kpi-app-payload", {
        outbox_id,
        action: "dry_run",
      }),
    prepare: (outbox_id: string) =>
      invokeFn<PrepareResult>("build-kpi-app-payload", {
        outbox_id,
        action: "prepare",
      }),
    submit: (outbox_id: string) =>
      invokeFn<SubmitResult>("submit-kpi-app-payload", { outbox_id }),
  };
}
