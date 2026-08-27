// BTPM — Step C2-FIX.1
// Admin-only KPI App outbox reset (supersede a stuck/failed/queued row).
//
// Hard rules:
//   - Calls the admin-gated SECURITY DEFINER RPC reset_kpi_app_outbox.
//   - Never deletes rows; the original row + its audit history remain intact.
//   - Successful submissions cannot be reset (RPC enforces).
//   - All errors return as a structured result so the UI never throws.

import { supabase } from "@/integrations/supabase/client";

export interface OutboxResetResult {
  ok: boolean;
  outbox_id?: string;
  superseded_at?: string;
  already_superseded?: boolean;
  previous_status?: string;
  error?: string;
}

export function useKpiAppOutboxReset() {
  return {
    reset: async (
      outbox_id: string,
      reason?: string | null,
    ): Promise<OutboxResetResult> => {
      // The reset_kpi_app_outbox RPC was added by the C2-FIX.1 migration and
      // is not yet present in the generated Supabase types; cast to keep the
      // call typed against the runtime contract.
      const { data, error } = await (supabase as unknown as {
        rpc: (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message?: string } | null }>;
      }).rpc("reset_kpi_app_outbox", {
        _outbox_id: outbox_id,
        _reason: reason ?? null,
      });
      if (error) {
        return {
          ok: false,
          outbox_id,
          error: error.message || "Reset failed",
        };
      }
      const obj = (data ?? {}) as Record<string, unknown>;
      return {
        ok: obj.ok === true,
        outbox_id: (obj.outbox_id as string) ?? outbox_id,
        superseded_at: obj.superseded_at as string | undefined,
        already_superseded: obj.already_superseded === true,
        previous_status: obj.previous_status as string | undefined,
      };
    },
  };
}
