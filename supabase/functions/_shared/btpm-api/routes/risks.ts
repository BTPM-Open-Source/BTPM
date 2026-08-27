// API-K.7 — Pure route contracts, dynamic-path parser and strict
// closed-schema body parsers for the two external Risk mutations:
//
//   POST  /v1/risks
//   PATCH /v1/risks/:riskid
//
// This module MUST NOT read the environment, read headers, read request
// bodies, open network connections, construct Supabase clients, call RPCs,
// touch the database, hash payloads, register routes, handle HTTP requests,
// log, schedule timers, or hold any mutable global state.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const RISK_CREATE_ROUTE = Object.freeze({
  id: "risks.create",
  method: "POST",
  path: "/v1/risks",
  operation: "mutation",
} as const);

export const RISK_UPDATE_ROUTE = Object.freeze({
  id: "risks.update",
  method: "PATCH",
  path: "/v1/risks/:riskid",
  operation: "mutation",
} as const);

// -----------------------------------------------------------------------------
// Shared vocabulary
// -----------------------------------------------------------------------------

export type ApiV1RiskTargetType = "project" | "phase" | "task";
export type ApiV1RiskLikelihood = "low" | "medium" | "high";
export type ApiV1RiskImpact = "low" | "medium" | "high" | "critical";
export type ApiV1RiskStatus =
  | "open"
  | "under_mitigation"
  | "monitoring"
  | "realized"
  | "closed";

export const API_V1_RISK_TARGET_TYPES: readonly ApiV1RiskTargetType[] =
  Object.freeze(["project", "phase", "task"] as const);

export const API_V1_RISK_LIKELIHOODS: readonly ApiV1RiskLikelihood[] =
  Object.freeze(["low", "medium", "high"] as const);

export const API_V1_RISK_IMPACTS: readonly ApiV1RiskImpact[] = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
] as const);

/**
 * Canonical Risk lifecycle exposed externally. Legacy aliases
 * (`identified` / `mitigating` / `accepted`) are deliberately NOT accepted.
 */
export const API_V1_RISK_STATUSES: readonly ApiV1RiskStatus[] = Object.freeze([
  "open",
  "under_mitigation",
  "monitoring",
  "realized",
  "closed",
] as const);

const TITLE_MAX_LENGTH = 500;
const DESCRIPTION_MAX_LENGTH = 4000;
const MITIGATION_PLAN_MAX_LENGTH = 4000;

function invalid(): never {
  throw new ApiHttpError("invalid_request");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// -----------------------------------------------------------------------------
// Dynamic path parser — PATCH /v1/risks/:riskid
// -----------------------------------------------------------------------------

export interface ApiV1RiskUpdatePath {
  readonly riskId: string;
}

const RISK_UPDATE_PREFIX = "/v1/risks/";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Reject separators, percent encoding, matrix parameters and any whitespace.
const FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

export function parseApiV1RiskUpdatePath(
  pathname: string,
): ApiV1RiskUpdatePath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(RISK_UPDATE_PREFIX)) invalid();

  const remainder = pathname.slice(RISK_UPDATE_PREFIX.length);
  if (remainder.length === 0) invalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) invalid();
  if (remainder === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(remainder).success) invalid();

  return Object.freeze({ riskId: remainder }) as ApiV1RiskUpdatePath;
}

// -----------------------------------------------------------------------------
// Shared field validators
// -----------------------------------------------------------------------------

function parseTargetType(raw: unknown): ApiV1RiskTargetType {
  if (raw !== "project" && raw !== "phase" && raw !== "task") invalid();
  return raw;
}

function parseUuid(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  if (raw === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(raw).success) invalid();
  return raw;
}

function parseTitle(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  if (raw.length > TITLE_MAX_LENGTH) invalid();
  if (raw.trim().length === 0) invalid();
  // The supplied business narrative is preserved exactly.
  return raw;
}

function parseNullableText(
  raw: unknown,
  present: boolean,
  maxLength: number,
): string | null {
  if (!present || raw === null) return null;
  if (typeof raw !== "string") invalid();
  if (raw.length > maxLength) invalid();
  return raw;
}

function parseRequiredNullableText(
  raw: unknown,
  present: boolean,
  maxLength: number,
): string | null {
  if (!present) invalid();
  if (raw === null) return null;
  if (typeof raw !== "string") invalid();
  if (raw.length > maxLength) invalid();
  return raw;
}

function parseLikelihood(raw: unknown, present: boolean): ApiV1RiskLikelihood {
  if (!present) return "medium";
  return requireLikelihood(raw);
}

