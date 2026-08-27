// API-G.1A — Shared request-ID, safe HTTP-error and safe JSON-response
// foundation for the future `btpm-api-v1` runtime.
//
// This module intentionally does NOT construct the runtime, router,
// routes, CORS, body parsing, timeout handling, rate limiting, schemas,
// feature flags, or kill switches.

// -----------------------------------------------------------------------------
// Safe HTTP error
// -----------------------------------------------------------------------------

export type ApiHttpErrorCode =
  | "invalid_request_id"
  | "internal_error"
  | "unsupported_media_type"
  | "invalid_content_length"
  | "request_too_large"
  | "invalid_json"
  | "cors_origin_denied"
  | "request_timeout"
  | "rate_limit_exceeded"
  | "invalid_request"
  | "route_not_found"
  | "not_authorized"
  | "api_unavailable"
  // API-I.9A — bounded idempotency conflict states for the single external
  // mutation. Neither message exposes payload hashes, registry state,
  // previous results, narrative content or database information.
  | "idempotency_conflict"
  | "idempotency_pending"
  // API-K.7 — optimistic concurrency conflict for the external Risk update
  // surface. Deliberately distinct from `idempotency_conflict`. Exposes no
  // stored `updated_at`, SQL detail, PMG response or narrative.
  | "concurrency_conflict";

const CODE_TO_STATUS: Record<ApiHttpErrorCode, number> = {
  invalid_request_id: 400,
  internal_error: 500,
  unsupported_media_type: 415,
  invalid_content_length: 400,
  request_too_large: 413,
  invalid_json: 400,
  cors_origin_denied: 403,
  request_timeout: 504,
  rate_limit_exceeded: 429,
  invalid_request: 400,
  route_not_found: 404,
  not_authorized: 403,
  api_unavailable: 503,
  idempotency_conflict: 409,
  idempotency_pending: 409,
  concurrency_conflict: 409,
};

const CODE_TO_PUBLIC_MESSAGE: Record<ApiHttpErrorCode, string> = {
  invalid_request_id: "Invalid request identifier.",
  internal_error: "Internal server error.",
  unsupported_media_type: "Content-Type must be application/json.",
  invalid_content_length: "Invalid Content-Length header.",
  request_too_large: "Request body is too large.",
  invalid_json: "Request body must contain valid JSON.",
  cors_origin_denied: "Origin is not allowed.",
  request_timeout: "Request timed out.",
  rate_limit_exceeded: "Rate limit exceeded.",
  invalid_request: "Request validation failed.",
  route_not_found: "Route not found.",
  not_authorized: "Not authorized.",
  api_unavailable: "API is unavailable.",
  idempotency_conflict: "Idempotency key conflicts with another request.",
  idempotency_pending: "Idempotent request is still pending.",
  concurrency_conflict: "Resource update conflicts with a newer version.",
};



export class ApiHttpError extends Error {
  public readonly code: ApiHttpErrorCode;
  public readonly status: number;
  public readonly publicMessage: string;

