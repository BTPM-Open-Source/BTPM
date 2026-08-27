// API-Q Portfolio-3 — Pure route contracts and strict parsers for the three
// Portfolio reads:
//
//   GET /v1/portfolios                          → portfolios.get
//   GET /v1/portfolios/:portfolioid             → portfolios.get_by_id
//   GET /v1/portfolios/:portfolioid/projects    → portfolios.projects.get
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes, handle HTTP
// requests, log, schedule timers, or hold any mutable global state. It follows
// the accepted Program/Project read posture exactly; no generic cross-domain
// resource-ID parser is introduced.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const PORTFOLIOS_ROUTE = Object.freeze({
  id: "portfolios.get",
  method: "GET",
  path: "/v1/portfolios",
  operation: "read",
} as const);

export const PORTFOLIO_DETAIL_ROUTE = Object.freeze({
  id: "portfolios.get_by_id",
  method: "GET",
  path: "/v1/portfolios/:portfolioid",
  operation: "read",
} as const);

export const PORTFOLIO_PROJECTS_ROUTE = Object.freeze({
  id: "portfolios.projects.get",
  method: "GET",
  path: "/v1/portfolios/:portfolioid/projects",
  operation: "read",
} as const);

const LIMIT_DEFAULT = 50;
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const OFFSET_DEFAULT = 0;
const OFFSET_MIN = 0;
const OFFSET_MAX = 10000;
const SEARCH_MAX_LENGTH = 100;

const DECIMAL_DIGITS_ONLY = /^[0-9]+$/;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function isSafeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value);
}

function parseDecimalParam(
  raw: string | null,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === null) {
    return defaultValue;
  }
  if (!DECIMAL_DIGITS_ONLY.test(raw)) {
    throw new ApiHttpError("invalid_request");
  }
  const n = Number(raw);
  if (!isSafeInteger(n) || n < min || n > max) {
    throw new ApiHttpError("invalid_request");
  }
  return n;
}

function parseSearchParam(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > SEARCH_MAX_LENGTH) {
    throw new ApiHttpError("invalid_request");
  }
  return trimmed;
}

/**
 * `include_archived` accepts only the literal strings "true" and "false"; an
 * absent parameter means `false`. No other truthy/falsey spelling is coerced.
 */
function parseIncludeArchivedParam(raw: string | null): boolean {
  if (raw === null) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ApiHttpError("invalid_request");
}

function parseRequiredUuidParam(raw: string | null): string {
  if (raw === null || raw.length === 0) {
    throw new ApiHttpError("invalid_request");
  }
  if (raw === NIL_UUID) {
    throw new ApiHttpError("invalid_request");
  }
  if (!apiUuidSchema.safeParse(raw).success) {
    throw new ApiHttpError("invalid_request");
  }
  return raw;
}

function assertValidPercentEncoding(raw: string): void {
  try {
    decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    throw new ApiHttpError("invalid_request");
  }
}

function assertNoDuplicateOrUnknownParams(
  params: URLSearchParams,
  allowed: ReadonlySet<string>,
): void {
  for (const name of params.keys()) {
    if (!allowed.has(name)) {
      throw new ApiHttpError("invalid_request");
    }
    if (params.getAll(name).length > 1) {
      throw new ApiHttpError("invalid_request");
    }
  }
}

// -----------------------------------------------------------------------------
// GET /v1/portfolios collection query
// -----------------------------------------------------------------------------

export interface ApiV1PortfoliosRouteQuery {
  readonly organizationId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
  readonly includeArchived: boolean;
}

/**
 * `organization_id` is the ONLY external Organization key, and
 * `include_archived` the only archive switch. The camelCase `organizationId`
 * and `includeArchived` aliases are deliberately absent and are therefore
 * rejected as unknown parameters.
 */
const PORTFOLIOS_ALLOWED_PARAM_NAMES: ReadonlySet<string> = new Set([
  "organization_id",
  "limit",
  "offset",
  "search",
  "include_archived",
]);

