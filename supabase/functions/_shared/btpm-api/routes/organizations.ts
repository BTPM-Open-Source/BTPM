// API-G.2G — Pure route contract and query parser for GET /v1/organizations.
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable
// global state.

import { ApiHttpError } from "../http.ts";
import type { ApiV1OrganizationsQuery } from "../supabaseOrganizations.ts";

export const ORGANIZATIONS_ROUTE = Object.freeze({
  id: "organizations.get",
  method: "GET",
  path: "/v1/organizations",
  operation: "read",
} as const);

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

export function parseApiV1OrganizationsQuery(
  rawSearch: string,
): ApiV1OrganizationsQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (rawSearch === "") {
    return Object.freeze({
      limit: 50,
      offset: 0,
      search: null,
    }) as ApiV1OrganizationsQuery;
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

  const limit = parseDecimalParam(
    params.get("limit"),
    50,
    LIMIT_MIN,
    LIMIT_MAX,
  );
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
  }) as ApiV1OrganizationsQuery;
}
