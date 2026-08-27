// Phase 4D.14A.6A — Pure helpers for the Microsoft Graph Test Connection.
//
// Owns the safe classification vocabulary and the mapping from resolver /
// transport / claim results to those classifications.

import type {
  MicrosoftGraphProbeCategory,
  MicrosoftGraphTransportCategory,
  SafeTokenClaimChecks,
} from "./microsoftGraphClient.ts";
import { TenantMicrosoftGraphError } from "./tenantMicrosoftGraph.ts";

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

export interface MicrosoftGraphTestClassificationEntry {
  classification: MicrosoftGraphTestClassification;
  message: string;
  recommended_next_action: string;
  recorderResult: "success" | "failure" | "blocked";
  safeErrorCode: string | null;
}

const SUCCESS_MSG =
  "Connection successful. Microsoft accepted the Tenant credential and the Microsoft Graph application token is valid.";
const REC_ROTATE =
  "Check or rotate the Microsoft Graph Tenant integration credentials.";
const REC_BLOCKED =
  "Microsoft Graph access is not allowed for this Organization or environment.";
const REC_NOT_CONFIGURED =
  "Configure and enable the Microsoft Graph Tenant integration.";
const REC_CONFIG_INVALID =
  "The Microsoft Graph Tenant integration configuration is invalid.";
const REC_MISMATCH =
  "Check that the configured Microsoft Tenant ID and application client ID belong to the same Microsoft application.";
const REC_ROLES =
  "Grant and admin-consent the required Microsoft Graph application permissions.";
const REC_TIMEOUT = "Microsoft Graph did not respond in time. Try again later.";
const REC_RATE = "Microsoft temporarily rate-limited the test. Try again later.";
const REC_UNAVAIL =
  "Microsoft Graph connection testing is temporarily unavailable.";
const REC_RESP_INVALID =
  "Microsoft returned an unexpected authentication response. Try again later.";

export const GRAPH_TEST_ENTRIES: Record<
  MicrosoftGraphTestClassification,
  MicrosoftGraphTestClassificationEntry
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
  microsoft_graph_access_blocked: {
    classification: "microsoft_graph_access_blocked",
    message: REC_BLOCKED,
    recommended_next_action: REC_BLOCKED,
    recorderResult: "blocked",
    safeErrorCode: "microsoft_graph_access_blocked",
  },
  microsoft_graph_not_configured: {
    classification: "microsoft_graph_not_configured",
    message: REC_NOT_CONFIGURED,
    recommended_next_action: REC_NOT_CONFIGURED,
    recorderResult: "failure",
    safeErrorCode: "microsoft_graph_not_configured",
  },
  microsoft_graph_configuration_invalid: {
    classification: "microsoft_graph_configuration_invalid",
    message: REC_CONFIG_INVALID,
    recommended_next_action: REC_CONFIG_INVALID,
    recorderResult: "failure",
    safeErrorCode: "microsoft_graph_configuration_invalid",
  },
  microsoft_graph_token_mismatch: {
    classification: "microsoft_graph_token_mismatch",
    message: REC_MISMATCH,
    recommended_next_action: REC_MISMATCH,
    recorderResult: "failure",
    safeErrorCode: "microsoft_graph_token_mismatch",
  },
  microsoft_graph_application_permissions_missing: {
    classification: "microsoft_graph_application_permissions_missing",
    message: REC_ROLES,
    recommended_next_action: REC_ROLES,
    recorderResult: "failure",
    safeErrorCode: "microsoft_graph_application_permissions_missing",
  },
  microsoft_graph_timeout: {
    classification: "microsoft_graph_timeout",
    message: REC_TIMEOUT,
    recommended_next_action: REC_TIMEOUT,
    recorderResult: "failure",
    safeErrorCode: "microsoft_graph_timeout",
  },
  microsoft_graph_rate_limited: {
    classification: "microsoft_graph_rate_limited",
    message: REC_RATE,
    recommended_next_action: REC_RATE,
    recorderResult: "failure",
    safeErrorCode: "microsoft_graph_rate_limited",
  },
  microsoft_graph_unavailable: {
    classification: "microsoft_graph_unavailable",
    message: REC_UNAVAIL,
    recommended_next_action: REC_UNAVAIL,
    recorderResult: "failure",
    safeErrorCode: "microsoft_graph_unavailable",
  },
  microsoft_graph_response_invalid: {
    classification: "microsoft_graph_response_invalid",
    message: REC_RESP_INVALID,
    recommended_next_action: REC_RESP_INVALID,
    recorderResult: "failure",
    safeErrorCode: "microsoft_graph_response_invalid",
  },
};