export function parseApiV1PortfoliosQuery(
  rawSearch: string,
): ApiV1PortfoliosRouteQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  // organization_id is required, so an absent/empty raw query is never valid.
  if (rawSearch === "" || !rawSearch.startsWith("?")) {
    throw new ApiHttpError("invalid_request");
  }

  if (rawSearch.includes("#")) {
    throw new ApiHttpError("invalid_request");
  }

  assertValidPercentEncoding(rawSearch.slice(1));

  const params = new URLSearchParams(rawSearch);
  assertNoDuplicateOrUnknownParams(params, PORTFOLIOS_ALLOWED_PARAM_NAMES);

  const organizationId = parseRequiredUuidParam(params.get("organization_id"));
  const limit = parseDecimalParam(
    params.get("limit"),
    LIMIT_DEFAULT,
    LIMIT_MIN,
    LIMIT_MAX,
  );
  const offset = parseDecimalParam(
    params.get("offset"),
    OFFSET_DEFAULT,
    OFFSET_MIN,
    OFFSET_MAX,
  );
  const search = parseSearchParam(params.get("search"));
  const includeArchived = parseIncludeArchivedParam(
    params.get("include_archived"),
  );

  return Object.freeze({
    organizationId,
    limit,
    offset,
    search,
    includeArchived,
  }) as ApiV1PortfoliosRouteQuery;
}

// -----------------------------------------------------------------------------
// Portfolio detail path
// -----------------------------------------------------------------------------

export interface ApiV1PortfolioDetailPath {
  readonly portfolioId: string;
}

const PORTFOLIO_PREFIX = "/v1/portfolios/";

// Reject separators, encoding, matrix parameters and any whitespace.
const FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

/**
 * Strict Portfolio detail path parser. It deliberately rejects the nested
 * `/projects` route because the remaining segment must be exactly one non-nil
 * UUID with no additional separator.
 */
export function parseApiV1PortfolioDetailPath(
  pathname: string,
): ApiV1PortfolioDetailPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (!pathname.startsWith(PORTFOLIO_PREFIX)) {
    throw new ApiHttpError("invalid_request");
  }

  const remainder = pathname.slice(PORTFOLIO_PREFIX.length);

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
    portfolioId: remainder,
  }) as ApiV1PortfolioDetailPath;
}

// -----------------------------------------------------------------------------
// Portfolio Projects nested path + query
// -----------------------------------------------------------------------------

export interface ApiV1PortfolioProjectsPath {
  readonly portfolioId: string;
}

export interface ApiV1PortfolioProjectsRouteQuery {
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

const PORTFOLIO_PROJECTS_SUFFIX = "/projects";

/**
 * Strict nested Portfolio Projects path parser: exactly
 * `/v1/portfolios/<non-nil UUID>/projects`, with no trailing slash and no
 * additional segment.
 */
export function parseApiV1PortfolioProjectsPath(
  pathname: string,
): ApiV1PortfolioProjectsPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (!pathname.startsWith(PORTFOLIO_PREFIX)) {
    throw new ApiHttpError("invalid_request");
  }

  if (!pathname.endsWith(PORTFOLIO_PROJECTS_SUFFIX)) {
    throw new ApiHttpError("invalid_request");
  }

  const remainder = pathname.slice(
    PORTFOLIO_PREFIX.length,
    pathname.length - PORTFOLIO_PROJECTS_SUFFIX.length,
  );

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
    portfolioId: remainder,
  }) as ApiV1PortfolioProjectsPath;
}

const PORTFOLIO_PROJECTS_ALLOWED_PARAM_NAMES: ReadonlySet<string> = new Set([
  "limit",
  "offset",
  "search",
]);

/**
 * Strict nested Portfolio Projects query parser. An empty query string is
 * valid and yields the canonical defaults.
 */