  constructor(code: ApiHttpErrorCode, internalCause?: unknown) {
    super(CODE_TO_PUBLIC_MESSAGE[code]);
    this.name = "ApiHttpError";
    this.code = code;
    this.status = CODE_TO_STATUS[code];
    this.publicMessage = CODE_TO_PUBLIC_MESSAGE[code];
    if (internalCause !== undefined) {
      Object.defineProperty(this, "internalCause", {
        value: internalCause,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }
  }

  /** Safe serialization for HTTP response bodies. */
  toSafeJSON(requestId: string): {
    error: { code: ApiHttpErrorCode; message: string };
    requestId: string;
  } {
    return {
      error: { code: this.code, message: this.publicMessage },
      requestId,
    };
  }
}

// -----------------------------------------------------------------------------
// Request ID
// -----------------------------------------------------------------------------

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,128}$/;

export interface RequestIdDependencies {
  randomUUID(): string;
}

const DEFAULT_REQUEST_ID_DEPENDENCIES: RequestIdDependencies = {
  randomUUID(): string {
    return crypto.randomUUID();
  },
};

export function resolveRequestId(
  request: Request,
  dependencies: RequestIdDependencies = DEFAULT_REQUEST_ID_DEPENDENCIES,
): string {
  const raw = request.headers.get("X-Request-ID");
  if (raw === null) {
    const generated = dependencies.randomUUID();
    if (typeof generated !== "string" || !REQUEST_ID_PATTERN.test(generated)) {
      throw new ApiHttpError("invalid_request_id");
    }
    return generated;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ApiHttpError("invalid_request_id");
  }
  if (!REQUEST_ID_PATTERN.test(trimmed)) {
    throw new ApiHttpError("invalid_request_id");
  }
  return trimmed;
}

// -----------------------------------------------------------------------------
// Safe JSON responses
// -----------------------------------------------------------------------------

export function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  // Mandatory safety headers must override any conflicting supplied values.
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Request-ID", requestId);
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export function toSafeHttpErrorResponse(
  error: unknown,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  const apiErr =
    error instanceof ApiHttpError
      ? error
      : new ApiHttpError("internal_error", error);
  return jsonResponse(
    apiErr.status,
    apiErr.toSafeJSON(requestId),
    requestId,
    extraHeaders,
  );
}

// -----------------------------------------------------------------------------
// Bounded JSON request-body reader (API-G.1B)
// -----------------------------------------------------------------------------

const CONTENT_LENGTH_PATTERN = /^[0-9]+$/;

function parseJsonContentType(raw: string | null): boolean {
  if (raw === null) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const semi = trimmed.indexOf(";");
  const mediaType = (semi === -1 ? trimmed : trimmed.slice(0, semi)).trim().toLowerCase();
  return mediaType === "application/json";
}

function parseContentLength(raw: string | null, maxBytes: number): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ApiHttpError("invalid_content_length");
  }
  if (!CONTENT_LENGTH_PATTERN.test(trimmed)) {
    throw new ApiHttpError("invalid_content_length");
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) {
    throw new ApiHttpError("invalid_content_length");
  }
  if (n > maxBytes) {
    throw new ApiHttpError("request_too_large");
  }
  return n;
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (
    typeof maxBytes !== "number" ||
    !Number.isFinite(maxBytes) ||
    !Number.isInteger(maxBytes) ||
    maxBytes <= 0
  ) {
    throw new ApiHttpError("internal_error");
  }

  const ct = request.headers.get("Content-Type");
  if (!parseJsonContentType(ct)) {
    throw new ApiHttpError("unsupported_media_type");
  }

  parseContentLength(request.headers.get("Content-Length"), maxBytes);

  const body = request.body;
  if (body === null) {
    throw new ApiHttpError("invalid_json");
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch (acquireErr) {
    if (acquireErr instanceof ApiHttpError) throw acquireErr;
    throw new ApiHttpError("internal_error", acquireErr);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (streamErr) {
        try {
          await reader.cancel();
        } catch {
          // best-effort
        }
        if (streamErr instanceof ApiHttpError) throw streamErr;
        throw new ApiHttpError("internal_error", streamErr);
      }
      if (result.done) break;
      const chunk = result.value;
      if (!chunk) continue;
      total += chunk.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // best-effort
        }
        throw new ApiHttpError("request_too_large");
      }
      chunks.push(chunk);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // best-effort
    }
  }

  if (total === 0) {
    throw new ApiHttpError("invalid_json");
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch (decodeErr) {
    throw new ApiHttpError("invalid_json", decodeErr);
  }

  if (text.trim().length === 0) {
    throw new ApiHttpError("invalid_json");
  }

  try {
    return JSON.parse(text);
  } catch (parseErr) {
    throw new ApiHttpError("invalid_json", parseErr);
  }
}

// -----------------------------------------------------------------------------
// Request operation timeout helper (API-G.1D)
// -----------------------------------------------------------------------------

