// BTPM — Wave C2, Step C2.10
// Frontend hook to invoke the protected retry-kpi-app-submission Edge Function.
//
// Hard rules:
//   - Never construct payload rows on the frontend.
//   - Never read MuleSoft secrets.
//   - Never write to kpi_app_submission_outbox or kpi_app_submission_attempts directly.
//   - Never display decrypted comments / action plans / string values.
//   - No automatic retry. The user must explicitly trigger this hook.

import { supabase } from "@/integrations/supabase/client";

export type RetryResult = {
  ok: boolean;
  request_id?: string;
  outbox_id?: string;
  status?: string;
  retry_count?: number;
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

export function useKpiAppRetry() {
  return {
    retry: async (outbox_id: string): Promise<RetryResult> => {
      const { data, error } = await supabase.functions.invoke(
        "retry-kpi-app-submission",
        { body: { outbox_id } },
      );
      if (error) {
        const payload = (data ?? {}) as Record<string, unknown>;
        const message =
          (payload.error as string | undefined) ||
          error.message ||
          "Retry function invocation failed";
        return { ...(payload as object), ok: false, error: message } as RetryResult;
      }
      return data as RetryResult;
    },
  };
}
