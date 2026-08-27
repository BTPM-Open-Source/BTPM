// API-G.1I — Pure payload contract for GET /v1/version.
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable
// global state.

export const VERSION_ROUTE = Object.freeze({
  id: "version.get",
  method: "GET",
  path: "/v1/version",
  operation: "read",
} as const);

export interface ApiVersionPayload {
  readonly service: "btpm-api";
  readonly apiVersion: "v1";
}

export function buildVersionPayload(): ApiVersionPayload {
  return Object.freeze({
    service: "btpm-api",
    apiVersion: "v1",
  } as const);
}
