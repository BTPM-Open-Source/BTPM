/**
 * Organization-level SharePoint site connection (one per org).
 *
 * Phase 4D.14A.7C — this row is now a system-maintained compatibility
 * projection derived from the effective Tenant SharePoint integration.
 * Manual upsert/disable is retired at the RPC layer (service_role only);
 * this module intentionally exposes only read + validate.
 */

import { supabase } from "@/integrations/supabase/client";

export type SharepointOrgSiteStatus =
  | "configured_unvalidated"
  | "validated"
  | "invalid"
  | "disabled";

export interface SharepointOrgSiteConnection {
  id: string;
  organization_id: string;
  connection_status: SharepointOrgSiteStatus;
  site_web_url: string;
  site_id: string | null;
  site_label_or_name: string | null;
  managed_outside_btpm: boolean;
  last_validated_at: string | null;
  last_validation_code: string | null;
  last_validation_note: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc: any = supabase.rpc.bind(supabase);

export async function getOrgSite(
  organizationId: string,
): Promise<SharepointOrgSiteConnection | null> {
  const { data, error } = await rpc("get_sharepoint_org_site", {
    _organization_id: organizationId,
  });
  if (error) throw error;
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as SharepointOrgSiteConnection) ?? null;
}

export interface OrgSiteValidationOutcome {
  status: "validated" | "invalid";
  code: string;
  note: string;
}

export async function validateOrgSite(
  connectionId: string,
): Promise<{ result: OrgSiteValidationOutcome; connection: SharepointOrgSiteConnection }> {
  const { data, error } = await supabase.functions.invoke("sharepoint-validate", {
    body: { action: "validate_org_site_connection", binding_id: connectionId },
  });
  if (error) throw new Error(error.message);
  return data as { result: OrgSiteValidationOutcome; connection: SharepointOrgSiteConnection };
}

