// Phase 4D.14A.7A — Pure helpers for the SharePoint Test Connection.
//
// Owns the safe classification vocabulary and the mapping from resolver /
// transport / library-listing results to those classifications.

import type {
  SharePointResolveErrorCode,
} from "./tenantSharePoint.ts";
import { TenantSharePointError } from "./tenantSharePoint.ts";
import type { SharePointTransportCategory } from "./sharePointClient.ts";

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


export interface SharePointTestClassificationEntry {
  classification: SharePointTestClassification;
  message: string;
  recommended_next_action: string;
  recorderResult: "success" | "failure" | "blocked";
  safeErrorCode: string | null;
}

const SUCCESS_MSG =
  "Connection successful. The configured SharePoint site and its document libraries are accessible.";
const REC_NOT_CONFIGURED =
  "Configure and enable the SharePoint Tenant integration.";
const REC_GRAPH_NOT_CONFIGURED =
  "Configure and enable the Microsoft Graph Tenant integration.";
const REC_BLOCKED =
  "SharePoint access is not allowed for this Organization or environment.";
const REC_CONFIG_INVALID =
  "Check the SharePoint Tenant integration site URL and optional site ID.";
const REC_SITE_NOT_FOUND =
  "Check that the configured SharePoint site exists and that the application has access.";
const REC_SITE_MISMATCH =
  "The configured SharePoint site ID does not match the configured site URL.";
const REC_LIBRARIES =
  "Grant the Microsoft Graph application access to at least one document library on the configured site.";
const REC_RATE =
  "Microsoft temporarily rate-limited the SharePoint test. Try again later.";
const REC_TIMEOUT = "SharePoint did not respond in time. Try again later.";
const REC_UNAVAIL = "SharePoint connection testing is temporarily unavailable.";
const REC_RESP_INVALID =
  "Microsoft Graph returned an unexpected SharePoint response.";
const REC_PERMISSION_DENIED =
  "Grant the Microsoft Graph application permission to access the configured SharePoint site and its document libraries.";
const REC_TOKEN_REJECTED =
  "Microsoft Graph rejected the token for SharePoint access. Retest the Microsoft Graph integration and verify its application permissions.";


export const SHAREPOINT_TEST_ENTRIES: Record<
  SharePointTestClassification,
  SharePointTestClassificationEntry
> = {
  connection_successful: {
    classification: "connection_successful",
    message: SUCCESS_MSG,
    recommended_next_action: SUCCESS_MSG,
    recorderResult: "success",
    safeErrorCode: null,
  },
  sharepoint_not_configured: {
    classification: "sharepoint_not_configured",
    message: REC_NOT_CONFIGURED,
    recommended_next_action: REC_NOT_CONFIGURED,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_not_configured",
  },
  sharepoint_graph_not_configured: {
    classification: "sharepoint_graph_not_configured",
    message: REC_GRAPH_NOT_CONFIGURED,
    recommended_next_action: REC_GRAPH_NOT_CONFIGURED,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_graph_not_configured",
  },
  sharepoint_access_blocked: {
    classification: "sharepoint_access_blocked",
    message: REC_BLOCKED,
    recommended_next_action: REC_BLOCKED,
    recorderResult: "blocked",
    safeErrorCode: "sharepoint_access_blocked",
  },
  sharepoint_permission_denied: {
    classification: "sharepoint_permission_denied",
    message: REC_PERMISSION_DENIED,
    recommended_next_action: REC_PERMISSION_DENIED,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_permission_denied",
  },
  sharepoint_graph_token_rejected: {
    classification: "sharepoint_graph_token_rejected",
    message: REC_TOKEN_REJECTED,
    recommended_next_action: REC_TOKEN_REJECTED,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_graph_token_rejected",
  },
  sharepoint_configuration_invalid: {
    classification: "sharepoint_configuration_invalid",
    message: REC_CONFIG_INVALID,

    recommended_next_action: REC_CONFIG_INVALID,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_configuration_invalid",
  },
  sharepoint_site_not_found: {
    classification: "sharepoint_site_not_found",
    message: REC_SITE_NOT_FOUND,
    recommended_next_action: REC_SITE_NOT_FOUND,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_site_not_found",
  },
  sharepoint_site_mismatch: {
    classification: "sharepoint_site_mismatch",
    message: REC_SITE_MISMATCH,
    recommended_next_action: REC_SITE_MISMATCH,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_site_mismatch",
  },
  sharepoint_libraries_unavailable: {
    classification: "sharepoint_libraries_unavailable",
    message: REC_LIBRARIES,
    recommended_next_action: REC_LIBRARIES,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_libraries_unavailable",
  },
  sharepoint_rate_limited: {
    classification: "sharepoint_rate_limited",
    message: REC_RATE,
    recommended_next_action: REC_RATE,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_rate_limited",
  },
  sharepoint_timeout: {
    classification: "sharepoint_timeout",
    message: REC_TIMEOUT,
    recommended_next_action: REC_TIMEOUT,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_timeout",
  },
  sharepoint_unavailable: {
    classification: "sharepoint_unavailable",
    message: REC_UNAVAIL,
    recommended_next_action: REC_UNAVAIL,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_unavailable",
  },
  sharepoint_response_invalid: {
    classification: "sharepoint_response_invalid",
    message: REC_RESP_INVALID,
    recommended_next_action: REC_RESP_INVALID,
    recorderResult: "failure",
    safeErrorCode: "sharepoint_response_invalid",
  },
};

