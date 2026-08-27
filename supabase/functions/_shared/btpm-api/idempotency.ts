// API-F.4 — Edge idempotency utilities.
//
// Dependency-light helpers for reading the `Idempotency-Key` header and
// deterministically hashing a validated JSON payload. This module does
// NOT construct HTTP routes, Supabase clients, database wrappers, or
// business mutations.

// -----------------------------------------------------------------------------
// JSON contract
// -----------------------------------------------------------------------------

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;
export interface JsonArray extends ReadonlyArray<JsonValue> {}
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

// -----------------------------------------------------------------------------
// Stable validation error
// -----------------------------------------------------------------------------

export type IdempotencyErrorCode =
  | "missing_idempotency_key"
  | "invalid_idempotency_key"
  | "invalid_payload";

export class IdempotencyValidationError extends Error {
  public readonly code: IdempotencyErrorCode;
  constructor(code: IdempotencyErrorCode) {
    super(code);
    this.name = "IdempotencyValidationError";
    this.code = code;
  }
  toJSON(): { error: { code: IdempotencyErrorCode } } {
    return { error: { code: this.code } };
  }
}

// -----------------------------------------------------------------------------
// Idempotency-Key header
// -----------------------------------------------------------------------------

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:@/+!=-]{1,255}$/;

/**
 * API-Q.8 — Canonical, transport-neutral idempotency-key value validation.
 *
 * This is the SINGLE authority for idempotency-key value semantics: absent /
 * non-string / blank values are `missing_idempotency_key`; present but
 * malformed values are `invalid_idempotency_key`. The accepted key is returned
 * trimmed. Non-HTTP callers (for example MCP `tools/call` arguments) MUST reuse
 * this validator instead of restating the pattern, length limit, trimming rule
 * or missing/invalid distinction.
 */
export function validateIdempotencyKey(raw: unknown): string {
  if (raw === null || raw === undefined) {
    throw new IdempotencyValidationError("missing_idempotency_key");
  }
  if (typeof raw !== "string") {
    throw new IdempotencyValidationError("invalid_idempotency_key");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new IdempotencyValidationError("missing_idempotency_key");
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
    throw new IdempotencyValidationError("invalid_idempotency_key");
  }
  return trimmed;
}

/**
 * REST/header adapter. Behaviorally unchanged: it reads the canonical
 * `Idempotency-Key` header and delegates value validation to
 * {@link validateIdempotencyKey}.
 */
export function readIdempotencyKey(request: Request): string {
  return validateIdempotencyKey(request.headers.get("Idempotency-Key"));
}

// -----------------------------------------------------------------------------
// Deterministic canonicalization
// -----------------------------------------------------------------------------

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (t === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new IdempotencyValidationError("invalid_payload");
    }
    // Normalize -0 to 0.
    if (Object.is(n, -0)) return "0";
    return JSON.stringify(n);
  }
  if (
    t === "undefined" ||
    t === "function" ||
    t === "symbol" ||
    t === "bigint"
  ) {
    throw new IdempotencyValidationError("invalid_payload");
  }
  if (t !== "object") {
    throw new IdempotencyValidationError("invalid_payload");
  }
  const obj = value as object;
  if (seen.has(obj)) {
    throw new IdempotencyValidationError("invalid_payload");
  }
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (const item of obj as unknown[]) {
        if (item === undefined) {
          throw new IdempotencyValidationError("invalid_payload");
        }
        parts.push(canonicalize(item, seen));
      }
      return "[" + parts.join(",") + "]";
    }
    // Reject Date, Map, Set, class instances, non-plain objects.
    if (!isPlainObject(obj)) {
      throw new IdempotencyValidationError("invalid_payload");
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = (obj as Record<string, unknown>)[k];
      if (v === undefined) {
        throw new IdempotencyValidationError("invalid_payload");
      }
      parts.push(JSON.stringify(k) + ":" + canonicalize(v, seen));
    }
    return "{" + parts.join(",") + "}";
  } finally {
    seen.delete(obj);
  }
}

export function canonicalizePayload(payload: unknown): string {
  return canonicalize(payload, new WeakSet<object>());
}

// -----------------------------------------------------------------------------
// SHA-256 hash
// -----------------------------------------------------------------------------

export async function hashCanonicalPayload(payload: unknown): Promise<string> {
  const canonical = canonicalizePayload(payload);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}