export async function withApiTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new ApiHttpError("internal_error");
  }

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      try {
        controller.abort();
      } catch {
        // best-effort
      }
      reject(new ApiHttpError("request_timeout"));
    }, timeoutMs);
  });

  let opPromise: Promise<T>;
  try {
    opPromise = operation(controller.signal);
  } catch (syncErr) {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    // swallow the timeout rejection to avoid unhandled rejection
    timeoutPromise.catch(() => {});
    if (syncErr instanceof ApiHttpError) throw syncErr;
    throw new ApiHttpError("internal_error", syncErr);
  }

  // Ensure late rejections do not become unhandled.
  const safeOpPromise = opPromise.then(
    (v) => ({ ok: true as const, value: v }),
    (e) => ({ ok: false as const, error: e }),
  );

  try {
    const raced = await Promise.race([safeOpPromise, timeoutPromise]);
    // If timeoutPromise won, it already rejected — control does not reach here.
    if (raced.ok) {
      return raced.value;
    }
    const e = raced.error;
    if (e instanceof ApiHttpError) throw e;
    throw new ApiHttpError("internal_error", e);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (didTimeout) {
      // Prevent unhandled rejection from late-settling operation.
      safeOpPromise.catch(() => {});
    }
    // timeoutPromise: swallow if not already rejected/handled.
    timeoutPromise.catch(() => {});
  }
}

// -----------------------------------------------------------------------------
// Structured non-sensitive API logging (API-G.1E)
// -----------------------------------------------------------------------------

export type ApiLogLevel = "info" | "warn" | "error";

export type ApiLogEventName =
  | "api.request.received"
  | "api.request.completed"
  | "api.request.rejected"
  | "api.request.failed"
  | "api.logging.invalid";

export type ApiLogMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export interface ApiLogEvent {
  level: ApiLogLevel;
  event: ApiLogEventName;
  requestId: string;
  method?: ApiLogMethod;
  routeId?: string;
  status?: number;
  durationMs?: number;
  code?: ApiHttpErrorCode;
}

const LOG_LEVELS: ReadonlySet<ApiLogLevel> = new Set<ApiLogLevel>([
  "info",
  "warn",
  "error",
]);

const LOG_EVENT_NAMES: ReadonlySet<ApiLogEventName> = new Set<ApiLogEventName>([
  "api.request.received",
  "api.request.completed",
  "api.request.rejected",
  "api.request.failed",
  "api.logging.invalid",
]);

const LOG_METHODS: ReadonlySet<ApiLogMethod> = new Set<ApiLogMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

const ROUTE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const ERROR_CODES: ReadonlySet<ApiHttpErrorCode> = new Set<ApiHttpErrorCode>(
  Object.keys(CODE_TO_STATUS) as ApiHttpErrorCode[],
);

function writeLogLine(level: ApiLogLevel, line: string): void {
  if (level === "info") console.log(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}

export function logApiEvent(event: ApiLogEvent): void {
  const raw = event as unknown;
  if (raw === null || typeof raw !== "object") {
    console.error(
      JSON.stringify({
        level: "error",
        event: "api.logging.invalid",
        requestId: "unavailable",
        code: "internal_error",
      }),
    );
    return;
  }

  const src = raw as Record<string, unknown>;
  const level = src.level;
  const eventName = src.event;
  const requestId = src.requestId;

  if (
    typeof level !== "string" ||
    !LOG_LEVELS.has(level as ApiLogLevel) ||
    typeof eventName !== "string" ||
    !LOG_EVENT_NAMES.has(eventName as ApiLogEventName) ||
    typeof requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(requestId)
  ) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "api.logging.invalid",
        requestId: "unavailable",
        code: "internal_error",
      }),
    );
    return;
  }

  const safe: Record<string, unknown> = {
    level: level as ApiLogLevel,
    event: eventName as ApiLogEventName,
    requestId: requestId,
  };

  const method = src.method;
  if (typeof method === "string" && LOG_METHODS.has(method as ApiLogMethod)) {
    safe.method = method;
  }

  const routeId = src.routeId;
  if (typeof routeId === "string" && ROUTE_ID_PATTERN.test(routeId)) {
    safe.routeId = routeId;
  }

  const status = src.status;
  if (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  ) {
    safe.status = status;
  }

  const durationMs = src.durationMs;
  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    Number.isSafeInteger(durationMs) &&
    durationMs >= 0
  ) {
    safe.durationMs = durationMs;
  }

  const code = src.code;
  if (typeof code === "string" && ERROR_CODES.has(code as ApiHttpErrorCode)) {
    safe.code = code;
  }

  writeLogLine(level as ApiLogLevel, JSON.stringify(safe));
}
