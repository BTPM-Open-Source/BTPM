/**
 * Phase 4D.14A.5A — Client wrapper for the openai-test-connection Edge
 * Function.
 *
 * No OpenAI calls happen in the browser. API keys never reach the client.
 * All invocation failures map to a single fixed public message; raw
 * client-library text (implementation detail, transport, RPC, URL, backend
 * body, exception message) is never propagated to the UI.
 */

import { supabase } from "@/integrations/supabase/client";

export type OpenAiTestClassification =
  | "connection_successful"
  | "credential_rejected"
  | "openai_access_blocked"
  | "openai_not_configured"
  | "openai_timeout"
  | "openai_unavailable"
  | "openai_rate_limited"
  | "openai_response_invalid";

export interface OpenAiConnectionTestResult {
  ok: boolean;
  classification: OpenAiTestClassification;
  recommended_next_action: string;
  credential_accepted: boolean;
  api_accessible: boolean;
  http_status: number | null;
}

export const OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE =
  "OpenAI connection testing is temporarily unavailable.";

export async function runOpenAiConnectionTest(
  organizationId: string,
): Promise<OpenAiConnectionTestResult> {
  const { data, error } = await supabase.functions.invoke(
    "openai-test-connection",
    { body: { organization_id: organizationId } },
  );
  if (error || !data) {
    throw new Error(OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE);
  }
  return data as OpenAiConnectionTestResult;
}
