// API-I.6 — Pure route contract and strict request-body parser for
// POST /v1/execution-updates.
//
// This module MUST NOT read the environment, read headers, read request
// bodies, open network connections, construct Supabase clients, call RPCs,
// touch the database, hash payloads, register routes, handle HTTP requests,
// log, schedule timers, or hold any mutable global state.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const EXECUTION_UPDATES_APPEND_ROUTE = Object.freeze({
  id: "execution_updates.append",
  method: "POST",
  path: "/v1/execution-updates",
  operation: "mutation",
} as const);

export type ApiV1ExecutionUpdateTargetType = "phase" | "task";

export interface ApiV1AppendExecutionUpdateBody {
  readonly targetType: ApiV1ExecutionUpdateTargetType;
  readonly targetId: string;
  readonly summary: string;
  readonly updateDate: string;
  readonly statusLabel: string | null;
}

const SUMMARY_MAX_LENGTH = 4000;
const STATUS_LABEL_MAX_LENGTH = 255;

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "targetType",
  "targetId",
  "summary",
  "updateDate",
  "statusLabel",
]);

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function invalid(): never {
  throw new ApiHttpError("invalid_request");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTargetType(raw: unknown): ApiV1ExecutionUpdateTargetType {
  if (raw !== "phase" && raw !== "task") {
    invalid();
  }
  return raw;
}

function parseTargetId(raw: unknown): string {
  if (typeof raw !== "string" || !apiUuidSchema.safeParse(raw).success) {
    invalid();
  }
  return raw;
}

function parseSummary(raw: unknown): string {
  if (typeof raw !== "string") {
    invalid();
  }
  if (raw.length > SUMMARY_MAX_LENGTH) {
    invalid();
  }
  if (raw.trim().length === 0) {
    invalid();
  }
  // Preserve the original narrative content exactly as supplied.
  return raw;
}

function parseUpdateDate(raw: unknown): string {
  if (typeof raw !== "string") {
    invalid();
  }
  const match = DATE_ONLY.exec(raw);
  if (!match) {
    invalid();
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    invalid();
  }
  const utc = Date.UTC(year, month - 1, day);
  const d = new Date(utc);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    invalid();
  }
  return raw;
}

function parseStatusLabel(raw: unknown, present: boolean): string | null {
  if (!present || raw === null) {
    return null;
  }
  if (typeof raw !== "string") {
    invalid();
  }
  if (raw.length > STATUS_LABEL_MAX_LENGTH) {
    invalid();
  }
  // Blank strings pass through untouched; canonical PMG normalization
  // remains authoritative.
  return raw;
}

/**
 * Strict, closed-schema parser for the API-I append-execution-update body.
 * Receives already-decoded input only. Any unknown key — including scope,
 * provenance, idempotency or dispatch fields — is rejected.
 */
export function parseApiV1AppendExecutionUpdateBody(
  input: unknown,
): ApiV1AppendExecutionUpdateBody {
  if (!isPlainObject(input)) {
    invalid();
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) {
      invalid();
    }
  }

  const targetType = parseTargetType(input.targetType);
  const targetId = parseTargetId(input.targetId);
  const summary = parseSummary(input.summary);
  const updateDate = parseUpdateDate(input.updateDate);
  const statusLabel = parseStatusLabel(
    input.statusLabel,
    Object.prototype.hasOwnProperty.call(input, "statusLabel"),
  );

  return Object.freeze({
    targetType,
    targetId,
    summary,
    updateDate,
    statusLabel,
  }) as ApiV1AppendExecutionUpdateBody;
}

// =============================================================================
// API-M.CP.3B — Frozen Execution Update history read contract (NON-LIVE).
//
//   GET /v1/execution-updates   (execution_updates.get)
//
// This definition is deliberately NOT registered in the live router and is NOT
// advertised through /v1/capabilities in this step. The append route and its
// body parser above remain behaviorally unchanged.
// =============================================================================

export const EXECUTION_UPDATES_READ_ROUTE = Object.freeze({
  id: "execution_updates.get",
  method: "GET",
  path: "/v1/execution-updates",
  operation: "read",
} as const);

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// -----------------------------------------------------------------------------
// Dedicated Execution Update cursor (v1)
//
// The cursor carries ONLY the keyset position accepted by the CP.3A wrapper. It
// carries no target, Tenant, Organization, Workspace, Project, user, client,
// capability or authorization data, and is neither signed nor stored.
// -----------------------------------------------------------------------------

export interface ApiV1ExecutionUpdateCursor {
  readonly createdAt: string;
  readonly id: string;
}

const EXECUTION_UPDATE_CURSOR_VERSION = 1;
const EXECUTION_UPDATE_CURSOR_MAX_ENCODED_LENGTH = 512;
const EXECUTION_UPDATE_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const EXECUTION_UPDATE_CURSOR_KEYS: ReadonlyArray<string> = Object.freeze([
  "v",
  "createdAt",
  "id",
]);

function executionUpdateToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function executionUpdateFromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode an internal keyset position produced by the CP.3A wrapper into the
 * external opaque cursor. A malformed internal pair is a server defect.
 */
