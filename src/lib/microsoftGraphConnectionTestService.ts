/**
 * Phase 4D.14A.6A — Client wrapper for the Microsoft Graph Test Connection
 * Edge Function.
 *
 * No Microsoft Graph or Microsoft identity calls happen in the browser.
 * Tokens, secrets, tenant IDs, and client IDs never reach the client. Any
 * invocation failure maps to a single fixed public message; raw client-
 * library/transport/RPC/backend text is never propagated to the UI.
 */

import { supabase } from "@/integrations/supabase/client";

export type MicrosoftGraphTestClassification =
  | "connection_successful"
  | "credential_rejected"
  | "microsoft_graph_access_blocked"
  | "microsoft_graph_not_configured"
  | "microsoft_graph_configuration_invalid"
  | "microsoft_graph_token_mismatch"
  | "microsoft_graph_application_permissions_missing"
  | "microsoft_graph_timeout"
  | "microsoft_graph_rate_limited"
  | "microsoft_graph_unavailable"
  | "microsoft_graph_response_invalid";

export interface MicrosoftGraphConnectionTestResult {
  ok: boolean;
  classification: MicrosoftGraphTestClassification;
  recommended_next_action: string;
  token_acquired: boolean;
  token_claims_match: boolean;
  application_permissions_present: boolean;
  graph_api_reachable: boolean;
  http_status: number | null;
}

export const MICROSOFT_GRAPH_CONNECTION_TEST_UNAVAILABLE_MESSAGE =
  "Microsoft Graph connection testing is temporarily unavailable.";

export async function runMicrosoftGraphConnectionTest(
  organizationId: string,
): Promise<MicrosoftGraphConnectionTestResult> {
  const { data, error } = await supabase.functions.invoke(
    "microsoft-graph-test-connection",
    { body: { organization_id: organizationId } },
  );
  if (error || !data) {
    throw new Error(MICROSOFT_GRAPH_CONNECTION_TEST_UNAVAILABLE_MESSAGE);
  }
  return data as MicrosoftGraphConnectionTestResult;
}
