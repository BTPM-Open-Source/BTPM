// API-Q Portfolio-4B — Explicit RPC adapter for the single external Portfolio
// mutation (`portfolios:create`).
//
// This module calls exactly one accepted Portfolio-4A database wrapper,
// `public.api_v1_create_portfolio`, through a caller-supplied Supabase RPC
// client. The caller-supplied client is the trust boundary: the runtime must
// supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, exposes no generic RPC executor, performs no
// dynamic dispatch, touches no table directly, and never reads Organization,
// owner or Portfolio data.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact REST-source database wrapper invoked by this module. */
const API_V1_CREATE_PORTFOLIO_FUNCTION_NAME = "api_v1_create_portfolio";

/** Exact MCP-source database wrapper invoked by this module (Portfolio-9A). */
const MCP_V1_CREATE_PORTFOLIO_FUNCTION_NAME = "mcp_v1_create_portfolio";

/** Closed set of the only two accepted Portfolio Create wrapper names. */
type CreatePortfolioFunctionName =
  | typeof API_V1_CREATE_PORTFOLIO_FUNCTION_NAME
  | typeof MCP_V1_CREATE_PORTFOLIO_FUNCTION_NAME;



/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const SAFE_METADATA_PATTERN = /^[A-Za-z0-9._~:@/-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:@/+!=-]{1,255}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const NAME_MAX_LENGTH = 200;
const CODE_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 4000;

const LIFECYCLE_STATES: ReadonlySet<string> = new Set([
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

const STRATEGIC_PRIORITIES: ReadonlySet<string> = new Set([
  "critical",
  "high",
  "medium",
  "low",
  "watchlist",
]);

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1CreatePortfolioInput {
  readonly expectedOauthClientId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly lifecycleState: string;
  readonly strategicPriority: string;
  readonly ownerId: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1CreatePortfolioRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _organization_id: string;
  readonly _name: string;
  readonly _code: string | null;
  readonly _description: string | null;
  readonly _lifecycle_state: string;
  readonly _strategic_priority: string;
  readonly _owner_id: string | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract. */
export interface ApiV1PortfolioMutationRpcClient {
  rpc(
    functionName: string,
    args: ApiV1CreatePortfolioRpcArgs,
  ): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1CreatePortfolioSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly portfolioId: string;
}

export interface ApiV1CreatePortfolioNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1CreatePortfolioResult =
  | ApiV1CreatePortfolioSuccessResult
  | ApiV1CreatePortfolioNegativeResult;

const SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "portfolioId",
]);

const NEGATIVE_KEYS: ReadonlyArray<string> = Object.freeze(["ok", "outcome"]);

const NEGATIVE_OUTCOMES: ReadonlySet<string> = new Set([
  "invalid",
  "not_authorized",
  "idempotency_conflict",
  "idempotency_pending",
]);

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

function internal(cause?: unknown): never {
  throw new ApiHttpError("internal_error", cause);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) internal();
  const allowed = new Set(expected);
  for (const k of keys) {
    if (!allowed.has(k)) internal();
  }
  for (const k of expected) {
    if (!(k in value)) internal();
  }
}

function requireUuid(value: unknown): string {
  if (typeof value !== "string") internal();
  if (value === NIL_UUID) internal();
  if (!apiUuidSchema.safeParse(value).success) internal();
  return value;
}

function requireNullableUuid(value: unknown): string | null {
  if (value === null) return null;
  return requireUuid(value);
}

function assertValidExpectedOauthClientId(value: unknown): string {
  if (typeof value !== "string") internal();
  if (value.length < 1 || value.length > 255) internal();
  if (!EXPECTED_OAUTH_CLIENT_ID_PATTERN.test(value)) internal();
  return value;
}

function assertSafeMetadata(value: unknown): string {
  if (typeof value !== "string" || !SAFE_METADATA_PATTERN.test(value)) {
    internal();
  }
  return value;
}

