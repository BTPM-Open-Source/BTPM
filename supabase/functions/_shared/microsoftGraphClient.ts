// Phase 4D.14A.6A — Transport-only Microsoft Graph client for the Test
// Connection Edge Function.
//
// This module NEVER:
//   - queries Supabase / Vault
//   - resolves Organization / Tenant context
//   - reads `M365_*` env vars
//   - caches tokens
//   - returns the token to browser code
//   - logs credentials, Authorization headers, raw response bodies,
//     Microsoft Tenant ID, client ID, role names, scopes, or claims.

// deno-lint-ignore-file no-explicit-any

import type { MicrosoftGraphRuntimeConfig } from "./tenantMicrosoftGraph.ts";

export type MicrosoftGraphTransportCategory =
  | "success"
  | "credential_rejected"
  | "access_forbidden"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "provider_unavailable"
  | "token_response_invalid";

export type MicrosoftGraphProbeCategory =
  | "success"
  | "credential_rejected"
  | "access_forbidden"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "graph_api_unavailable";

export interface AcquireTokenResult {
  category: MicrosoftGraphTransportCategory;
  httpStatus: number | null;
  accessToken: string | null;
}

export interface ProbeResult {
  category: MicrosoftGraphProbeCategory;
  httpStatus: number | null;
}

export interface SafeTokenClaimChecks {
  aud_is_graph_api: boolean;
  tenant_matches_config: boolean;
  client_matches_config: boolean;
  application_roles_present: boolean;
  application_roles_count: number;
}

export const GRAPH_TEST_TIMEOUT_MS = 20_000;
const COMPONENT = "microsoft-graph-connection-test";
const LOGIN_HOST = "login.microsoftonline.com";
const GRAPH_HOST = "graph.microsoft.com";
const GRAPH_METADATA_URL = "https://graph.microsoft.com/v1.0/$metadata";

function log(
  operation: string,
  host: string,
  requestId: string,
  fields: Record<string, unknown>,
) {
  const safe: Record<string, unknown> = {
    component: COMPONENT,
    operation,
    host,
    request_id: requestId,
  };
  for (const [k, v] of Object.entries(fields)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("authorization") ||
      lk.includes("token") ||
      lk.includes("secret") ||
      lk.includes("client_id") ||
      lk.includes("tenant") ||
      lk.includes("aud") ||
      lk.includes("appid") ||
      lk.includes("azp") ||
      lk.includes("roles") ||
      lk.includes("scope") ||
      lk.includes("drive") ||
      lk.includes("item") ||
      lk.includes("path") ||
      lk === "body" ||
      lk === "data" ||
      lk === "message"
    ) continue;
    safe[k] = v;
  }
  console.log(`[${COMPONENT}] ${operation}`, JSON.stringify(safe));
}


export function classifyTokenHttpStatus(
  status: number,
): MicrosoftGraphTransportCategory {
  if (status === 200) return "success";
  if (status === 400 || status === 401) return "credential_rejected";
  if (status === 403) return "access_forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "provider_unavailable";
  return "provider_unavailable";
}

export function classifyProbeHttpStatus(
  status: number,
): MicrosoftGraphProbeCategory {
  if (status >= 200 && status < 400) return "success";
  if (status === 401) return "credential_rejected";
  if (status === 403) return "access_forbidden";
  if (status === 429) return "rate_limited";
  return "graph_api_unavailable";
}

export function classifyTransportFailure(
  err: unknown,
): "timeout" | "network_error" {
  if (err && typeof err === "object" && "name" in err) {
    const name = String((err as { name?: unknown }).name ?? "");
    if (name === "AbortError" || name === "TimeoutError") return "timeout";
  }
  return "network_error";
}