export function parseApiV1PortfolioProjectsQuery(
  rawSearch: string,
): ApiV1PortfolioProjectsRouteQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (rawSearch.includes("#")) {
    throw new ApiHttpError("invalid_request");
  }

  if (rawSearch === "") {
    return Object.freeze({
      limit: LIMIT_DEFAULT,
      offset: OFFSET_DEFAULT,
      search: null,
    }) as ApiV1PortfolioProjectsRouteQuery;
  }

  if (!rawSearch.startsWith("?")) {
    throw new ApiHttpError("invalid_request");
  }

  assertValidPercentEncoding(rawSearch.slice(1));

  const params = new URLSearchParams(rawSearch);
  assertNoDuplicateOrUnknownParams(
    params,
    PORTFOLIO_PROJECTS_ALLOWED_PARAM_NAMES,
  );

  const limit = parseDecimalParam(
    params.get("limit"),
    LIMIT_DEFAULT,
    LIMIT_MIN,
    LIMIT_MAX,
  );
  const offset = parseDecimalParam(
    params.get("offset"),
    OFFSET_DEFAULT,
    OFFSET_MIN,
    OFFSET_MAX,
  );
  const search = parseSearchParam(params.get("search"));

  return Object.freeze({
    limit,
    offset,
    search,
  }) as ApiV1PortfolioProjectsRouteQuery;
}

// =============================================================================
// API-Q Portfolio-4B — POST /v1/portfolios (portfolios.create)
//
// Exactly one new external Portfolio command surface. Strict closed-schema
// body, fully materialized and normalized BEFORE execution-context hashing so
// the API-F canonical payload is deterministic. No archive, assignment, team,
// Tenant, Workspace or protected Portfolio field is reachable here, and no
// Organization/owner database lookup is performed in TypeScript: the accepted
// `public.api_v1_create_portfolio` wrapper remains the sole business authority.
// =============================================================================

export const PORTFOLIO_CREATE_ROUTE = Object.freeze({
  id: "portfolios.create",
  method: "POST",
  path: "/v1/portfolios",
  operation: "mutation",
} as const);

const PORTFOLIO_NAME_MAX_LENGTH = 200;
const PORTFOLIO_CODE_MAX_LENGTH = 80;
const PORTFOLIO_DESCRIPTION_MAX_LENGTH = 4000;

/** Canonical `public.portfolio_items` lifecycle vocabulary. */
export type ApiV1PortfolioLifecycleState =
  | "opportunity_candidate"
  | "business_case_approved"
  | "contracted"
  | "development"
  | "submission_approval"
  | "launch_preparation"
  | "launched_commercial"
  | "lcm_optimization"
  | "on_hold"
  | "discontinuation"
  | "retired";

/** Canonical Portfolio strategic-priority vocabulary. */
export type ApiV1PortfolioStrategicPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "watchlist";

export const API_V1_PORTFOLIO_LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  "opportunity_candidate",
  "business_case_approved",
  "contracted",
  "development",
  "submission_approval",
  "launch_preparation",
  "launched_commercial",
  "lcm_optimization",
  "on_hold",
  "discontinuation",
  "retired",
]);

export const API_V1_PORTFOLIO_STRATEGIC_PRIORITIES: ReadonlySet<string> =
  new Set([
    "critical",
    "high",
    "medium",
    "low",
    "watchlist",
  ]);

/** Canonical absent-value defaults, applied before hashing. */
const PORTFOLIO_DEFAULT_LIFECYCLE_STATE: ApiV1PortfolioLifecycleState =
  "opportunity_candidate";
const PORTFOLIO_DEFAULT_STRATEGIC_PRIORITY: ApiV1PortfolioStrategicPriority =
  "medium";

export interface ApiV1CreatePortfolioBody {
  readonly organizationId: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly lifecycleState: ApiV1PortfolioLifecycleState;
  readonly strategicPriority: ApiV1PortfolioStrategicPriority;
  readonly ownerId: string | null;
}

const PORTFOLIO_CREATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "organizationId",
  "name",
  "code",
  "description",
  "lifecycleState",
  "strategicPriority",
  "ownerId",
]);

function portfolioInvalid(): never {
  throw new ApiHttpError("invalid_request");
}

function isPortfolioPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Exact behavioural equivalent of PostgreSQL `btrim(text)` with the default
 * character set: ordinary U+0020 space characters are removed from BOTH ends
 * and nothing else, matching the canonical `public.api_v1_create_portfolio`
 * name normalization.
 */
export function canonicalizePortfolioText(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && raw.charCodeAt(start) === 0x20) start += 1;
  while (end > start && raw.charCodeAt(end - 1) === 0x20) end -= 1;
  return raw.slice(start, end);
}

