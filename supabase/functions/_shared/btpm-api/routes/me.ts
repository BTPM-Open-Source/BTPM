// API-G.2D — Pure route contract for GET /v1/me.
// ME-2 — Adds the strict optional context query parser.
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable
// global state.

import { ApiHttpError } from "../http.ts";

export const ME_ROUTE = Object.freeze({
  id: "me.get",
  method: "GET",
  path: "/v1/me",
  operation: "read",
} as const);

/** Exact accepted context types. No aliases, no normalization. */
export const ME_CONTEXT_TYPES = Object.freeze(
  ["organization", "workspace", "project"] as const,
);

export type ApiV1MeContextType = typeof ME_CONTEXT_TYPES[number];

/** Parsed `/v1/me` query. Both fields are present or both are null. */
export interface ApiV1MeQuery {
  readonly contextType: ApiV1MeContextType | null;
  readonly contextId: string | null;
}

const ALLOWED_PARAM_NAMES: ReadonlySet<string> = new Set([
  "contextType",
  "contextId",
]);

const NON_NIL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const EMPTY_QUERY: ApiV1MeQuery = Object.freeze({
  contextType: null,
  contextId: null,
}) as ApiV1MeQuery;

function assertValidPercentEncoding(raw: string): void {
  try {
    decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    throw new ApiHttpError("invalid_request");
  }
}

function isAcceptedContextType(value: string): value is ApiV1MeContextType {
  for (const accepted of ME_CONTEXT_TYPES) {
    if (accepted === value) return true;
  }
  return false;
}

/**
 * Parse the raw `/v1/me` query string. Accepts either no parameters, or
 * exactly `contextType` and `contextId` together. Unknown parameters,
 * duplicated parameters, partial combinations, unknown context types and
 * malformed or nil UUIDs are rejected as `invalid_request`.
 */
export function parseApiV1MeQuery(rawSearch: string): ApiV1MeQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (rawSearch === "" || rawSearch === "?") {
    return EMPTY_QUERY;
  }

  if (!rawSearch.startsWith("?")) {
    throw new ApiHttpError("invalid_request");
  }

  if (rawSearch.includes("#")) {
    throw new ApiHttpError("invalid_request");
  }

  assertValidPercentEncoding(rawSearch.slice(1));

  const params = new URLSearchParams(rawSearch);

  for (const name of params.keys()) {
    if (!ALLOWED_PARAM_NAMES.has(name)) {
      throw new ApiHttpError("invalid_request");
    }
    if (params.getAll(name).length > 1) {
      throw new ApiHttpError("invalid_request");
    }
  }

  const rawType = params.get("contextType");
  const rawId = params.get("contextId");

  if (rawType === null && rawId === null) {
    return EMPTY_QUERY;
  }
  if (rawType === null || rawId === null) {
    throw new ApiHttpError("invalid_request");
  }
  if (!isAcceptedContextType(rawType)) {
    throw new ApiHttpError("invalid_request");
  }
  if (!NON_NIL_UUID_REGEX.test(rawId) || rawId === NIL_UUID) {
    throw new ApiHttpError("invalid_request");
  }

  return Object.freeze({
    contextType: rawType,
    contextId: rawId,
  }) as ApiV1MeQuery;
}