function b64UrlDecode(input: string): string | null {
  try {
    const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
    const std = padded.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(std);
    // Convert binary string to UTF-8 string.
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Safe JWT payload extraction. Returns the raw claim object or null on
 * malformed input. Callers must not log or return the claims themselves.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const json = b64UrlDecode(parts[1]);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const GRAPH_AUD_ACCEPTED = new Set<string>([
  "https://graph.microsoft.com",
  "https://graph.microsoft.com/",
  "00000003-0000-0000-c000-000000000000",
]);

/**
 * Pure token-claim checker. Never returns claim values.
 */
export function summarizeGraphTokenClaims(
  claims: Record<string, unknown> | null,
  runtime: Pick<MicrosoftGraphRuntimeConfig, "microsoftTenantId" | "clientId">,
): SafeTokenClaimChecks {
  if (!claims) {
    return {
      aud_is_graph_api: false,
      tenant_matches_config: false,
      client_matches_config: false,
      application_roles_present: false,
      application_roles_count: 0,
    };
  }
  const aud = claims.aud;
  const tid = claims.tid;
  const appid = typeof claims.appid === "string" ? claims.appid : null;
  const azp = typeof claims.azp === "string" ? claims.azp : null;
  const rolesRaw = claims.roles;
  const roles = Array.isArray(rolesRaw)
    ? rolesRaw.filter((r) => typeof r === "string" && r.length > 0)
    : [];
  const appIdentity = appid ?? azp ?? null;
  return {
    aud_is_graph_api: typeof aud === "string" && GRAPH_AUD_ACCEPTED.has(aud),
    tenant_matches_config: typeof tid === "string" &&
      tid.toLowerCase() === runtime.microsoftTenantId.toLowerCase(),
    client_matches_config: !!appIdentity &&
      appIdentity.toLowerCase() === runtime.clientId.toLowerCase(),
    application_roles_present: roles.length > 0,
    application_roles_count: roles.length,
  };
}

export interface AcquireArgs {
  runtime: MicrosoftGraphRuntimeConfig;
  requestId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function acquireMicrosoftGraphToken(
  args: AcquireArgs,
): Promise<AcquireTokenResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? GRAPH_TEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url =
      `https://login.microsoftonline.com/${args.runtime.microsoftTenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: args.runtime.clientId,
      client_secret: args.runtime.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      const category = classifyTransportFailure(e);
      log("acquire_token", LOGIN_HOST, args.requestId, {
        result: category,
        http_status: null,
      });
      return { category, httpStatus: null, accessToken: null };
    }
    const status = response.status;
    if (status !== 200) {
      try {
        await response.text();
      } catch { /* ignore */ }
      const category = classifyTokenHttpStatus(status);
      log("acquire_token", LOGIN_HOST, args.requestId, {
        result: category,
        http_status: status,
      });
      return { category, httpStatus: status, accessToken: null };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      log("acquire_token", LOGIN_HOST, args.requestId, {
        result: "token_response_invalid",
        http_status: status,
      });
      return {
        category: "token_response_invalid",
        httpStatus: status,
        accessToken: null,
      };
    }
    const accessToken =
      parsed && typeof parsed === "object" &&
        typeof (parsed as { access_token?: unknown }).access_token === "string"
        ? (parsed as { access_token: string }).access_token
        : null;
    if (!accessToken || accessToken.length === 0) {
      log("acquire_token", LOGIN_HOST, args.requestId, {
        result: "token_response_invalid",
        http_status: status,
      });
      return {
        category: "token_response_invalid",
        httpStatus: status,
        accessToken: null,
      };
    }
    log("acquire_token", LOGIN_HOST, args.requestId, {
      result: "success",
      http_status: status,
    });
    return { category: "success", httpStatus: status, accessToken };
  } finally {
    clearTimeout(timer);
  }
}

export interface ProbeArgs {
  accessToken: string;
  requestId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function probeMicrosoftGraphApi(
  args: ProbeArgs,
): Promise<ProbeResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? GRAPH_TEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(GRAPH_METADATA_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${args.accessToken}` },
        signal: controller.signal,
      });
    } catch (e) {
      const category = classifyTransportFailure(e);
      log("graph_metadata_probe", GRAPH_HOST, args.requestId, {
        result: category,
        http_status: null,
      });
      return { category, httpStatus: null };
    }
    // Drain body without parsing or logging.
    try {
      await response.arrayBuffer();
    } catch { /* ignore */ }
    const category = classifyProbeHttpStatus(response.status);
    log("graph_metadata_probe", GRAPH_HOST, args.requestId, {
      result: category,
      http_status: response.status,
    });
    return { category, httpStatus: response.status };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Phase 4D.14A.6B — Transport-only runtime helpers.
