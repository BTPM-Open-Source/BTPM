// Shared normalizer for Microsoft Graph upload/publish failures.
//
// Purpose:
//   Convert raw Graph error responses (which can include locale-specific
//   strings, large JSON payloads and request IDs) into stable BTPM error
//   codes + safe user-facing messages. Used by every generated Office
//   publish path so users never see raw Graph JSON.
//
// This file is intentionally I/O-free, so it is trivially unit-testable.

export type NormalizedPublishCode =
  | "sharepoint_file_locked"
  | "sharepoint_throttled"
  | "sharepoint_name_conflict"
  | "publish_access_denied"
  | "publish_target_missing"
  | "publish_failed";

export interface NormalizedPublishError {
  code: NormalizedPublishCode;
  /** Safe message intended for the end user. Never contains raw Graph JSON. */
  userNote: string;
  /** Sanitized audit message: HTTP status, graph code, inner code, request ids.
   *  No raw JSON body included. Safe to persist in `_error_note`. */
  auditNote: string;
  httpStatus: number;
  graphCode: string | null;
  innerCode: string | null;
  requestId: string | null;
  clientRequestId: string | null;
  retryAfterSeconds: number | null;
}

interface GraphErrorShape {
  error?: {
    code?: string;
    message?: string;
    innerError?: {
      code?: string;
      "request-id"?: string;
      "client-request-id"?: string;
      date?: string;
    };
  };
}

const LOCKED_USER_NOTE =
  "The existing generated file is currently open or locked in SharePoint/Office. " +
  "Close it in PowerPoint, Word, or the browser, wait a minute for Microsoft 365 " +
  "to release the lock, then try again. BTPM did not replace the existing file.";

const THROTTLED_USER_NOTE =
  "SharePoint is temporarily throttling the request. Wait a moment and try again.";

const ACCESS_DENIED_USER_NOTE =
  "BTPM does not have permission to write to the linked SharePoint folder.";

const TARGET_MISSING_USER_NOTE =
  "The linked SharePoint folder or file no longer exists. Please re-link the project folder.";

const NAME_CONFLICT_USER_NOTE =
  "SharePoint reported a name conflict for this file. Try again in a moment.";

const GENERIC_FAILED_USER_NOTE =
  "Publishing to SharePoint failed. Please try again in a moment.";

function safeParseGraph(text: string | null | undefined): GraphErrorShape {
  if (!text) return {};
  try {
    const j = JSON.parse(text);
    return (j && typeof j === "object") ? j as GraphErrorShape : {};
  } catch {
    return {};
  }
}

function isLockedSignal(
  status: number,
  graphCode: string | null,
  innerCode: string | null,
  message: string | null,
): boolean {
  if (status === 423) return true;
  const haystack = `${graphCode ?? ""} ${innerCode ?? ""} ${message ?? ""}`.toLowerCase();
  return /resourcelocked|filelocked|\blocked\b/.test(haystack);
}

function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) return null;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  const t = Date.parse(header);
  if (!Number.isNaN(t)) {
    const secs = Math.round((t - Date.now()) / 1000);
    return secs > 0 ? secs : 0;
  }
  return null;
}

/**
 * Normalize a Microsoft Graph upload/publish failure into a stable BTPM
 * shape. The raw `body` text is parsed safely; it is NEVER echoed back in
 * `userNote` or `auditNote`.
 */
export function normalizeGraphPublishError(input: {
  httpStatus: number;
  body?: string | null;
  retryAfter?: string | null;
}): NormalizedPublishError {
  const { httpStatus } = input;
  const parsed = safeParseGraph(input.body);
  const graphCode = parsed.error?.code ?? null;
  const innerCode = parsed.error?.innerError?.code ?? null;
  const message = parsed.error?.message ?? null;
  const requestId = parsed.error?.innerError?.["request-id"] ?? null;
  const clientRequestId = parsed.error?.innerError?.["client-request-id"] ?? null;
  const retryAfterSeconds = parseRetryAfter(input.retryAfter ?? null);

  const auditBits = [
    `http=${httpStatus}`,
    graphCode ? `code=${graphCode}` : null,
    innerCode ? `inner=${innerCode}` : null,
    requestId ? `req=${requestId}` : null,
    clientRequestId ? `cri=${clientRequestId}` : null,
    retryAfterSeconds != null ? `retry_after=${retryAfterSeconds}s` : null,
  ].filter(Boolean).join(" ");

  let code: NormalizedPublishCode;
  let userNote: string;

  if (isLockedSignal(httpStatus, graphCode, innerCode, message)) {
    code = "sharepoint_file_locked";
    userNote = LOCKED_USER_NOTE;
  } else if (httpStatus === 429) {
    code = "sharepoint_throttled";
    userNote = THROTTLED_USER_NOTE;
  } else if (httpStatus === 401 || httpStatus === 403) {
    code = "publish_access_denied";
    userNote = ACCESS_DENIED_USER_NOTE;
  } else if (httpStatus === 404) {
    code = "publish_target_missing";
    userNote = TARGET_MISSING_USER_NOTE;
  } else if (httpStatus === 409) {
    code = "sharepoint_name_conflict";
    userNote = NAME_CONFLICT_USER_NOTE;
  } else {
    code = "publish_failed";
    userNote = GENERIC_FAILED_USER_NOTE;
  }

  return {
    code,
    userNote,
    auditNote: `${code} ${auditBits}`.trim(),
    httpStatus,
    graphCode,
    innerCode,
    requestId,
    clientRequestId,
    retryAfterSeconds,
  };
}

/** Convenience: read a Response, then normalize. */
export async function normalizeGraphResponse(
  res: Response,
): Promise<NormalizedPublishError> {
  const body = await res.text().catch(() => "");
  return normalizeGraphPublishError({
    httpStatus: res.status,
    body,
    retryAfter: res.headers.get("Retry-After"),
  });
}