function parsePortfolioRequiredUuid(raw: unknown): string {
  if (typeof raw !== "string") portfolioInvalid();
  if (raw === NIL_UUID) portfolioInvalid();
  if (!apiUuidSchema.safeParse(raw).success) portfolioInvalid();
  return raw;
}

function parsePortfolioName(raw: unknown): string {
  if (typeof raw !== "string") portfolioInvalid();
  const canonical = canonicalizePortfolioText(raw);
  if (canonical.length === 0) portfolioInvalid();
  if (canonical.length > PORTFOLIO_NAME_MAX_LENGTH) portfolioInvalid();
  return canonical;
}

/**
 * `code` and `description` are preserved EXACTLY as supplied (no trimming, no
 * case normalization); only absence or an explicit `null` becomes `null`.
 */
function parsePortfolioOptionalText(
  raw: unknown,
  present: boolean,
  maxLength: number,
): string | null {
  if (!present || raw === null) return null;
  if (typeof raw !== "string") portfolioInvalid();
  if (raw.length > maxLength) portfolioInvalid();
  return raw;
}

function parsePortfolioLifecycleState(
  raw: unknown,
  present: boolean,
): ApiV1PortfolioLifecycleState {
  if (!present) return PORTFOLIO_DEFAULT_LIFECYCLE_STATE;
  if (typeof raw !== "string") portfolioInvalid();
  if (!API_V1_PORTFOLIO_LIFECYCLE_STATES.has(raw)) portfolioInvalid();
  return raw as ApiV1PortfolioLifecycleState;
}

function parsePortfolioStrategicPriority(
  raw: unknown,
  present: boolean,
): ApiV1PortfolioStrategicPriority {
  if (!present) return PORTFOLIO_DEFAULT_STRATEGIC_PRIORITY;
  if (typeof raw !== "string") portfolioInvalid();
  if (!API_V1_PORTFOLIO_STRATEGIC_PRIORITIES.has(raw)) portfolioInvalid();
  return raw as ApiV1PortfolioStrategicPriority;
}

function parsePortfolioOwnerId(raw: unknown, present: boolean): string | null {
  if (!present || raw === null) return null;
  return parsePortfolioRequiredUuid(raw);
}

/**
 * Strict, closed-schema parser for the external Portfolio create body.
 * `organizationId` and `name` are required; every other property is optional
 * and materialized to its canonical default so the returned body always
 * carries all seven properties before API-F hashing. Any other key — including
 * every snake_case alias — is rejected.
 */