// ============================================================
//
// These helpers perform authenticated Graph requests for runtime file
// reads (Decision Case evidence, Roadmap Story source files, Data
// Package bundle files). They:
//   - accept the access token explicitly (never resolve credentials);
//   - accept a server-controlled operation label;
//   - use bounded timeouts and follow redirects for `/content`;
//   - return safe normalized categories;
//   - never log tokens, Authorization headers, response bodies,
//     drive/item IDs, or full Graph paths.

export type MicrosoftGraphRuntimeOperation =
  | "download_decision_case_evidence"
  | "download_decision_case_bundle_file"
  | "download_roadmap_story_source";

export type MicrosoftGraphRuntimeFileCategory =
  | "success"
  | "access_forbidden"
  | "item_not_found"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "graph_unavailable"
  | "response_invalid";

export const GRAPH_RUNTIME_DOWNLOAD_TIMEOUT_MS = 60_000;

export interface DownloadDriveItemResult {
  ok: boolean;
  category: MicrosoftGraphRuntimeFileCategory;
  httpStatus: number | null;
  bytes: Uint8Array | null;
}

function classifyRuntimeFileHttpStatus(
  status: number,
): MicrosoftGraphRuntimeFileCategory {
  if (status >= 200 && status < 300) return "success";
  if (status === 401 || status === 403) return "access_forbidden";
  if (status === 404) return "item_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "graph_unavailable";
  return "graph_unavailable";
}

export interface DownloadDriveItemArgs {
  accessToken: string;
  driveId: string;
  itemId: string;
  operation: MicrosoftGraphRuntimeOperation;
  requestId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function downloadMicrosoftGraphDriveItemBytes(
  args: DownloadDriveItemArgs,
): Promise<DownloadDriveItemResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? GRAPH_RUNTIME_DOWNLOAD_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url =
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.itemId)}/content`;
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${args.accessToken}` },
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (e) {
      const cat = classifyTransportFailure(e);
      log(args.operation, GRAPH_HOST, args.requestId, {
        result: cat,
        http_status: null,
      });
      return { ok: false, category: cat, httpStatus: null, bytes: null };
    }
    const status = response.status;
    if (status < 200 || status >= 300) {
      try { await response.arrayBuffer(); } catch { /* ignore */ }
      const cat = classifyRuntimeFileHttpStatus(status);
      log(args.operation, GRAPH_HOST, args.requestId, {
        result: cat,
        http_status: status,
      });
      return { ok: false, category: cat, httpStatus: status, bytes: null };
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      log(args.operation, GRAPH_HOST, args.requestId, {
        result: "response_invalid",
        http_status: status,
      });
      return {
        ok: false,
        category: "response_invalid",
        httpStatus: status,
        bytes: null,
      };
    }
    log(args.operation, GRAPH_HOST, args.requestId, {
      result: "success",
      http_status: status,
    });
    return { ok: true, category: "success", httpStatus: status, bytes };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fixed-vocabulary safe public error for a runtime file download or a
 * token-acquisition failure that occurs during runtime Graph use.
 * Never contains identifiers, tokens, or raw Microsoft error text.
 */
export function toSafeGraphRuntimeFilePublicError(
  category: MicrosoftGraphRuntimeFileCategory,
): { error: "microsoft_graph_file_unavailable"; note: string } {
  return {
    error: "microsoft_graph_file_unavailable",
    note: "One or more selected SharePoint files could not be accessed.",
  };
}

/**
 * Fixed-vocabulary safe public error for a Graph token-acquisition
 * failure at runtime (Global-secret leakage avoided).
 */
export function toSafeGraphTokenAcquisitionPublicError(
  category: MicrosoftGraphTransportCategory,
): {
  error:
    | "microsoft_graph_not_configured"
    | "microsoft_graph_access_blocked"
    | "microsoft_graph_configuration_unavailable";
  note: string;
} {
  switch (category) {
    case "credential_rejected":
      return {
        error: "microsoft_graph_not_configured",
        note:
          "The Microsoft Graph Tenant integration is not configured or is incomplete.",
      };
    case "access_forbidden":
      return {
        error: "microsoft_graph_access_blocked",
        note:
          "Microsoft Graph access is not allowed for this Organization or environment.",
      };
    case "rate_limited":
    case "timeout":
    case "network_error":
    case "provider_unavailable":
    case "token_response_invalid":
    case "success":
    default:
      return {
        error: "microsoft_graph_configuration_unavailable",
        note: "Microsoft Graph configuration is temporarily unavailable.",
      };
  }
}
