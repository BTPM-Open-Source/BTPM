// API-H.4A — Pure route contract and path parser for GET /v1/projects/:projectid.
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable
// global state.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const PROJECT_DETAIL_ROUTE = Object.freeze({
  id: "projects.get_by_id",
  method: "GET",
  path: "/v1/projects/:projectid",
  operation: "read",
} as const);

export interface ApiV1ProjectDetailPath {
  readonly projectId: string;
}

const PROJECT_DETAIL_PREFIX = "/v1/projects/";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Reject separators, encoding, matrix parameters and any whitespace.
const FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

export function parseApiV1ProjectDetailPath(
  pathname: string,
): ApiV1ProjectDetailPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (!pathname.startsWith(PROJECT_DETAIL_PREFIX)) {
    throw new ApiHttpError("invalid_request");
  }

  const remainder = pathname.slice(PROJECT_DETAIL_PREFIX.length);

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
    projectId: remainder,
  }) as ApiV1ProjectDetailPath;
}