function requireLikelihood(raw: unknown): ApiV1RiskLikelihood {
  if (raw !== "low" && raw !== "medium" && raw !== "high") invalid();
  return raw;
}

function parseImpact(raw: unknown, present: boolean): ApiV1RiskImpact {
  if (!present) return "medium";
  return requireImpact(raw);
}

function requireImpact(raw: unknown): ApiV1RiskImpact {
  if (
    raw !== "low" && raw !== "medium" && raw !== "high" && raw !== "critical"
  ) {
    invalid();
  }
  return raw;
}

function parseStatus(raw: unknown, present: boolean): ApiV1RiskStatus {
  if (!present) return "open";
  return requireStatus(raw);
}

function requireStatus(raw: unknown): ApiV1RiskStatus {
  if (
    raw !== "open" &&
    raw !== "under_mitigation" &&
    raw !== "monitoring" &&
    raw !== "realized" &&
    raw !== "closed"
  ) {
    invalid();
  }
  return raw;
}

// -----------------------------------------------------------------------------
// Timezone-aware timestamp validation (RFC3339 + PostgreSQL compatible)
// -----------------------------------------------------------------------------

const TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

function parseExpectedUpdatedAt(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  const match = TIMESTAMPTZ_PATTERN.exec(raw);
  if (!match) invalid();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) invalid();
  if (day < 1 || day > 31) invalid();
  if (hour > 23 || minute > 59 || second > 59) invalid();

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    invalid();
  }

  const offset = match[8];
  if (offset !== "Z" && offset !== "z") {
    const sign = offset.slice(0, 1);
    const rest = offset.slice(1).replace(":", "");
    const offHour = Number(rest.slice(0, 2));
    const offMinute = rest.length > 2 ? Number(rest.slice(2, 4)) : 0;
    if (sign !== "+" && sign !== "-") invalid();
    if (!Number.isFinite(offHour) || offHour > 23) invalid();
    if (!Number.isFinite(offMinute) || offMinute > 59) invalid();
  }

  // The validated timestamp string is preserved verbatim for the wrapper.
  return raw;
}

// -----------------------------------------------------------------------------
// CREATE body — POST /v1/risks
// -----------------------------------------------------------------------------

export interface ApiV1CreateRiskBody {
  readonly targetType: ApiV1RiskTargetType;
  readonly targetId: string;
  readonly title: string;
  readonly description: string | null;
  readonly mitigationPlan: string | null;
  readonly likelihood: ApiV1RiskLikelihood;
  readonly impact: ApiV1RiskImpact;
  readonly status: ApiV1RiskStatus;
}

const CREATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "targetType",
  "targetId",
  "title",
  "description",
  "mitigationPlan",
  "likelihood",
  "impact",
  "status",
]);

/**
 * Strict, closed-schema parser for the external Risk create body. The result
 * is fully normalized (defaults resolved) BEFORE execution-context hashing so
 * the canonical idempotency payload is deterministic.
 */
export function parseApiV1CreateRiskBody(input: unknown): ApiV1CreateRiskBody {
  if (!isPlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!CREATE_ALLOWED_KEYS.has(key)) invalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  const targetType = parseTargetType(input.targetType);
  const targetId = parseUuid(input.targetId);
  const title = parseTitle(input.title);
  const description = parseNullableText(
    input.description,
    has("description"),
    DESCRIPTION_MAX_LENGTH,
  );
  const mitigationPlan = parseNullableText(
    input.mitigationPlan,
    has("mitigationPlan"),
    MITIGATION_PLAN_MAX_LENGTH,
  );
  const likelihood = parseLikelihood(input.likelihood, has("likelihood"));
  const impact = parseImpact(input.impact, has("impact"));
  const status = parseStatus(input.status, has("status"));

  return Object.freeze({
    targetType,
    targetId,
    title,
    description,
    mitigationPlan,
    likelihood,
    impact,
    status,
  }) as ApiV1CreateRiskBody;
}

// -----------------------------------------------------------------------------
// UPDATE body — PATCH /v1/risks/:riskid
// -----------------------------------------------------------------------------

export interface ApiV1UpdateRiskBody {
  readonly expectedUpdatedAt: string;
  readonly title: string;
  readonly description: string | null;
  readonly mitigationPlan: string | null;
  readonly likelihood: ApiV1RiskLikelihood;
  readonly impact: ApiV1RiskImpact;
  readonly status: ApiV1RiskStatus;
}

const UPDATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt",
  "title",
  "description",
  "mitigationPlan",
  "likelihood",
  "impact",
  "status",
]);

/**
 * Strict, closed-schema parser for the external Risk update body. All seven
 * keys are required: for API-K.7 the body is the COMPLETE scalar desired
 * state. No partial-field filling from the database is performed here — the
 * canonical command remains the sole read/decrypt/update mechanism.
 */
export function parseApiV1UpdateRiskBody(input: unknown): ApiV1UpdateRiskBody {
  if (!isPlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!UPDATE_ALLOWED_KEYS.has(key)) invalid();
  }
  for (const key of UPDATE_ALLOWED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) invalid();
  }

  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  const title = parseTitle(input.title);
  const description = parseRequiredNullableText(
    input.description,
    true,
    DESCRIPTION_MAX_LENGTH,
  );
  const mitigationPlan = parseRequiredNullableText(
    input.mitigationPlan,
    true,
    MITIGATION_PLAN_MAX_LENGTH,
  );
  const likelihood = requireLikelihood(input.likelihood);
  const impact = requireImpact(input.impact);
  const status = requireStatus(input.status);

  return Object.freeze({
    expectedUpdatedAt,
    title,
    description,
    mitigationPlan,
    likelihood,
    impact,
    status,
  }) as ApiV1UpdateRiskBody;
}

/**
 * Canonical idempotency payload for a Risk update. The Risk identity lives in
 * the URL, not the body, so it MUST be folded into the hashed payload.
 */
export function buildApiV1UpdateRiskIdempotencyPayload(
  riskId: string,
  body: ApiV1UpdateRiskBody,
): Readonly<{ riskId: string } & ApiV1UpdateRiskBody> {
  if (typeof riskId !== "string" || riskId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    riskId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    title: body.title,
    description: body.description,
    mitigationPlan: body.mitigationPlan,
    likelihood: body.likelihood,
    impact: body.impact,
    status: body.status,
  });
}

// =============================================================================
// API-M.CP.2B1 — Risk HTTP read foundation (NOT yet live)
//
// Pure route contracts, strict path/query parsers and one narrow opaque
// collection cursor codec for the two frozen Risk reads:
//
//   GET /v1/projects/{projectId}/risks   (risks.get)
//   GET /v1/risks/{riskId}               (risks.get_by_id)
//
// These definitions are deliberately NOT registered in the live router and
// are NOT advertised through /v1/capabilities in this step.
// =============================================================================

export const RISK_PROJECT_COLLECTION_ROUTE = Object.freeze({
  id: "risks.get",
  method: "GET",
  path: "/v1/projects/:projectid/risks",
  operation: "read",
} as const);

export const RISK_DETAIL_ROUTE = Object.freeze({
  id: "risks.get_by_id",
  method: "GET",
  path: "/v1/risks/:riskid",
  operation: "read",
} as const);

// -----------------------------------------------------------------------------
// Path parsers
// -----------------------------------------------------------------------------

export interface ApiV1ProjectRisksPath {
  readonly projectId: string;
}

export interface ApiV1RiskDetailPath {
  readonly riskId: string;
}

const RISK_COLLECTION_PREFIX = "/v1/projects/";
const RISK_COLLECTION_SUFFIX = "/risks";

function parseStrictUuidSegment(segment: string): string {
  if (segment.length === 0) invalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(segment)) invalid();
  if (segment === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(segment).success) invalid();
  return segment;
}

/** Strict parser for `GET /v1/projects/:projectid/risks`. */
export function parseApiV1ProjectRisksPath(
  pathname: string,
): ApiV1ProjectRisksPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(RISK_COLLECTION_PREFIX)) invalid();
  if (!pathname.endsWith(RISK_COLLECTION_SUFFIX)) invalid();

  const middle = pathname.slice(
    RISK_COLLECTION_PREFIX.length,
    pathname.length - RISK_COLLECTION_SUFFIX.length,
  );

  return Object.freeze({
    projectId: parseStrictUuidSegment(middle),
  }) as ApiV1ProjectRisksPath;
}

/** Strict parser for `GET /v1/risks/:riskid`. */
export function parseApiV1RiskDetailPath(
  pathname: string,
): ApiV1RiskDetailPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(RISK_UPDATE_PREFIX)) invalid();

  const remainder = pathname.slice(RISK_UPDATE_PREFIX.length);
  return Object.freeze({
    riskId: parseStrictUuidSegment(remainder),
  }) as ApiV1RiskDetailPath;
}