export function encodeApiV1ExecutionUpdateCursor(
  cursor: ApiV1ExecutionUpdateCursor,
): string {
  if (!isPlainObject(cursor)) {
    throw new ApiHttpError("internal_error");
  }
  const createdAt = cursor.createdAt;
  const id = cursor.id;
  if (typeof createdAt !== "string" || createdAt.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new ApiHttpError("internal_error");
  }
  if (
    typeof id !== "string" ||
    id === NIL_UUID ||
    !apiUuidSchema.safeParse(id).success
  ) {
    throw new ApiHttpError("internal_error");
  }

  const json = JSON.stringify({
    v: EXECUTION_UPDATE_CURSOR_VERSION,
    createdAt,
    id,
  });
  return executionUpdateToBase64Url(new TextEncoder().encode(json));
}

/** Decode an externally supplied opaque Execution Update cursor. */
export function decodeApiV1ExecutionUpdateCursor(
  raw: string,
): ApiV1ExecutionUpdateCursor {
  if (typeof raw !== "string") invalid();
  if (
    raw.length === 0 ||
    raw.length > EXECUTION_UPDATE_CURSOR_MAX_ENCODED_LENGTH
  ) {
    invalid();
  }
  if (!EXECUTION_UPDATE_BASE64URL_PATTERN.test(raw)) invalid();

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder().decode(executionUpdateFromBase64Url(raw)),
    );
  } catch {
    invalid();
  }

  if (!isPlainObject(decoded)) invalid();
  const keys = Object.keys(decoded);
  if (keys.length !== EXECUTION_UPDATE_CURSOR_KEYS.length) invalid();
  for (const key of keys) {
    if (!EXECUTION_UPDATE_CURSOR_KEYS.includes(key)) invalid();
  }
  if (decoded.v !== EXECUTION_UPDATE_CURSOR_VERSION) invalid();

  const createdAt = decoded.createdAt;
  const id = decoded.id;
  if (typeof createdAt !== "string" || createdAt.trim().length === 0) invalid();
  if (!Number.isFinite(Date.parse(createdAt))) invalid();
  if (typeof id !== "string") invalid();
  if (id === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(id).success) invalid();

  return Object.freeze({ createdAt, id }) as ApiV1ExecutionUpdateCursor;
}

// -----------------------------------------------------------------------------
// Strict GET query parser
// -----------------------------------------------------------------------------

export interface ApiV1ExecutionUpdatesReadQuery {
  readonly targetType: ApiV1ExecutionUpdateTargetType;
  readonly targetId: string;
  readonly limit: number;
  readonly cursor: ApiV1ExecutionUpdateCursor | null;
}

export const API_V1_EXECUTION_UPDATE_LIMIT_DEFAULT = 100;
export const API_V1_EXECUTION_UPDATE_LIMIT_MIN = 1;
export const API_V1_EXECUTION_UPDATE_LIMIT_MAX = 500;

const EXECUTION_UPDATE_QUERY_ALLOWED_PARAMS: ReadonlySet<string> = new Set([
  "targetType",
  "targetId",
  "limit",
  "cursor",
]);

const EXECUTION_UPDATE_DECIMAL_DIGITS_ONLY = /^[0-9]+$/;

/**
 * Strict, closed query parser for the frozen Execution Update history read.
 * `targetType` and `targetId` are mandatory; `limit` and `cursor` are optional.
 * No normalization of any supplied value is performed.
 */
export function parseApiV1ExecutionUpdatesReadQuery(
  rawSearch: string,
): ApiV1ExecutionUpdatesReadQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (rawSearch === "" || rawSearch === "?") invalid();
  if (!rawSearch.startsWith("?")) invalid();
  if (rawSearch.includes("#")) invalid();
  try {
    decodeURIComponent(rawSearch.slice(1).replace(/\+/g, " "));
  } catch {
    invalid();
  }

  const params = new URLSearchParams(rawSearch);
  for (const name of params.keys()) {
    if (!EXECUTION_UPDATE_QUERY_ALLOWED_PARAMS.has(name)) invalid();
    if (params.getAll(name).length > 1) invalid();
  }

  const rawTargetType = params.get("targetType");
  if (rawTargetType === null) invalid();
  const targetType = parseTargetType(rawTargetType);

  const rawTargetId = params.get("targetId");
  if (rawTargetId === null || rawTargetId.length === 0) invalid();
  if (rawTargetId === NIL_UUID) invalid();
  const targetId = parseTargetId(rawTargetId);

  const rawLimit = params.get("limit");
  let limit = API_V1_EXECUTION_UPDATE_LIMIT_DEFAULT;
  if (rawLimit !== null) {
    if (!EXECUTION_UPDATE_DECIMAL_DIGITS_ONLY.test(rawLimit)) invalid();
    const parsed = Number(rawLimit);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < API_V1_EXECUTION_UPDATE_LIMIT_MIN ||
      parsed > API_V1_EXECUTION_UPDATE_LIMIT_MAX
    ) {
      invalid();
    }
    limit = parsed;
  }

  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null
    ? null
    : decodeApiV1ExecutionUpdateCursor(rawCursor);

  return Object.freeze({
    targetType,
    targetId,
    limit,
    cursor,
  }) as ApiV1ExecutionUpdatesReadQuery;
}