function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    internal();
  }
  return value;
}

function assertPayloadHash(value: unknown): string {
  if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) internal();
  return value;
}

function assertName(value: unknown): string {
  if (typeof value !== "string") internal();
  if (value.length === 0 || value.length > NAME_MAX_LENGTH) internal();
  return value;
}

function assertNullableBoundedText(
  value: unknown,
  maxLength: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) internal();
  return value;
}

function assertLifecycleState(value: unknown): string {
  if (typeof value !== "string" || !LIFECYCLE_STATES.has(value)) internal();
  return value;
}

function assertStrategicPriority(value: unknown): string {
  if (typeof value !== "string" || !STRATEGIC_PRIORITIES.has(value)) {
    internal();
  }
  return value;
}

function assertRpcClient(
  client: unknown,
): asserts client is ApiV1PortfolioMutationRpcClient {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    internal();
  }
}

function unwrapRpcEnvelope(result: unknown): unknown {
  if (!isPlainObject(result)) internal();
  if (!("data" in result) || !("error" in result)) internal();
  const error = result.error;
  if (error !== null && error !== undefined) {
    if (isPlainObject(error) && error.code === SQLSTATE_INSUFFICIENT_PRIVILEGE) {
      throw new ApiHttpError("not_authorized", error);
    }
    throw new ApiHttpError("internal_error", error);
  }
  if (error === undefined) internal();
  return result.data;
}

// -----------------------------------------------------------------------------
// Result mapper
// -----------------------------------------------------------------------------

function toCreatePortfolioResult(data: unknown): ApiV1CreatePortfolioResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1CreatePortfolioNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  return Object.freeze({
    ok: true,
    outcome,
    portfolioId: requireUuid(data.portfolioId),
  });
}

// -----------------------------------------------------------------------------
// Adapter — one closed shared invocation path, two fixed wrappers
// -----------------------------------------------------------------------------

/**
 * The single Portfolio Create RPC invocation. The wrapper `functionName` is
 * constrained by the closed `CreatePortfolioFunctionName` type and is supplied
 * only by the two thin exported adapters below; it is never caller-controlled.
 */
