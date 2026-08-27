// API-H.2A — Pure route contract and query parser for GET /v1/workspaces.
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable
// global state.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const WORKSPACES_ROUTE = Object.freeze({
  id: "workspaces.get",
  method: "GET",
  path: "/v1/workspaces",
  operation: "read",
} as const);

export interface ApiV1WorkspacesQuery {
  readonly organizationId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const OFFSET_MIN = 0;
const OFFSET_MAX = 10000;
const SEARCH_MAX_LENGTH = 100;

const ALLOWED_PARAM_NAMES: ReadonlySet<string> = new Set([
  "organization_id",
  "limit",
  "offset",
  "search",
]);

const DECIMAL_DIGITS_ONLY = /^[0-9]+$/;

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

function parseOrganizationIdParam(raw: string | null): string {
  if (raw === null) {
    throw new ApiHttpError("invalid_request");
  }
  const result = apiUuidSchema.safeParse(raw);
  if (!result.success) {
    throw new ApiHttpError("invalid_request");
  }
  return raw;
}

function assertValidPercentEncoding(raw: string): void {
  try {
    decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    throw new ApiHttpError("invalid_request");
  }
}

export function parseApiV1WorkspacesQuery(
  rawSearch: string,
): ApiV1WorkspacesQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  // organization_id is required, so an empty raw query is never valid.
  if (rawSearch === "" || !rawSearch.startsWith("?")) {
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

  const organizationId = parseOrganizationIdParam(params.get("organization_id"));
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
    organizationId,
    search,
  }) as ApiV1WorkspacesQuery;
}
