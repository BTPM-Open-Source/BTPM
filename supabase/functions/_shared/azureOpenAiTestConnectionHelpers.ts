// Phase 4D.14A.8A — Azure OpenAI Test Connection classification helpers.
// Owns only the browser-safe classification vocabulary. Reuses provider-
// agnostic authority evaluation from the shared adminAuthority helper.

import type { AzureOpenAiConnectionTestCategory } from "./azureOpenAiConnectionTestClient.ts";
import { TenantAzureOpenAiError } from "./tenantAzureOpenAi.ts";

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

export interface AzureOpenAiTestClassificationEntry {
  classification: AzureOpenAiTestClassification;
  message: string;
  recommended_next_action: string;
  recorderResult: "success" | "failure" | "blocked";
  safeErrorCode: string | null;
}

const SUCCESS_MSG =
  "Connection successful. Azure OpenAI accepted the Tenant credential.";
const REC_ROTATE = "Check or rotate the Azure OpenAI Tenant API key.";
const REC_BLOCKED =
  "Azure OpenAI access is not allowed for this Organization or environment.";
const REC_NOT_CONFIGURED =
  "Configure and enable the Azure OpenAI Tenant integration.";
const REC_ENDPOINT_NOT_FOUND =
  "The Azure OpenAI endpoint could not be reached. Verify the resource endpoint.";
const REC_PERMISSION_DENIED =
  "The Azure OpenAI credential does not have permission to list models.";
const REC_TIMEOUT = "Azure OpenAI did not respond in time. Try again later.";
const REC_UNAVAILABLE =
  "Azure OpenAI connection testing is temporarily unavailable.";
const REC_RATE_LIMITED =
  "Azure OpenAI temporarily rate-limited the test. Try again later.";
const REC_RESPONSE_INVALID =
  "Azure OpenAI returned an unexpected response. Try again later.";

export const AZURE_TEST_ENTRIES: Record<
  AzureOpenAiTestClassification,
  AzureOpenAiTestClassificationEntry
> = {
  connection_successful: {
    classification: "connection_successful",
    message: SUCCESS_MSG,
    recommended_next_action: SUCCESS_MSG,
    recorderResult: "success",
    safeErrorCode: null,
  },
  credential_rejected: {
    classification: "credential_rejected",
    message: REC_ROTATE,
    recommended_next_action: REC_ROTATE,
    recorderResult: "failure",
    safeErrorCode: "credential_rejected",
  },
  azure_openai_access_blocked: {
    classification: "azure_openai_access_blocked",
    message: REC_BLOCKED,
    recommended_next_action: REC_BLOCKED,
    recorderResult: "blocked",
    safeErrorCode: "azure_openai_access_blocked",
  },
  azure_openai_not_configured: {
    classification: "azure_openai_not_configured",
    message: REC_NOT_CONFIGURED,
    recommended_next_action: REC_NOT_CONFIGURED,
    recorderResult: "failure",
    safeErrorCode: "azure_openai_not_configured",
  },
  azure_openai_endpoint_not_found: {
    classification: "azure_openai_endpoint_not_found",
    message: REC_ENDPOINT_NOT_FOUND,
    recommended_next_action: REC_ENDPOINT_NOT_FOUND,
    recorderResult: "failure",
    safeErrorCode: "azure_openai_endpoint_not_found",
  },
  azure_openai_permission_denied: {
    classification: "azure_openai_permission_denied",
    message: REC_PERMISSION_DENIED,
    recommended_next_action: REC_PERMISSION_DENIED,
    recorderResult: "failure",
    safeErrorCode: "azure_openai_permission_denied",
  },
  azure_openai_timeout: {
    classification: "azure_openai_timeout",
    message: REC_TIMEOUT,
    recommended_next_action: REC_TIMEOUT,
    recorderResult: "failure",
    safeErrorCode: "azure_openai_timeout",
  },
  azure_openai_unavailable: {
    classification: "azure_openai_unavailable",
    message: REC_UNAVAILABLE,
    recommended_next_action: REC_UNAVAILABLE,
    recorderResult: "failure",
    safeErrorCode: "azure_openai_unavailable",
  },
  azure_openai_rate_limited: {
    classification: "azure_openai_rate_limited",
    message: REC_RATE_LIMITED,
    recommended_next_action: REC_RATE_LIMITED,
    recorderResult: "failure",
    safeErrorCode: "azure_openai_rate_limited",
  },
  azure_openai_response_invalid: {
    classification: "azure_openai_response_invalid",
    message: REC_RESPONSE_INVALID,
    recommended_next_action: REC_RESPONSE_INVALID,
    recorderResult: "failure",
    safeErrorCode: "azure_openai_response_invalid",
  },
};

export function classifyAzureTransportResult(
  category: AzureOpenAiConnectionTestCategory,
): AzureOpenAiTestClassificationEntry {
  switch (category) {
    case "success":
      return AZURE_TEST_ENTRIES.connection_successful;
    case "credential_rejected":
      return AZURE_TEST_ENTRIES.credential_rejected;
    case "permission_denied":
      return AZURE_TEST_ENTRIES.azure_openai_permission_denied;
    case "endpoint_not_found":
      return AZURE_TEST_ENTRIES.azure_openai_endpoint_not_found;
    case "rate_limited":
      return AZURE_TEST_ENTRIES.azure_openai_rate_limited;
    case "timeout":
      return AZURE_TEST_ENTRIES.azure_openai_timeout;
    case "network_error":
    case "service_unavailable":
      return AZURE_TEST_ENTRIES.azure_openai_unavailable;
    case "response_invalid":
      return AZURE_TEST_ENTRIES.azure_openai_response_invalid;
  }
}

export function classifyAzureResolverError(
  err: unknown,
): AzureOpenAiTestClassificationEntry {
  if (!(err instanceof TenantAzureOpenAiError)) {
    return AZURE_TEST_ENTRIES.azure_openai_unavailable;
  }
  switch (err.code) {
    case "environment_action_blocked":
    case "secret_blocked":
      return AZURE_TEST_ENTRIES.azure_openai_access_blocked;
    case "integration_not_configured":
    case "integration_disabled":
    case "endpoint_missing":
    case "endpoint_invalid":
    case "secret_missing":
      return AZURE_TEST_ENTRIES.azure_openai_not_configured;
    case "organization_context_missing":
    case "organization_not_found":
    case "configuration_unavailable":
    default:
      return AZURE_TEST_ENTRIES.azure_openai_unavailable;
  }
}
