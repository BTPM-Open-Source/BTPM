/**
 * PBI 5.1B2A — Power BI reporting credential lifecycle client.
 *
 * Thin authenticated wrapper around the Edge Function
 * `powerbi-reporting-credential-lifecycle`. The one-time password returned by
 * credential-issuing actions is passed straight through to the caller and MUST
 * NOT be logged, persisted, cached, or serialized anywhere by this module.
 */
import { supabase } from "@/integrations/supabase/client";

export type PowerBiReportingLifecycleAction =
  | "provision"
  | "rotate"
  | "disable"
  | "enable"
  | "activate"
  | "revoke";

export interface PowerBiReportingLifecycleResult {
  action: PowerBiReportingLifecycleAction;
  tenant_id: string;
  login_role_name: string | null;
  mapping_state: string | null;
  credential_state: string | null;
  one_time_password?: string;
  password_display_once: boolean;
  verification_required?: boolean;
  next_action?: string;
  security_drift_detected?: boolean;
  terminated_session_count?: number;
}

export async function managePowerBiReportingIdentity(
  tenantId: string,
  action: PowerBiReportingLifecycleAction,
): Promise<PowerBiReportingLifecycleResult> {
  const { data, error } = await supabase.functions.invoke(
    "powerbi-reporting-credential-lifecycle",
    { body: { tenant_id: tenantId, action } },
  );

  if (error || !data) {
    throw new Error("Reporting credential lifecycle action failed.");
  }

  return data as PowerBiReportingLifecycleResult;
}