/** Map a SharePoint resolver failure to a safe classification. */
export function classifySharePointResolverError(
  err: unknown,
): SharePointTestClassificationEntry {
  if (!(err instanceof TenantSharePointError)) {
    return SHAREPOINT_TEST_ENTRIES.sharepoint_unavailable;
  }
  const code: SharePointResolveErrorCode = err.code;
  switch (code) {
    case "environment_action_blocked":
    case "secret_blocked":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_access_blocked;
    case "integration_not_configured":
    case "integration_disabled":
    case "secret_missing":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_not_configured;
    case "site_url_invalid":
    case "site_id_invalid":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_configuration_invalid;
    case "organization_context_missing":
    case "organization_not_found":
    case "configuration_unavailable":
    default:
      return SHAREPOINT_TEST_ENTRIES.sharepoint_unavailable;
  }
}

/** Map a Graph token/config failure surfaced by the Graph runtime bootstrap. */
export function classifyGraphDependencyPublicError(
  publicErrorCode:
    | "microsoft_graph_not_configured"
    | "microsoft_graph_access_blocked"
    | "microsoft_graph_configuration_invalid"
    | "microsoft_graph_configuration_unavailable",
): SharePointTestClassificationEntry {
  switch (publicErrorCode) {
    case "microsoft_graph_access_blocked":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_access_blocked;
    case "microsoft_graph_not_configured":
    case "microsoft_graph_configuration_invalid":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_graph_not_configured;
    case "microsoft_graph_configuration_unavailable":
    default:
      return SHAREPOINT_TEST_ENTRIES.sharepoint_unavailable;
  }
}

/** Map a SharePoint transport category to a safe classification. */
export function classifySharePointTransport(
  category: SharePointTransportCategory,
): SharePointTestClassificationEntry {
  switch (category) {
    case "success":
      return SHAREPOINT_TEST_ENTRIES.connection_successful;
    case "permission_denied":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_permission_denied;
    case "token_rejected":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_graph_token_rejected;

    case "site_not_found":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_site_not_found;
    case "site_mismatch":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_site_mismatch;
    case "libraries_not_found":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_libraries_unavailable;
    case "rate_limited":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_rate_limited;
    case "timeout":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_timeout;
    case "network_error":
    case "graph_unavailable":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_unavailable;
    case "response_invalid":
      return SHAREPOINT_TEST_ENTRIES.sharepoint_response_invalid;
  }
}

export interface EvaluateSharePointOutcomeArgs {
  siteCategory: SharePointTransportCategory;
  librariesCategory: SharePointTransportCategory | null;
}

/**
 * Canonical success contract. Success requires site resolution success
 * AND at least one accessible library.
 */
export function evaluateSharePointTestOutcome(
  args: EvaluateSharePointOutcomeArgs,
): SharePointTestClassificationEntry {
  if (args.siteCategory !== "success") {
    return classifySharePointTransport(args.siteCategory);
  }
  if (!args.librariesCategory) {
    return SHAREPOINT_TEST_ENTRIES.sharepoint_unavailable;
  }
  if (args.librariesCategory !== "success") {
    return classifySharePointTransport(args.librariesCategory);
  }
  return SHAREPOINT_TEST_ENTRIES.connection_successful;
}
