/**
 * PBI 5.1A — Power BI Direct-reporting readiness client service.
 *
 * Read-only surface. Never sends, requests, or displays reporting credentials
 * or Vault material. Wraps `public.tenant_admin_get_powerbi_reporting_readiness`.
 */
import { supabase } from "@/integrations/supabase/client";

export type PowerBiReportingReadinessStatus =
  | "ready"
  | "disabled"
  | "revoked"
  | "not_provisioned"
  | "attention_required";

export interface PowerBiReportingReadinessTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface PowerBiReportingReadinessIdentity {
  login_role_name: string | null;
  mapping_state: string | null;
  role_exists: boolean;
  login_enabled: boolean;
  connection_limit: number | null;
  role_security_attributes_valid: boolean;
  membership_valid: boolean;
  session_defaults_valid: boolean;
  session_pooler_verified: boolean;
  session_user_verified: boolean;
  fail_closed_verified: boolean;
  provisioned_at: string | null;
  last_rotated_at: string | null;
  last_verified_at: string | null;
  credential_state: string | null;
}

export interface PowerBiReportingConnectionGuidance {
  host_hint: string;
  connection_method: string;
  port: number;
  database: string;
  connectivity_mode: string;
  notes: string;
}

export interface PowerBiReportingCoverageSummary {
  organization_count: number;
  organizations_with_reporting_scope: number;
  included_workspace_count: number;
  excluded_workspace_count: number;
  scoped_project_count: number;
}

export interface PowerBiReportingOrganizationCoverage {
  organization_id: string;
  organization_name: string;
  environment_role: string | null;
  total_workspace_count: number;
  included_workspace_count: number;
  excluded_workspace_count: number;
  unconfigured_workspace_count: number;
  scoped_project_count: number;
  scope_configured: boolean;
}

export interface PowerBiReportingLatestSafeEvent {
  event_type: string | null;
  event_at: string | null;
}

export interface PowerBiReportingReadiness {
  tenant: PowerBiReportingReadinessTenant;
  readiness_status: PowerBiReportingReadinessStatus;
  identity: PowerBiReportingReadinessIdentity;
  connection_guidance: PowerBiReportingConnectionGuidance;
  latest_safe_event: PowerBiReportingLatestSafeEvent;
  coverage_summary: PowerBiReportingCoverageSummary;
  organizations: PowerBiReportingOrganizationCoverage[];
}

export async function getPowerBiReportingReadiness(
  tenantId: string,
): Promise<PowerBiReportingReadiness> {
  const { data, error } = await supabase.rpc(
    "tenant_admin_get_powerbi_reporting_readiness",
    { _tenant_id: tenantId },
  );
  if (error) throw error;
  return data as unknown as PowerBiReportingReadiness;
}
