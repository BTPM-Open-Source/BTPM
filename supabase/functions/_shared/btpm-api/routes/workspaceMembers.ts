// API-Q WML-1B — Pure route contract, path parser and query parser for
// GET /v1/workspaces/:workspaceid/members.
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable
// global state.
//
// Authority note: membership, Tenant, Organization, Connected App,
// capability-grant, encryption and privacy decisions belong exclusively to
// `public.api_v1_list_workspace_members`. This module only validates the
// external HTTP shape.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const WORKSPACE_MEMBERS_ROUTE = Object.freeze({
  id: "workspace_members.get",
  method: "GET",
  path: "/v1/workspaces/:workspaceid/members",
  operation: "read",
} as const);

export interface ApiV1WorkspaceMembersPath {
  readonly workspaceId: string;
}

export interface ApiV1WorkspaceMembersQuery {
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

const MEMBERS_PREFIX = "/v1/workspaces/";
const MEMBERS_SUFFIX = "/members";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Reject separators, encoding, matrix parameters and any whitespace.
const FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const OFFSET_MIN = 0;
const OFFSET_MAX = 10000;
const SEARCH_MAX_LENGTH = 100;

const ALLOWED_PARAM_NAMES: ReadonlySet<string> = new Set([
  "limit",
  "offset",
  "search",
]);

const DECIMAL_DIGITS_ONLY = /^[0-9]+$/;

export function parseApiV1WorkspaceMembersPath(
  pathname: string,
): ApiV1WorkspaceMembersPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (!pathname.startsWith(MEMBERS_PREFIX)) {
    throw new ApiHttpError("invalid_request");
  }

  if (!pathname.endsWith(MEMBERS_SUFFIX)) {
    throw new ApiHttpError("invalid_request");
  }

  const remainder = pathname.slice(
    MEMBERS_PREFIX.length,
    pathname.length - MEMBERS_SUFFIX.length,
  );

  if (remainder.length === 0) {
    throw new ApiHttpError("invalid_request");
  }

  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) {
    throw new ApiHttpError("invalid_request");
  }

  if (remainder === NIL_UUID) {
    throw new ApiHttpError("invalid_request");
  }

  if (!apiUuidSchema.safeParse(remainder).success) {
    throw new ApiHttpError("invalid_request");
  }

  return Object.freeze({
    workspaceId: remainder,
  }) as ApiV1WorkspaceMembersPath;
}

function isSafeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value);
}

function parseDecimalParam(
  raw: string | null,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === null) {
    return defaultValue;
  }
  if (!DECIMAL_DIGITS_ONLY.test(raw)) {
    throw new ApiHttpError("invalid_request");
  }
  const n = Number(raw);
  if (!isSafeInteger(n) || n < min || n > max) {
    throw new ApiHttpError("invalid_request");
  }
  return n;
}

function parseSearchParam(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > SEARCH_MAX_LENGTH) {
    throw new ApiHttpError("invalid_request");
  }
  return trimmed;
}

function assertValidPercentEncoding(raw: string): void {
  try {
    decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    throw new ApiHttpError("invalid_request");
  }
}

export function parseApiV1WorkspaceMembersQuery(
  rawSearch: string,
): ApiV1WorkspaceMembersQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  // Every query parameter is optional, so an absent query string is valid.
  if (rawSearch === "") {
    return Object.freeze({
      limit: 50,
      offset: 0,
      search: null,
    }) as ApiV1WorkspaceMembersQuery;
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

  const limit = parseDecimalParam(params.get("limit"), 50, LIMIT_MIN, LIMIT_MAX);
  const offset = parseDecimalParam(
    params.get("offset"),
    0,
    OFFSET_MIN,
    OFFSET_MAX,
  );
  const search = parseSearchParam(params.get("search"));

  return Object.freeze({
    limit,
    offset,
    search,
  }) as ApiV1WorkspaceMembersQuery;
}