export function parseApiV1CreatePortfolioBody(
  input: unknown,
): ApiV1CreatePortfolioBody {
  if (!isPortfolioPlainObject(input)) portfolioInvalid();

  for (const key of Object.keys(input)) {
    if (!PORTFOLIO_CREATE_ALLOWED_KEYS.has(key)) portfolioInvalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  if (!has("organizationId") || !has("name")) portfolioInvalid();

  const organizationId = parsePortfolioRequiredUuid(input.organizationId);
  const name = parsePortfolioName(input.name);
  const code = parsePortfolioOptionalText(
    input.code,
    has("code"),
    PORTFOLIO_CODE_MAX_LENGTH,
  );
  const description = parsePortfolioOptionalText(
    input.description,
    has("description"),
    PORTFOLIO_DESCRIPTION_MAX_LENGTH,
  );
  const lifecycleState = parsePortfolioLifecycleState(
    input.lifecycleState,
    has("lifecycleState"),
  );
  const strategicPriority = parsePortfolioStrategicPriority(
    input.strategicPriority,
    has("strategicPriority"),
  );
  const ownerId = parsePortfolioOwnerId(input.ownerId, has("ownerId"));

  return Object.freeze({
    organizationId,
    name,
    code,
    description,
    lifecycleState,
    strategicPriority,
    ownerId,
  }) as ApiV1CreatePortfolioBody;
}

// =============================================================================
// API-Q Portfolio-5B — PATCH /v1/portfolios/:portfolioid (portfolios.update)
//
// Exactly one new external Portfolio command surface, mirroring the accepted
// Program Update HTTP architecture. Strict closed-schema body with explicit
// PATCH presence semantics, fully materialized BEFORE execution-context hashing
// so the API-F canonical payload is deterministic. No archive, assignment, team,
// Tenant, Workspace, Organization-move or protected Portfolio field is reachable
// here, and no Organization/owner/Portfolio database lookup is performed in
// TypeScript: the accepted `public.api_v1_update_portfolio` wrapper remains the
// sole business authority.
// =============================================================================

export const PORTFOLIO_UPDATE_ROUTE = Object.freeze({
  id: "portfolios.update",
  method: "PATCH",
  path: "/v1/portfolios/:portfolioid",
  operation: "mutation",
} as const);

export interface ApiV1PortfolioUpdatePath {
  readonly portfolioId: string;
}

/**
 * Strict `PATCH /v1/portfolios/<non-nil UUID>` path parser. The collection
 * path, a missing/nil/malformed identifier, a trailing slash, any nested
 * segment, any encoded separator, any matrix parameter, any query or fragment
 * residue and any whitespace variant are all rejected. No wildcard Portfolio
 * matching is introduced.
 */
export function parseApiV1PortfolioUpdatePath(
  pathname: string,
): ApiV1PortfolioUpdatePath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(PORTFOLIO_PREFIX)) portfolioInvalid();
  const remainder = pathname.slice(PORTFOLIO_PREFIX.length);
  if (remainder.length === 0) portfolioInvalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) portfolioInvalid();
  if (remainder === NIL_UUID) portfolioInvalid();
  if (!apiUuidSchema.safeParse(remainder).success) portfolioInvalid();
  return Object.freeze({
    portfolioId: remainder,
  }) as ApiV1PortfolioUpdatePath;
}

export interface ApiV1UpdatePortfolioBody {
  readonly expectedUpdatedAt: string;
  readonly name: string | null;
  readonly setName: boolean;
  readonly code: string | null;
  readonly setCode: boolean;
  readonly description: string | null;
  readonly setDescription: boolean;
  readonly lifecycleState: ApiV1PortfolioLifecycleState | null;
  readonly setLifecycleState: boolean;
  readonly strategicPriority: ApiV1PortfolioStrategicPriority | null;
  readonly setStrategicPriority: boolean;
  readonly ownerId: string | null;
  readonly setOwnerId: boolean;
}

const PORTFOLIO_UPDATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt",
  "name",
  "code",
  "description",
  "lifecycleState",
  "strategicPriority",
  "ownerId",
]);

/** The six mutable Portfolio fields; at least one must be present. */
const PORTFOLIO_UPDATE_MUTABLE_KEYS: ReadonlyArray<string> = Object.freeze([
  "name",
  "code",
  "description",
  "lifecycleState",
  "strategicPriority",
  "ownerId",
]);

const PORTFOLIO_UPDATE_TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Required timezone-aware PostgreSQL-compatible timestamp, validated exactly as
 * in the accepted Program Update contract and preserved verbatim so the
 * canonical concurrency comparison is performed by the database only.
 */
export function parsePortfolioExpectedUpdatedAt(raw: unknown): string {
  if (typeof raw !== "string") portfolioInvalid();
  const match = PORTFOLIO_UPDATE_TIMESTAMPTZ_PATTERN.exec(raw);
  if (!match) portfolioInvalid();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) portfolioInvalid();
  if (day < 1 || day > 31) portfolioInvalid();
  if (hour > 23 || minute > 59 || second > 59) portfolioInvalid();

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    portfolioInvalid();
  }

  const offset = match[8];
  if (offset !== "Z" && offset !== "z") {
    const sign = offset.slice(0, 1);
    const rest = offset.slice(1).replace(":", "");
    const offHour = Number(rest.slice(0, 2));
    const offMinute = rest.length > 2 ? Number(rest.slice(2, 4)) : 0;
    if (sign !== "+" && sign !== "-") portfolioInvalid();
    if (!Number.isFinite(offHour) || offHour > 23) portfolioInvalid();
    if (!Number.isFinite(offMinute) || offMinute > 59) portfolioInvalid();
  }

  return raw;
}

