// Phase 4D.14A.5A — Pure helpers for the OpenAI Test Connection Edge Function.
//
// The authority evaluation reuses `evaluateAuthority` from the shared
// adminAuthority helper (provider-agnostic). This module owns only the
// OpenAI-specific safe classification/message contracts and the mapping from
// transport results and resolver errors to those contracts.

import type { OpenAiConnectionTestCategory } from "./openAiConnectionTestClient.ts";
import { TenantOpenAiError } from "./tenantOpenAi.ts";

/** Safe classification tokens surfaced to the browser. Fixed vocabulary. */
export type OpenAiTestClassification =
  | "connection_successful"
  | "credential_rejected"
  | "openai_access_blocked"
  | "openai_not_configured"
  | "openai_timeout"
  | "openai_unavailable"
  | "openai_rate_limited"
  | "openai_response_invalid";

export interface OpenAiTestClassificationEntry {
  classification: OpenAiTestClassification;
  message: string;
  recommended_next_action: string;
  /** How to persist the outcome via the canonical recorder. */
  recorderResult: "success" | "failure" | "blocked";
  /** Safe classification token stored in tenant_integrations.last_error_message. */
  safeErrorCode: string | null;
}

const SUCCESS_MSG =
  "Connection successful. OpenAI accepted the Tenant credential.";
const REC_ROTATE =
  "Check or rotate the OpenAI Tenant integration API key.";
const REC_BLOCKED =
  "OpenAI access is not allowed for this Organization or environment.";
const REC_NOT_CONFIGURED =
  "Configure and enable the OpenAI Tenant integration.";
const REC_TIMEOUT = "OpenAI did not respond in time. Try again later.";
const REC_UNAVAILABLE =
  "OpenAI connection testing is temporarily unavailable.";
const REC_RATE_LIMITED =
  "OpenAI temporarily rate-limited the connection test. Try again later.";
const REC_RESPONSE_INVALID =
  "OpenAI returned an unexpected response. Try again later.";

export const OPENAI_TEST_ENTRIES: Record<
  OpenAiTestClassification,
  OpenAiTestClassificationEntry
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
  openai_access_blocked: {
    classification: "openai_access_blocked",
    message: REC_BLOCKED,
    recommended_next_action: REC_BLOCKED,
    recorderResult: "blocked",
    safeErrorCode: "openai_access_blocked",
  },
  openai_not_configured: {
    classification: "openai_not_configured",
    message: REC_NOT_CONFIGURED,
    recommended_next_action: REC_NOT_CONFIGURED,
    recorderResult: "failure",
    safeErrorCode: "openai_not_configured",
  },
  openai_timeout: {
    classification: "openai_timeout",
    message: REC_TIMEOUT,
    recommended_next_action: REC_TIMEOUT,
    recorderResult: "failure",
    safeErrorCode: "openai_timeout",
  },
  openai_unavailable: {
    classification: "openai_unavailable",
    message: REC_UNAVAILABLE,
    recommended_next_action: REC_UNAVAILABLE,
    recorderResult: "failure",
    safeErrorCode: "openai_unavailable",
  },
  openai_rate_limited: {
    classification: "openai_rate_limited",
    message: REC_RATE_LIMITED,
    recommended_next_action: REC_RATE_LIMITED,
    recorderResult: "failure",
    safeErrorCode: "openai_rate_limited",
  },
  openai_response_invalid: {
    classification: "openai_response_invalid",
    message: REC_RESPONSE_INVALID,
    recommended_next_action: REC_RESPONSE_INVALID,
    recorderResult: "failure",
    safeErrorCode: "openai_response_invalid",
  },
};

/** Map a transport result category to a safe test classification. */
export function classifyOpenAiTransportResult(
  category: OpenAiConnectionTestCategory,
): OpenAiTestClassificationEntry {
  switch (category) {
    case "success":
      return OPENAI_TEST_ENTRIES.connection_successful;
    case "credential_rejected":
      return OPENAI_TEST_ENTRIES.credential_rejected;
    case "access_forbidden":
      return OPENAI_TEST_ENTRIES.openai_access_blocked;
    case "rate_limited":
      return OPENAI_TEST_ENTRIES.openai_rate_limited;
    case "timeout":
      return OPENAI_TEST_ENTRIES.openai_timeout;
    case "network_error":
    case "provider_unavailable":
      return OPENAI_TEST_ENTRIES.openai_unavailable;
    case "invalid_response":
      return OPENAI_TEST_ENTRIES.openai_response_invalid;
  }
}

/**
 * Map a Tenant OpenAI runtime resolver error to a safe test classification.
 * Never inspects raw exception text — only the classified internal code.
 */
export function classifyOpenAiResolverError(
  err: unknown,
): OpenAiTestClassificationEntry {
  if (!(err instanceof TenantOpenAiError)) {
    return OPENAI_TEST_ENTRIES.openai_unavailable;
  }
  switch (err.code) {
    case "environment_action_blocked":
    case "secret_blocked":
      return OPENAI_TEST_ENTRIES.openai_access_blocked;
    case "integration_not_configured":
    case "integration_disabled":
    case "secret_missing":
      return OPENAI_TEST_ENTRIES.openai_not_configured;
    case "organization_context_missing":
    case "organization_not_found":
    case "configuration_unavailable":
    default:
      return OPENAI_TEST_ENTRIES.openai_unavailable;
  }
}
