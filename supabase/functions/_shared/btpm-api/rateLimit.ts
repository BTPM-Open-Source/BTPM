// API-G.1F — Atomic rate-limit enforcement contract for the future
// `btpm-api-v1` runtime.
//
// This module intentionally does NOT provide an in-memory limiter,
// process-local counters, timers, retries, fallback behaviour,
// environment reads, Supabase clients, database calls, service-role
// credentials, IP/header-derived identity, or logging. It defines a
// dependency-injected atomic-store contract only. Edge Function
// instances are not a reliable global rate-limit authority; the
// runtime must supply a real atomic store adapter.

import { ApiHttpError } from "./http.ts";

// -----------------------------------------------------------------------------
// Public contract
// -----------------------------------------------------------------------------

export interface ApiRateLimitSubject {
  apiClientId: string;
  userId: string;
  routeId: string;
}

export interface ApiRateLimitProfile {
  limit: number;
  windowSeconds: number;
}

export interface ApiRateLimitStoreInput {
  apiClientId: string;
  userId: string;
  routeId: string;
  limit: number;
  windowSeconds: number;
  nowEpochMs: number;
}

export interface ApiRateLimitStoreResult {
  allowed: boolean;
  remaining: number;
  resetAtEpochMs: number;
}

export interface ApiRateLimitStore {
  consume(
    input: ApiRateLimitStoreInput,
  ): Promise<ApiRateLimitStoreResult>;
}

export interface ApiRateLimitAllowedResult {
  remaining: number;
  resetAtEpochMs: number;
}

export interface ApiRateLimitDependencies {
  store: ApiRateLimitStore;
  now(): number;
}

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function isValidUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_PATTERN.test(v);
}

function isValidRouteId(v: unknown): v is string {
  return typeof v === "string" && ROUTE_ID_PATTERN.test(v);
}

function isPositiveSafeInteger(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    Number.isSafeInteger(v) &&
    v > 0
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

function internal(cause?: unknown): ApiHttpError {
  return new ApiHttpError("internal_error", cause);
}

// -----------------------------------------------------------------------------
// enforceApiRateLimit
// -----------------------------------------------------------------------------

export async function enforceApiRateLimit(
  subject: ApiRateLimitSubject,
  profile: ApiRateLimitProfile,
  dependencies: ApiRateLimitDependencies,
): Promise<ApiRateLimitAllowedResult> {
  // Subject validation.
  if (subject === null || typeof subject !== "object") {
    throw internal();
  }
  const { apiClientId, userId, routeId } = subject as ApiRateLimitSubject;
  if (!isValidUuid(apiClientId)) throw internal();
  if (!isValidUuid(userId)) throw internal();
  if (!isValidRouteId(routeId)) throw internal();

  // Profile validation.
  if (profile === null || typeof profile !== "object") {
    throw internal();
  }
  const { limit, windowSeconds } = profile as ApiRateLimitProfile;
  if (!isPositiveSafeInteger(limit)) throw internal();
  if (!isPositiveSafeInteger(windowSeconds)) throw internal();

  // Dependency validation.
  if (dependencies === null || typeof dependencies !== "object") {
    throw internal();
  }
  const { store, now } = dependencies as ApiRateLimitDependencies;
  if (typeof now !== "function") throw internal();
  if (store === null || typeof store !== "object") throw internal();
  if (typeof (store as ApiRateLimitStore).consume !== "function") {
    throw internal();
  }

  // Clock read.
  let nowEpochMs: number;
  try {
    nowEpochMs = now();
  } catch (clockErr) {
    throw internal(clockErr);
  }
  if (!isNonNegativeSafeInteger(nowEpochMs)) throw internal();

  // Store invocation — construct a fresh input object.
  const input: ApiRateLimitStoreInput = {
    apiClientId,
    userId,
    routeId,
    limit,
    windowSeconds,
    nowEpochMs,
  };

  let raw: unknown;
  try {
    raw = await store.consume(input);
  } catch (storeErr) {
    if (storeErr instanceof ApiHttpError) throw storeErr;
    throw internal(storeErr);
  }

  // Result validation.
  if (raw === null || typeof raw !== "object") throw internal();
  const result = raw as Record<string, unknown>;
  const allowed = result.allowed;
  const remaining = result.remaining;
  const resetAtEpochMs = result.resetAtEpochMs;

  if (typeof allowed !== "boolean") throw internal();
  if (!isNonNegativeSafeInteger(remaining)) throw internal();
  if (remaining > limit) throw internal();
  if (
    typeof resetAtEpochMs !== "number" ||
    !Number.isFinite(resetAtEpochMs) ||
    !Number.isSafeInteger(resetAtEpochMs)
  ) {
    throw internal();
  }
  if (resetAtEpochMs < nowEpochMs) throw internal();

  if (!allowed) {
    throw new ApiHttpError("rate_limit_exceeded");
  }

  return Object.freeze({
    remaining,
    resetAtEpochMs,
  });
}