// -----------------------------------------------------------------------------
// Opaque collection cursor (v1)
//
// The cursor carries ONLY the keyset position accepted by the CP.2A/C1 SQL
// wrapper. It carries no Tenant, Organization, Workspace, Project, capability
// or authorization data and is neither signed nor stored.
// -----------------------------------------------------------------------------

export interface ApiV1RiskCursor {
  readonly createdAt: string;
  readonly id: string;
}

const RISK_CURSOR_VERSION = 1;
const RISK_CURSOR_MAX_ENCODED_LENGTH = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const RISK_CURSOR_KEYS: ReadonlyArray<string> = Object.freeze([
  "v",
  "createdAt",
  "id",
]);

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode an internal keyset position produced by the SQL wrapper into the
 * external opaque cursor. A malformed internal pair is a server defect.
 */
export function encodeApiV1RiskCursor(cursor: ApiV1RiskCursor): string {
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

  const json = JSON.stringify({ v: RISK_CURSOR_VERSION, createdAt, id });
  return toBase64Url(new TextEncoder().encode(json));
}

/** Decode an externally supplied opaque cursor. */
export function decodeApiV1RiskCursor(raw: string): ApiV1RiskCursor {
  if (typeof raw !== "string") invalid();
  if (raw.length === 0 || raw.length > RISK_CURSOR_MAX_ENCODED_LENGTH) {
    invalid();
  }
  if (!BASE64URL_PATTERN.test(raw)) invalid();

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(raw)));
  } catch {
    invalid();
  }

  if (!isPlainObject(decoded)) invalid();
  const keys = Object.keys(decoded);
  if (keys.length !== RISK_CURSOR_KEYS.length) invalid();
  for (const key of keys) {
    if (!RISK_CURSOR_KEYS.includes(key)) invalid();
  }
  if (decoded.v !== RISK_CURSOR_VERSION) invalid();

  const createdAt = decoded.createdAt;
  const id = decoded.id;
  if (typeof createdAt !== "string" || createdAt.trim().length === 0) invalid();
  if (!Number.isFinite(Date.parse(createdAt))) invalid();
  if (typeof id !== "string") invalid();
  if (id === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(id).success) invalid();

  return Object.freeze({ createdAt, id }) as ApiV1RiskCursor;
}

// -----------------------------------------------------------------------------
// Collection query parser
// -----------------------------------------------------------------------------

export interface ApiV1ProjectRisksQuery {
  readonly limit: number;
  readonly cursor: ApiV1RiskCursor | null;
}

export const API_V1_RISK_LIMIT_DEFAULT = 100;
export const API_V1_RISK_LIMIT_MIN = 1;
export const API_V1_RISK_LIMIT_MAX = 500;

const RISK_QUERY_ALLOWED_PARAMS: ReadonlySet<string> = new Set([
  "limit",
  "cursor",
]);

const RISK_DECIMAL_DIGITS_ONLY = /^[0-9]+$/;

export function parseApiV1ProjectRisksQuery(
  rawSearch: string,
): ApiV1ProjectRisksQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  // No query string at all is valid and means default limit, no cursor.
  if (rawSearch === "" || rawSearch === "?") {
    return Object.freeze({
      limit: API_V1_RISK_LIMIT_DEFAULT,
      cursor: null,
    }) as ApiV1ProjectRisksQuery;
  }

  if (!rawSearch.startsWith("?")) invalid();
  if (rawSearch.includes("#")) invalid();
  try {
    decodeURIComponent(rawSearch.slice(1).replace(/\+/g, " "));
  } catch {
    invalid();
  }

  const params = new URLSearchParams(rawSearch);
  for (const name of params.keys()) {
    if (!RISK_QUERY_ALLOWED_PARAMS.has(name)) invalid();
    if (params.getAll(name).length > 1) invalid();
  }

  const rawLimit = params.get("limit");
  let limit = API_V1_RISK_LIMIT_DEFAULT;
  if (rawLimit !== null) {
    if (!RISK_DECIMAL_DIGITS_ONLY.test(rawLimit)) invalid();
    const parsed = Number(rawLimit);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < API_V1_RISK_LIMIT_MIN ||
      parsed > API_V1_RISK_LIMIT_MAX
    ) {
      invalid();
    }
    limit = parsed;
  }

  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? null : decodeApiV1RiskCursor(rawCursor);

  return Object.freeze({ limit, cursor }) as ApiV1ProjectRisksQuery;
}