async function invokeCreatePortfolio(
  functionName: CreatePortfolioFunctionName,
  client: ApiV1PortfolioMutationRpcClient,
  input: ApiV1CreatePortfolioInput,
): Promise<ApiV1CreatePortfolioResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const args: ApiV1CreatePortfolioRpcArgs = {
    _expected_oauth_client_id: assertValidExpectedOauthClientId(
      input.expectedOauthClientId,
    ),
    _organization_id: requireUuid(input.organizationId),
    _name: assertName(input.name),
    _code: assertNullableBoundedText(input.code, CODE_MAX_LENGTH),
    _description: assertNullableBoundedText(
      input.description,
      DESCRIPTION_MAX_LENGTH,
    ),
    _lifecycle_state: assertLifecycleState(input.lifecycleState),
    _strategic_priority: assertStrategicPriority(input.strategicPriority),
    _owner_id: requireNullableUuid(input.ownerId),
    _request_id: assertSafeMetadata(input.requestId),
    _correlation_id: assertSafeMetadata(input.correlationId),
    _idempotency_key: assertIdempotencyKey(input.idempotencyKey),
    _payload_hash: assertPayloadHash(input.payloadHash),
  };

  let result: unknown;
  try {
    result = await client.rpc(functionName, args);
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toCreatePortfolioResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_create_portfolio` wrapper. The database
 * remains the sole authority for Organization existence, Organization Admin
 * domain authority, Connected App enablement, capability grant enforcement,
 * idempotency, provenance, encryption and the canonical Portfolio creation
 * command itself.
 */
export function createApiV1Portfolio(
  client: ApiV1PortfolioMutationRpcClient,
  input: ApiV1CreatePortfolioInput,
): Promise<ApiV1CreatePortfolioResult> {
  return invokeCreatePortfolio(
    API_V1_CREATE_PORTFOLIO_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * Invoke the accepted MCP-source `public.mcp_v1_create_portfolio` wrapper
 * (Portfolio-9A). The only difference from the REST adapter is the fixed
 * wrapper selected here; validation and result mapping are identical.
 */
export function createMcpV1Portfolio(
  client: ApiV1PortfolioMutationRpcClient,
  input: ApiV1CreatePortfolioInput,
): Promise<ApiV1CreatePortfolioResult> {
  return invokeCreatePortfolio(
    MCP_V1_CREATE_PORTFOLIO_FUNCTION_NAME,
    client,
    input,
  );
}


// -----------------------------------------------------------------------------
// API-Q Portfolio-5B — Explicit RPC adapter for the external Portfolio update
// command (`portfolios:update`).
//
// This calls exactly one accepted Portfolio-5A database wrapper,
// `public.api_v1_update_portfolio`, through a caller-supplied Supabase RPC
// client. No generic mutation dispatcher exists: the wrapper name is a module
// constant. `currentUpdatedAt` and every protected/decrypted Portfolio value are
// structurally unrepresentable in the accepted result shapes below.
// -----------------------------------------------------------------------------

/** Exact REST-source database wrapper invoked by the update adapter. */
const API_V1_UPDATE_PORTFOLIO_FUNCTION_NAME = "api_v1_update_portfolio";

/**
 * Exact MCP-source database wrapper invoked by the update adapter
 * (API-Q Portfolio-10A trusted MCP bridge).
 */
const MCP_V1_UPDATE_PORTFOLIO_FUNCTION_NAME = "mcp_v1_update_portfolio";

/** Closed set of the only two accepted Portfolio Update wrapper names. */
type UpdatePortfolioFunctionName =
  | typeof API_V1_UPDATE_PORTFOLIO_FUNCTION_NAME
  | typeof MCP_V1_UPDATE_PORTFOLIO_FUNCTION_NAME;

const TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

export interface ApiV1UpdatePortfolioInput {
  readonly expectedOauthClientId: string;
  readonly portfolioId: string;
  readonly expectedUpdatedAt: string;
  readonly name: string | null;
  readonly setName: boolean;
  readonly code: string | null;
  readonly setCode: boolean;
  readonly description: string | null;
  readonly setDescription: boolean;
  readonly lifecycleState: string | null;
  readonly setLifecycleState: boolean;
  readonly strategicPriority: string | null;
  readonly setStrategicPriority: boolean;
  readonly ownerId: string | null;
  readonly setOwnerId: boolean;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

/** The exact accepted 19-argument wrapper signature. */
export interface ApiV1UpdatePortfolioRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _portfolio_item_id: string;
  readonly _expected_updated_at: string;
  readonly _name: string | null;
  readonly _set_name: boolean;
  readonly _code: string | null;
  readonly _set_code: boolean;
  readonly _description: string | null;
  readonly _set_description: boolean;
  readonly _lifecycle_state: string | null;
  readonly _set_lifecycle_state: boolean;
  readonly _strategic_priority: string | null;
  readonly _set_strategic_priority: boolean;
  readonly _owner_id: string | null;
  readonly _set_owner_id: boolean;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract for the update wrapper. */
export interface ApiV1PortfolioUpdateMutationRpcClient {
  rpc(
    functionName: string,
    args: ApiV1UpdatePortfolioRpcArgs,
  ): Promise<unknown>;
}

export interface ApiV1UpdatePortfolioSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly portfolioId: string;
  readonly updatedAt: string;
}

export interface ApiV1UpdatePortfolioConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_portfolio";
}

export interface ApiV1UpdatePortfolioNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1UpdatePortfolioResult =
  | ApiV1UpdatePortfolioSuccessResult
  | ApiV1UpdatePortfolioConflictResult
  | ApiV1UpdatePortfolioNegativeResult;

const UPDATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "portfolioId",
  "updatedAt",
]);

const UPDATE_CONFLICT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
]);

function assertBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") internal();
  return value;
}

function assertTimestamptz(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMPTZ_PATTERN.test(value)) internal();
  return value;
}

/**
 * Fail-closed presence pairing: when a set flag is false the paired value MUST
 * be `null`; when it is true the value is validated against the canonical
 * bound. `name` remains non-clearable at the adapter boundary too.
 */
function resolveSetString(
  set: unknown,
  value: unknown,
  validate: (value: unknown) => string,
  clearable: boolean,
): { readonly set: boolean; readonly value: string | null } {
  const flag = assertBoolean(set);
  if (!flag) {
    if (value !== null) internal();
    return { set: false, value: null };
  }
  if (value === null) {
    if (!clearable) internal();
    return { set: true, value: null };
  }
  return { set: true, value: validate(value) };
}

function assertUpdateName(value: unknown): string {
  if (typeof value !== "string") internal();
  if (value.length === 0 || value.length > NAME_MAX_LENGTH) internal();
  return value;
}

function assertBoundedText(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) internal();
  return value;
}

function toUpdatePortfolioResult(data: unknown): ApiV1UpdatePortfolioResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === true) {
    assertExactKeys(data, UPDATE_SUCCESS_KEYS);
    const outcome = data.outcome;
    if (outcome !== "applied" && outcome !== "replayed") internal();
    return Object.freeze({
      ok: true,
      outcome,
      portfolioId: requireUuid(data.portfolioId),
      updatedAt: assertTimestamptz(data.updatedAt),
    });
  }

  if (data.outcome === "conflict") {
    assertExactKeys(data, UPDATE_CONFLICT_KEYS);
    if (data.code !== "stale_portfolio") internal();
    return Object.freeze({
      ok: false,
      outcome: "conflict",
      code: "stale_portfolio",
    });
  }

  assertExactKeys(data, NEGATIVE_KEYS);
  const outcome = data.outcome;
  if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
    internal();
  }
  return Object.freeze({
    ok: false,
    outcome: outcome as ApiV1UpdatePortfolioNegativeResult["outcome"],
  });
}

/**
 * The single Portfolio Update RPC invocation. The wrapper `functionName` is
 * constrained by the closed `UpdatePortfolioFunctionName` type and is supplied
 * only by the two thin exported adapters below; it is never caller-controlled.
 */
async function invokeUpdatePortfolio(
  functionName: UpdatePortfolioFunctionName,
  client: ApiV1PortfolioUpdateMutationRpcClient,
  input: ApiV1UpdatePortfolioInput,
): Promise<ApiV1UpdatePortfolioResult> {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    internal();
  }
  if (!isPlainObject(input)) internal();

  const name = resolveSetString(
    input.setName,
    input.name,
    assertUpdateName,
    false,
  );
  const code = resolveSetString(
    input.setCode,
    input.code,
    (v) => assertBoundedText(v, CODE_MAX_LENGTH),
    true,
  );
  const description = resolveSetString(
    input.setDescription,
    input.description,
    (v) => assertBoundedText(v, DESCRIPTION_MAX_LENGTH),
    true,
  );
  const lifecycleState = resolveSetString(
    input.setLifecycleState,
    input.lifecycleState,
    assertLifecycleState,
    false,
  );
  const strategicPriority = resolveSetString(
    input.setStrategicPriority,
    input.strategicPriority,
    assertStrategicPriority,
    false,
  );
  const ownerId = resolveSetString(
    input.setOwnerId,
    input.ownerId,
    requireUuid,
    true,
  );

  const args: ApiV1UpdatePortfolioRpcArgs = {
    _expected_oauth_client_id: assertValidExpectedOauthClientId(
      input.expectedOauthClientId,
    ),
    _portfolio_item_id: requireUuid(input.portfolioId),
    _expected_updated_at: assertTimestamptz(input.expectedUpdatedAt),
    _name: name.value,
    _set_name: name.set,
    _code: code.value,
    _set_code: code.set,
    _description: description.value,
    _set_description: description.set,
    _lifecycle_state: lifecycleState.value,
    _set_lifecycle_state: lifecycleState.set,
    _strategic_priority: strategicPriority.value,
    _set_strategic_priority: strategicPriority.set,
    _owner_id: ownerId.value,
    _set_owner_id: ownerId.set,
    _request_id: assertSafeMetadata(input.requestId),
    _correlation_id: assertSafeMetadata(input.correlationId),
    _idempotency_key: assertIdempotencyKey(input.idempotencyKey),
    _payload_hash: assertPayloadHash(input.payloadHash),
  };

  let result: unknown;
  try {
    result = await client.rpc(functionName, args);
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toUpdatePortfolioResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_update_portfolio` wrapper. The database
 * remains the sole authority for Organization derivation, Organization Admin
 * domain authority, Connected App enablement, capability grant enforcement,
 * idempotency, provenance, optimistic concurrency, encryption and the canonical
 * Portfolio update command itself.
 */
export function updateApiV1Portfolio(
  client: ApiV1PortfolioUpdateMutationRpcClient,
  input: ApiV1UpdatePortfolioInput,
): Promise<ApiV1UpdatePortfolioResult> {
  return invokeUpdatePortfolio(
    API_V1_UPDATE_PORTFOLIO_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * Invoke the accepted MCP-source `public.mcp_v1_update_portfolio` wrapper
 * (Portfolio-10A). The only difference from the REST adapter is the fixed
 * wrapper selected here; validation, argument mapping, presence semantics,
 * concurrency handling and result mapping are identical.
 */
export function updateMcpV1Portfolio(
  client: ApiV1PortfolioUpdateMutationRpcClient,
  input: ApiV1UpdatePortfolioInput,
): Promise<ApiV1UpdatePortfolioResult> {
  return invokeUpdatePortfolio(
    MCP_V1_UPDATE_PORTFOLIO_FUNCTION_NAME,
    client,
    input,
  );
}

// -----------------------------------------------------------------------------
// API-Q Portfolio-6B — Explicit RPC adapter for the external Project↔Portfolio
// assignment command (`portfolios:assign_project`).
//
// This calls exactly one accepted Portfolio-6A database wrapper,
// `public.api_v1_assign_project_portfolio`, through a caller-supplied Supabase
// RPC client. No generic mutation dispatcher exists: the wrapper name is a
// module constant. There is deliberately no optimistic-concurrency token, and
// no Portfolio narrative or scope value is representable in the result shapes.
// -----------------------------------------------------------------------------

/** Exact REST-source database wrapper invoked by the assignment adapter. */
const API_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME =
  "api_v1_assign_project_portfolio";

/**
 * Exact MCP-source database wrapper invoked by the assignment adapter
 * (API-Q Portfolio-11A trusted MCP bridge).
 */
const MCP_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME =
  "mcp_v1_assign_project_portfolio";

/** Closed set of the only two accepted assignment wrapper names. */
type AssignProjectPortfolioFunctionName =
  | typeof API_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME
  | typeof MCP_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME;

export interface ApiV1AssignProjectPortfolioInput {
  readonly expectedOauthClientId: string;
  readonly projectId: string;
  /** `null` clears the Project's Portfolio assignment. */
  readonly portfolioId: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

/** The exact accepted seven-argument wrapper signature. */
export interface ApiV1AssignProjectPortfolioRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _project_id: string;
  readonly _portfolio_item_id: string | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract for the assignment wrapper. */
export interface ApiV1PortfolioAssignmentMutationRpcClient {
  rpc(
    functionName: string,
    args: ApiV1AssignProjectPortfolioRpcArgs,
  ): Promise<unknown>;
}

export interface ApiV1AssignProjectPortfolioSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly oldPortfolioId: string | null;
  readonly newPortfolioId: string | null;
}

export interface ApiV1AssignProjectPortfolioNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1AssignProjectPortfolioResult =
  | ApiV1AssignProjectPortfolioSuccessResult
  | ApiV1AssignProjectPortfolioNegativeResult;

const ASSIGN_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "projectId",
  "oldPortfolioId",
  "newPortfolioId",
]);

function toAssignProjectPortfolioResult(
  data: unknown,
): ApiV1AssignProjectPortfolioResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === true) {
    assertExactKeys(data, ASSIGN_SUCCESS_KEYS);
    const outcome = data.outcome;
    if (
      outcome !== "applied" && outcome !== "no_change" &&
      outcome !== "replayed"
    ) {
      internal();
    }
    return Object.freeze({
      ok: true,
      outcome,
      projectId: requireUuid(data.projectId),
      oldPortfolioId: requireNullableUuid(data.oldPortfolioId),
      newPortfolioId: requireNullableUuid(data.newPortfolioId),
    });
  }

  assertExactKeys(data, NEGATIVE_KEYS);
  const outcome = data.outcome;
  if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
    internal();
  }
  return Object.freeze({
    ok: false,
    outcome: outcome as ApiV1AssignProjectPortfolioNegativeResult["outcome"],
  });
}

