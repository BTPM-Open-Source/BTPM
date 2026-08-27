/**
 * Phase 4D.14A.7A — Client wrapper for the SharePoint Test Connection
 * Edge Function.
 *
 * No SharePoint or Microsoft identity calls happen in the browser. Tokens,
 * site IDs, and library identifiers never reach the client. Any invocation
 * failure maps to a single fixed public message; raw client-library /
 * transport / RPC / backend text is never propagated to the UI.
 */

import { supabase } from "@/integrations/supabase/client";

export type SharePointTestClassification =
  | "connection_successful"
  | "sharepoint_not_configured"
  | "sharepoint_graph_not_configured"
  | "sharepoint_access_blocked"
  | "sharepoint_permission_denied"
  | "sharepoint_graph_token_rejected"
  | "sharepoint_configuration_invalid"
  | "sharepoint_site_not_found"
  | "sharepoint_site_mismatch"
  | "sharepoint_libraries_unavailable"
  | "sharepoint_rate_limited"
  | "sharepoint_timeout"
  | "sharepoint_unavailable"
  | "sharepoint_response_invalid";


export interface SharePointConnectionTestResult {
  ok: boolean;
  classification: SharePointTestClassification;
  recommended_next_action: string;
  graph_token_acquired: boolean;
  site_resolved: boolean;
  site_matches_config: boolean;
  libraries_accessible: boolean;
  http_status: number | null;
}

export const SHAREPOINT_CONNECTION_TEST_UNAVAILABLE_MESSAGE =
  "SharePoint connection testing is temporarily unavailable.";

export async function runSharePointConnectionTest(
  organizationId: string,
): Promise<SharePointConnectionTestResult> {
  const { data, error } = await supabase.functions.invoke(
    "sharepoint-test-connection",
    { body: { organization_id: organizationId } },
  );
  if (error || !data) {
    throw new Error(SHAREPOINT_CONNECTION_TEST_UNAVAILABLE_MESSAGE);
  }
  return data as SharePointConnectionTestResult;
}
