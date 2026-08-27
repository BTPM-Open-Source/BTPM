// API-G.5.10D-3B — Supabase Rate-Limit Adapter (default catalogue profile
// runtime activation).
//
// Connects the accepted API-G rate-limit contracts to the BTPM-controlled
// database substrate:
//   - public.api_rate_limit_profile_catalogue (single active default row)
//   - public.consume_api_rate_limit_v1
//
// This module intentionally does NOT construct a Supabase client, read
// environment variables, handle HTTP, retry, cache, fall back to any
// in-memory limiter, or provide any hardcoded default profile. All time and
// profile values remain authoritative on the database side.


import { ApiHttpError } from "./http.ts";
import type {
  ApiRateLimitProfile,
  ApiRateLimitStore,
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "./rateLimit.ts";

// -----------------------------------------------------------------------------
// Public contracts
// -----------------------------------------------------------------------------

export interface ApiRateLimitProfileResolver {
  resolve(
    apiClientId: string,
    routeId: string,
  ): Promise<ApiRateLimitProfile>;
}

export interface SupabaseRateLimitClient {
  from(table: string): unknown;
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<unknown>;
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

function internal(cause?: unknown): ApiHttpError {
  return new ApiHttpError("internal_error", cause);
}

function isPlainClientObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v)
  );
}

function isSafeIntegerInRange(
  v: unknown,
  min: number,
  max: number,
): v is number {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    Number.isSafeInteger(v) &&
    v >= min &&
    v <= max
  );
}

function isNonNegativeSafeInteger(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    Number.isSafeInteger(v) &&
    v >= 0
  );
}

// Minimal structural query shape used by the profile resolver. The real
// PostgREST client implements a superset of this.
interface StructuralProfileQuery {
  select(columns: string): StructuralProfileQuery;
  eq(column: string, value: string | boolean): StructuralProfileQuery;
  limit(count: number): PromiseLike<unknown>;
}

interface StructuralQueryResult {
  data: unknown;
  error: unknown;
}

function isStructuralQueryResult(v: unknown): v is StructuralQueryResult {
  return (
    v !== null &&
    typeof v === "object" &&
    "data" in (v as Record<string, unknown>) &&
    "error" in (v as Record<string, unknown>)
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

// -----------------------------------------------------------------------------
// Profile resolver
// -----------------------------------------------------------------------------

export function createSupabaseRateLimitProfileResolver(
  client: SupabaseRateLimitClient,
): ApiRateLimitProfileResolver {
  if (!isPlainClientObject(client)) throw internal();
  if (typeof (client as { from?: unknown }).from !== "function") {
    throw internal();
  }

  return Object.freeze({
    async resolve(
      apiClientId: string,
      routeId: string,
    ): Promise<ApiRateLimitProfile> {
      // Runtime pipeline identity remains validated before any database
      // access. These values are NOT used to select the numeric definition.
      if (typeof apiClientId !== "string" || !UUID_PATTERN.test(apiClientId)) {
        throw internal();
      }
      if (typeof routeId !== "string" || !ROUTE_ID_PATTERN.test(routeId)) {
        throw internal();
      }

      let raw: unknown;
      try {
        const table = client.from("api_rate_limit_profile_catalogue") as
          | StructuralProfileQuery
          | undefined
          | null;
        if (
          table === null ||
          table === undefined ||
          typeof (table as StructuralProfileQuery).select !== "function"
        ) {
          throw internal();
        }
        const q1 = (table as StructuralProfileQuery).select(
          "request_limit,window_seconds",
        );
        if (q1 === null || typeof q1.eq !== "function") throw internal();
        const q2 = q1.eq("lifecycle_status", "active");
        if (q2 === null || typeof q2.eq !== "function") throw internal();
        const q3 = q2.eq("is_default", true);
        if (q3 === null || typeof q3.limit !== "function") throw internal();
        raw = await q3.limit(2);
      } catch (err) {
        if (err instanceof ApiHttpError) throw internal();
        throw internal(err);
      }

      if (!isStructuralQueryResult(raw)) throw internal();
      if (raw.error !== null && raw.error !== undefined) throw internal();
      const rows = raw.data;
      if (!Array.isArray(rows)) throw internal();
      if (rows.length !== 1) throw internal();

      const row = rows[0];
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        throw internal();
      }
      const record = row as Record<string, unknown>;
      const requestLimit = record.request_limit;
      const windowSeconds = record.window_seconds;

      if (!isSafeIntegerInRange(requestLimit, 1, 1_000_000)) throw internal();
      if (!isSafeIntegerInRange(windowSeconds, 1, 86_400)) throw internal();

      return Object.freeze({
        limit: requestLimit,
        windowSeconds: windowSeconds,
      });
    },
  });
}


// -----------------------------------------------------------------------------
// Atomic store adapter
// -----------------------------------------------------------------------------

export function createSupabaseRateLimitStore(
  client: SupabaseRateLimitClient,
): ApiRateLimitStore {
  if (!isPlainClientObject(client)) throw internal();
  if (typeof (client as { rpc?: unknown }).rpc !== "function") {
    throw internal();
  }

  return Object.freeze({
    async consume(
      input: ApiRateLimitStoreInput,
    ): Promise<ApiRateLimitStoreResult> {
      let raw: unknown;
      try {
        raw = await client.rpc("consume_api_rate_limit_v1", {
          _api_client_id: input.apiClientId,
          _user_id: input.userId,
          _route_id: input.routeId,
        });
      } catch (err) {
        if (err instanceof ApiHttpError) throw err;
        throw internal(err);
      }

      if (!isStructuralQueryResult(raw)) throw internal();
      if (raw.error !== null && raw.error !== undefined) throw internal();
      const rows = raw.data;
      if (!Array.isArray(rows)) throw internal();
      if (rows.length !== 1) throw internal();

      const row = rows[0];
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        throw internal();
      }
      const record = row as Record<string, unknown>;

      const allowed = record.allowed;
      const remaining = record.remaining;
      const resetAtEpochMs = record.reset_at_epoch_ms;
      const effectiveLimit = record.effective_limit;
      const effectiveWindowSeconds = record.effective_window_seconds;

      if (typeof allowed !== "boolean") throw internal();
      if (!isNonNegativeSafeInteger(remaining)) throw internal();
      if (!isNonNegativeSafeInteger(resetAtEpochMs)) throw internal();
      if (!isSafeIntegerInRange(effectiveLimit, 1, 1_000_000)) throw internal();
      if (!isSafeIntegerInRange(effectiveWindowSeconds, 1, 86_400)) {
        throw internal();
      }
      if (remaining > effectiveLimit) throw internal();
      if (!allowed && remaining !== 0) throw internal();
      if (effectiveLimit !== input.limit) throw internal();
      if (effectiveWindowSeconds !== input.windowSeconds) throw internal();

      return Object.freeze({
        allowed,
        remaining,
        resetAtEpochMs,
      });
    },
  });
}