export function classifyGraphResolverError(
  err: unknown,
): MicrosoftGraphTestClassificationEntry {
  if (!(err instanceof TenantMicrosoftGraphError)) {
    return GRAPH_TEST_ENTRIES.microsoft_graph_unavailable;
  }
  switch (err.code) {
    case "environment_action_blocked":
    case "secret_blocked":
      return GRAPH_TEST_ENTRIES.microsoft_graph_access_blocked;
    case "integration_not_configured":
    case "integration_disabled":
    case "secret_missing":
      return GRAPH_TEST_ENTRIES.microsoft_graph_not_configured;
    case "identifier_invalid":
      return GRAPH_TEST_ENTRIES.microsoft_graph_configuration_invalid;
    case "organization_context_missing":
    case "organization_not_found":
    case "configuration_unavailable":
    default:
      return GRAPH_TEST_ENTRIES.microsoft_graph_unavailable;
  }
}

/** Map a token-acquisition transport result to a safe classification. */
export function classifyGraphTokenTransport(
  category: MicrosoftGraphTransportCategory,
): MicrosoftGraphTestClassificationEntry {
  switch (category) {
    case "success":
      return GRAPH_TEST_ENTRIES.connection_successful;
    case "credential_rejected":
      return GRAPH_TEST_ENTRIES.credential_rejected;
    case "access_forbidden":
      return GRAPH_TEST_ENTRIES.microsoft_graph_access_blocked;
    case "rate_limited":
      return GRAPH_TEST_ENTRIES.microsoft_graph_rate_limited;
    case "timeout":
      return GRAPH_TEST_ENTRIES.microsoft_graph_timeout;
    case "network_error":
    case "provider_unavailable":
      return GRAPH_TEST_ENTRIES.microsoft_graph_unavailable;
    case "token_response_invalid":
      return GRAPH_TEST_ENTRIES.microsoft_graph_response_invalid;
  }
}

/** Map a Graph API probe result to a safe classification. */
export function classifyGraphProbe(
  category: MicrosoftGraphProbeCategory,
): MicrosoftGraphTestClassificationEntry {
  switch (category) {
    case "success":
      return GRAPH_TEST_ENTRIES.connection_successful;
    case "credential_rejected":
      return GRAPH_TEST_ENTRIES.credential_rejected;
    case "access_forbidden":
      return GRAPH_TEST_ENTRIES.microsoft_graph_access_blocked;
    case "rate_limited":
      return GRAPH_TEST_ENTRIES.microsoft_graph_rate_limited;
    case "timeout":
      return GRAPH_TEST_ENTRIES.microsoft_graph_timeout;
    case "network_error":
    case "graph_api_unavailable":
    default:
      return GRAPH_TEST_ENTRIES.microsoft_graph_unavailable;
  }
}

export interface EvaluateSuccessArgs {
  tokenCategory: MicrosoftGraphTransportCategory;
  claimChecks: SafeTokenClaimChecks;
  probeCategory: MicrosoftGraphProbeCategory | null;
}

/**
 * Canonical success contract. Returns the compact classification entry that
 * must be surfaced to the browser and persisted. Only `connection_successful`
 * requires ALL of: token success, matching audience, matching tenant/client,
 * at least one application role, and a reachable Graph metadata endpoint.
 */
export function evaluateGraphTestOutcome(
  args: EvaluateSuccessArgs,
): MicrosoftGraphTestClassificationEntry {
  if (args.tokenCategory !== "success") {
    return classifyGraphTokenTransport(args.tokenCategory);
  }
  const c = args.claimChecks;
  if (!c.aud_is_graph_api) {
    return GRAPH_TEST_ENTRIES.microsoft_graph_token_mismatch;
  }
  if (!c.tenant_matches_config || !c.client_matches_config) {
    return GRAPH_TEST_ENTRIES.microsoft_graph_token_mismatch;
  }
  if (!c.application_roles_present) {
    return GRAPH_TEST_ENTRIES.microsoft_graph_application_permissions_missing;
  }
  if (!args.probeCategory) {
    return GRAPH_TEST_ENTRIES.microsoft_graph_unavailable;
  }
  if (args.probeCategory !== "success") {
    return classifyGraphProbe(args.probeCategory);
  }
  return GRAPH_TEST_ENTRIES.connection_successful;
}