/**
 * `code` / `description` clearable text: an explicit `null` clears the value,
 * while a supplied string is preserved EXACTLY as given, including whitespace
 * and the empty string.
 */
function parsePortfolioClearableText(
  raw: unknown,
  maxLength: number,
): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") portfolioInvalid();
  if (raw.length > maxLength) portfolioInvalid();
  return raw;
}

/**
 * Strict, closed-schema parser for the external Portfolio update body.
 * `expectedUpdatedAt` is required and at least one of the six mutable fields
 * must also be present. `name`, `lifecycleState` and `strategicPriority` are
 * non-clearable (explicit `null` is invalid); `code`, `description` and
 * `ownerId` distinguish absence from an explicit clear. Any other key —
 * including `organizationId`, `workspaceId`, `tenantId`, `portfolioId`,
 * `isArchived`, `archivedAt`, every team/member field and every snake_case
 * alias — is rejected.
 */
export function parseApiV1UpdatePortfolioBody(
  input: unknown,
): ApiV1UpdatePortfolioBody {
  if (!isPortfolioPlainObject(input)) portfolioInvalid();

  for (const key of Object.keys(input)) {
    if (!PORTFOLIO_UPDATE_ALLOWED_KEYS.has(key)) portfolioInvalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  if (!has("expectedUpdatedAt")) portfolioInvalid();
  if (!PORTFOLIO_UPDATE_MUTABLE_KEYS.some((k) => has(k))) portfolioInvalid();

  const expectedUpdatedAt = parsePortfolioExpectedUpdatedAt(
    input.expectedUpdatedAt,
  );

  const setName = has("name");
  const name = setName ? parsePortfolioName(input.name) : null;

  const setCode = has("code");
  const code = setCode
    ? parsePortfolioClearableText(input.code, PORTFOLIO_CODE_MAX_LENGTH)
    : null;

  const setDescription = has("description");
  const description = setDescription
    ? parsePortfolioClearableText(
      input.description,
      PORTFOLIO_DESCRIPTION_MAX_LENGTH,
    )
    : null;

  const setLifecycleState = has("lifecycleState");
  const lifecycleState = setLifecycleState
    ? parsePortfolioLifecycleState(input.lifecycleState, true)
    : null;

  const setStrategicPriority = has("strategicPriority");
  const strategicPriority = setStrategicPriority
    ? parsePortfolioStrategicPriority(input.strategicPriority, true)
    : null;

  const setOwnerId = has("ownerId");
  const ownerId = setOwnerId
    ? (input.ownerId === null ? null : parsePortfolioRequiredUuid(input.ownerId))
    : null;

  return Object.freeze({
    expectedUpdatedAt,
    name,
    setName,
    code,
    setCode,
    description,
    setDescription,
    lifecycleState,
    setLifecycleState,
    strategicPriority,
    setStrategicPriority,
    ownerId,
    setOwnerId,
  }) as ApiV1UpdatePortfolioBody;
}

/**
 * Deterministic canonical API-F idempotency payload for the Portfolio update
 * command. The Portfolio identity lives in the URL, so it is folded in
 * explicitly. Every presence flag contributes independently, so an omitted
 * clearable value can never hash identically to an explicit clear. No request,
 * user, OAuth, Tenant or Organization metadata is included.
 */
export function buildApiV1UpdatePortfolioIdempotencyPayload(
  portfolioId: string,
  body: ApiV1UpdatePortfolioBody,
): Record<string, unknown> {
  return Object.freeze({
    portfolioId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    setName: body.setName,
    name: body.name,
    setCode: body.setCode,
    code: body.code,
    setDescription: body.setDescription,
    description: body.description,
    setLifecycleState: body.setLifecycleState,
    lifecycleState: body.lifecycleState,
    setStrategicPriority: body.setStrategicPriority,
    strategicPriority: body.strategicPriority,
    setOwnerId: body.setOwnerId,
    ownerId: body.ownerId,
  });
}

// =============================================================================
// API-Q Portfolio-6B — PUT /v1/projects/:projectid/portfolio
// (portfolios.assign_project)
//
// Exactly one new external Project↔Portfolio assignment surface, mirroring the
// accepted Task Assignment HTTP architecture. The body carries exactly one key
// and there is deliberately NO optimistic-concurrency token: the accepted
// `public.api_v1_assign_project_portfolio` wrapper owns Project-derived scope,
// Connected App enablement, PM authority, idempotency, provenance and the
// canonical `public.assign_project_portfolio` business write.
// =============================================================================

export const PORTFOLIO_ASSIGN_PROJECT_ROUTE = Object.freeze({
  id: "portfolios.assign_project",
  method: "PUT",
  path: "/v1/projects/:projectid/portfolio",
  operation: "mutation",
} as const);

const PORTFOLIO_ASSIGN_PROJECT_PREFIX = "/v1/projects/";
const PORTFOLIO_ASSIGN_PROJECT_SUFFIX = "/portfolio";

export interface ApiV1PortfolioAssignProjectPath {
  readonly projectId: string;
}

/**
 * Strict `PUT /v1/projects/<non-nil UUID>/portfolio` path parser. A missing,
 * nil or malformed identifier, a trailing slash, any additional nested segment,
 * any encoded separator, any matrix parameter, any query or fragment residue
 * and any whitespace variant are all rejected. No wildcard `/v1/projects/*`
 * matching is introduced.
 */
export function parseApiV1PortfolioAssignProjectPath(
  pathname: string,
): ApiV1PortfolioAssignProjectPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(PORTFOLIO_ASSIGN_PROJECT_PREFIX)) {
    portfolioInvalid();
  }
  if (!pathname.endsWith(PORTFOLIO_ASSIGN_PROJECT_SUFFIX)) {
    portfolioInvalid();
  }
  const remainder = pathname.slice(
    PORTFOLIO_ASSIGN_PROJECT_PREFIX.length,
    pathname.length - PORTFOLIO_ASSIGN_PROJECT_SUFFIX.length,
  );
  if (remainder.length === 0) portfolioInvalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) portfolioInvalid();
  if (remainder === NIL_UUID) portfolioInvalid();
  if (!apiUuidSchema.safeParse(remainder).success) portfolioInvalid();
  return Object.freeze({
    projectId: remainder,
  }) as ApiV1PortfolioAssignProjectPath;
}

