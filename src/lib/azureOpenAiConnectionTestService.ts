/**
 * Phase 4D.14A.8A — Client wrapper for the azure-openai-test-connection
 * Edge Function.
 *
 * No Azure OpenAI calls happen in the browser. API keys and endpoints never
 * reach the client. All invocation failures map to a single fixed public
 * message; raw client-library text is never propagated to the UI.
 */

import { supabase } from "@/integrations/supabase/client";

export type AzureOpenAiTestClassification =
  | "connection_successful"
  | "credential_rejected"
  | "azure_openai_access_blocked"
  | "azure_openai_not_configured"
  | "azure_openai_endpoint_not_found"
  | "azure_openai_permission_denied"
  | "azure_openai_timeout"
  | "azure_openai_unavailable"
  | "azure_openai_rate_limited"
  | "azure_openai_response_invalid";

export interface AzureOpenAiConnectionTestResult {
  ok: boolean;
  classification: AzureOpenAiTestClassification;
  recommended_next_action: string;
  credential_accepted: boolean;
  api_accessible: boolean;
  http_status: number | null;
}

export const AZURE_OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE =
  "Azure OpenAI connection testing is temporarily unavailable.";

export async function runAzureOpenAiConnectionTest(
  organizationId: string,
): Promise<AzureOpenAiConnectionTestResult> {
  const { data, error } = await supabase.functions.invoke(
    "azure-openai-test-connection",
    { body: { organization_id: organizationId } },
  );
  if (error || !data) {
    throw new Error(AZURE_OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE);
  }
  return data as AzureOpenAiConnectionTestResult;
}
