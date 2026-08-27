// API-E.R3 — Shared Edge Authentication Middleware Foundation.
//
// Safe error contract for the API authentication middleware.
//
// Errors are structured so that no bearer token, raw JWT claim, database
// error, service-role credential, internal table ID, or stack trace can
// ever be serialized into an HTTP response body. The `cause` field, if
// present, is retained in-memory only for server-side observability and
// is NEVER included in `toJSON()` output.

export type ApiAuthenticationErrorCode =
  | "missing_bearer_token"
  | "malformed_bearer_token"
  | "invalid_token"
  | "invalid_issuer"
  | "invalid_audience"
  | "token_expired"
  | "missing_subject"
  | "invalid_session"
  | "subject_mismatch"
  | "missing_client_id"
  | "invalid_client_id"
  | "client_disabled"
  | "client_record_ambiguous"
  | "active_policy_missing"
  | "active_policy_ambiguous"
  | "policy_acknowledgement_missing"
  | "policy_acknowledgement_revoked"
  | "policy_acknowledgement_stale"
  | "authentication_internal_error";

const CODE_TO_STATUS: Record<ApiAuthenticationErrorCode, number> = {
  missing_bearer_token: 401,
  malformed_bearer_token: 401,
  invalid_token: 401,
  invalid_issuer: 401,
  invalid_audience: 401,
  token_expired: 401,
  missing_subject: 401,
  invalid_session: 401,
  subject_mismatch: 401,
  missing_client_id: 401,
  invalid_client_id: 401,
  client_disabled: 403,
  client_record_ambiguous: 403,
  active_policy_missing: 403,
  active_policy_ambiguous: 403,
  policy_acknowledgement_missing: 403,
  policy_acknowledgement_revoked: 403,
  policy_acknowledgement_stale: 403,
  authentication_internal_error: 500,
};

const CODE_TO_PUBLIC_MESSAGE: Record<ApiAuthenticationErrorCode, string> = {
  missing_bearer_token: "Authentication required.",
  malformed_bearer_token: "Authentication required.",
  invalid_token: "Authentication required.",
  invalid_issuer: "Authentication required.",
  invalid_audience: "Authentication required.",
  token_expired: "Authentication required.",
  missing_subject: "Authentication required.",
  invalid_session: "Authentication required.",
  subject_mismatch: "Authentication required.",
  missing_client_id: "Authentication required.",
  invalid_client_id: "Authentication required.",
  client_disabled: "Client is not authorized.",
  client_record_ambiguous: "Client is not authorized.",
  active_policy_missing: "Client is not authorized.",
  active_policy_ambiguous: "Client is not authorized.",
  policy_acknowledgement_missing: "Current policy acknowledgement required.",
  policy_acknowledgement_revoked: "Current policy acknowledgement required.",
  policy_acknowledgement_stale: "Current policy acknowledgement required.",
  authentication_internal_error: "Internal server error.",
};

export class ApiAuthenticationError extends Error {
  public readonly code: ApiAuthenticationErrorCode;
  public readonly status: number;
  public readonly publicMessage: string;
  // Internal only. Never serialized.
  public readonly internalCause?: unknown;

  constructor(code: ApiAuthenticationErrorCode, internalCause?: unknown) {
    super(CODE_TO_PUBLIC_MESSAGE[code]);
    this.name = "ApiAuthenticationError";
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
  toJSON(): { error: { code: ApiAuthenticationErrorCode; message: string } } {
    return { error: { code: this.code, message: this.publicMessage } };
  }
}

/**
 * Convert any error into a safe HTTP Response.
 * Unknown errors always map to `authentication_internal_error` (500).
 */
export function toSafeErrorResponse(
  error: unknown,
  extraHeaders?: HeadersInit,
): Response {
  const apiErr =
    error instanceof ApiAuthenticationError
      ? error
      : new ApiAuthenticationError("authentication_internal_error", error);
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(apiErr.toJSON()), {
    status: apiErr.status,
    headers,
  });
}