export interface ApiV1AssignProjectPortfolioBody {
  /** `null` means clear the Project's Portfolio assignment. */
  readonly portfolioId: string | null;
}

const PORTFOLIO_ASSIGN_PROJECT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "portfolioId",
]);

/**
 * Strict, closed-schema parser for the external Project↔Portfolio assignment
 * body. Exactly one key is accepted and it must be present: a non-nil UUID
 * assigns/moves the Project, an explicit `null` clears the assignment. There is
 * deliberately no `expectedUpdatedAt`, no Organization/Workspace/Tenant field,
 * no alias and no additional key.
 */
export function parseApiV1AssignProjectPortfolioBody(
  input: unknown,
): ApiV1AssignProjectPortfolioBody {
  if (!isPortfolioPlainObject(input)) portfolioInvalid();

  for (const key of Object.keys(input)) {
    if (!PORTFOLIO_ASSIGN_PROJECT_ALLOWED_KEYS.has(key)) portfolioInvalid();
  }

  if (!Object.prototype.hasOwnProperty.call(input, "portfolioId")) {
    portfolioInvalid();
  }

  const raw = input.portfolioId;
  const portfolioId = raw === null ? null : parsePortfolioRequiredUuid(raw);

  return Object.freeze({ portfolioId }) as ApiV1AssignProjectPortfolioBody;
}

/**
 * Deterministic canonical API-F idempotency payload for the Project↔Portfolio
 * assignment command. The Project identity lives in the URL, so it is folded in
 * explicitly. No request, user, OAuth, Tenant, Organization or Workspace
 * metadata is included, and there is no concurrency token to hash.
 */
export function buildApiV1AssignProjectPortfolioIdempotencyPayload(
  projectId: string,
  body: ApiV1AssignProjectPortfolioBody,
): Record<string, unknown> {
  return Object.freeze({
    projectId,
    portfolioId: body.portfolioId,
  });
}