/**
 * The single Project↔Portfolio assignment RPC invocation. The wrapper
 * `functionName` is constrained by the closed
 * `AssignProjectPortfolioFunctionName` type and is supplied only by the two
 * thin exported adapters below; it is never caller-controlled.
 */
async function invokeAssignProjectPortfolio(
  functionName: AssignProjectPortfolioFunctionName,
  client: ApiV1PortfolioAssignmentMutationRpcClient,
  input: ApiV1AssignProjectPortfolioInput,
): Promise<ApiV1AssignProjectPortfolioResult> {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    internal();
  }
  if (!isPlainObject(input)) internal();

  const args: ApiV1AssignProjectPortfolioRpcArgs = {
    _expected_oauth_client_id: assertValidExpectedOauthClientId(
      input.expectedOauthClientId,
    ),
    _project_id: requireUuid(input.projectId),
    // `null` means "clear the assignment"; forwarded unchanged.
    _portfolio_item_id: requireNullableUuid(input.portfolioId),
    _request_id: assertSafeMetadata(input.requestId),
    _correlation_id: assertSafeMetadata(input.correlationId),
    _idempotency_key: assertIdempotencyKey(input.idempotencyKey),
    _payload_hash: assertPayloadHash(input.payloadHash),
  };

  let result: unknown;
  try {
    result = await client.rpc(functionName, args);
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toAssignProjectPortfolioResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_assign_project_portfolio` wrapper. The
 * database remains the sole authority for Project-derived Organization/Workspace
 * scope, Connected App enablement, capability grant enforcement, PM authority,
 * idempotency, provenance and the canonical `public.assign_project_portfolio`
 * business write.
 */
export function assignApiV1ProjectPortfolio(
  client: ApiV1PortfolioAssignmentMutationRpcClient,
  input: ApiV1AssignProjectPortfolioInput,
): Promise<ApiV1AssignProjectPortfolioResult> {
  return invokeAssignProjectPortfolio(
    API_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * Invoke the accepted MCP-source `public.mcp_v1_assign_project_portfolio`
 * wrapper (Portfolio-11A). The only difference from the REST adapter is the
 * fixed wrapper selected here; validation, argument mapping, NULL-clearing
 * semantics and result mapping are identical.
 */
export function assignMcpV1ProjectPortfolio(
  client: ApiV1PortfolioAssignmentMutationRpcClient,
  input: ApiV1AssignProjectPortfolioInput,
): Promise<ApiV1AssignProjectPortfolioResult> {
  return invokeAssignProjectPortfolio(
    MCP_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME,
    client,
    input,
  );
}
