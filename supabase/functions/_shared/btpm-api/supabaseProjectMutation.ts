// API-N.5 — Explicit RPC adapter for the single external Project mutation.
//
// This module calls exactly one accepted API-N.5 database wrapper,
// `public.api_v1_create_project`, through a caller-supplied Supabase RPC
// client. The caller-supplied client is the trust boundary: the runtime must
// supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, exposes no generic RPC executor, performs no
// dynamic dispatch, and never touches Connected App enablement.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import type { ApiV1ProjectDeliveryModel } from "../btpm-api/routes/projects.ts";

/** Exact REST database wrapper invoked by this module. */
const API_V1_CREATE_PROJECT_FUNCTION_NAME = "api_v1_create_project";

/**
 * API-Q Project Create Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_create_project`, accepted in Project Create Step 1).
 */
const MCP_V1_CREATE_PROJECT_FUNCTION_NAME = "mcp_v1_create_project";

/**
 * The only two Project-create wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type CreateProjectFunctionName =
  | typeof API_V1_CREATE_PROJECT_FUNCTION_NAME
  | typeof MCP_V1_CREATE_PROJECT_FUNCTION_NAME;


/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const SAFE_METADATA_PATTERN = /^[A-Za-z0-9._~:@/-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:@/+!=-]{1,255}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const NAME_MAX_LENGTH = 200;

const DELIVERY_MODELS: ReadonlySet<string> = new Set([
  "internal_delivery",
  "vendor_delivery",
  "co_delivery",
]);

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1CreateProjectInput {
  readonly expectedOauthClientId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly programId: string | null;
  readonly deliveryModel: ApiV1ProjectDeliveryModel | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1CreateProjectRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _workspace_id: string;
  readonly _name: string;
  readonly _program_id: string | null;
  readonly _delivery_model: string | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract. */
export interface ApiV1ProjectMutationRpcClient {
  rpc(
    functionName: string,
    args:
      | ApiV1CreateProjectRpcArgs
      | ApiV1UpdateProjectRpcArgs
      | ApiV1TransitionProjectRpcArgs,
  ): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1CreateProjectSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly projectId: string;
}

export interface ApiV1CreateProjectNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1CreateProjectResult =
  | ApiV1CreateProjectSuccessResult
  | ApiV1CreateProjectNegativeResult;

const SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "projectId",
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

function assertNullableUuid(value: unknown): string | null {
  if (value === null) return null;
  return requireUuid(value);
}

function assertNullableDeliveryModel(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !DELIVERY_MODELS.has(value)) internal();
  return value;
}

function assertRpcClient(
  client: unknown,
): asserts client is ApiV1ProjectMutationRpcClient {
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

function toCreateProjectResult(data: unknown): ApiV1CreateProjectResult {
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
      outcome: outcome as ApiV1CreateProjectNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  return Object.freeze({
    ok: true,
    outcome,
    projectId: requireUuid(data.projectId),
  });
}

// -----------------------------------------------------------------------------
// Adapter
// -----------------------------------------------------------------------------

/**
 * Single shared Project-create RPC invocation. Not exported: the wrapper name
 * is constrained by the closed `CreateProjectFunctionName` type and is supplied
 * only by the two exported adapters below, never by any caller.
 *
 * The database remains the sole authority for Organization derivation,
 * Connected App authorization, capability grant enforcement, idempotency, and
 * the canonical Project creation command itself. Project Create has no target
 * Project, so no Project Connected App enablement lookup exists on this path.
 */
async function invokeCreateProject(
  functionName: CreateProjectFunctionName,
  client: ApiV1ProjectMutationRpcClient,
  input: ApiV1CreateProjectInput,
): Promise<ApiV1CreateProjectResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const workspaceId = requireUuid(input.workspaceId);
  const name = assertName(input.name);
  const programId = assertNullableUuid(input.programId);
  const deliveryModel = assertNullableDeliveryModel(input.deliveryModel);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _workspace_id: workspaceId,
      _name: name,
      _program_id: programId,
      _delivery_model: deliveryModel,
      _request_id: requestId,
      _correlation_id: correlationId,
      _idempotency_key: idempotencyKey,
      _payload_hash: payloadHash,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toCreateProjectResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_create_project` wrapper (REST /
 * `external_api` source channel). Behavior is unchanged from API-N.5.
 */
export function createApiV1Project(
  client: ApiV1ProjectMutationRpcClient,
  input: ApiV1CreateProjectInput,
): Promise<ApiV1CreateProjectResult> {
  return invokeCreateProject(
    API_V1_CREATE_PROJECT_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Project Create Step 2 — invoke the accepted
 * `public.mcp_v1_create_project` wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function. The ONLY difference is the
 * fixed wrapper name, which the database uses to derive the trusted source
 * channel.
 */
export function createMcpV1Project(
  client: ApiV1ProjectMutationRpcClient,
  input: ApiV1CreateProjectInput,
): Promise<ApiV1CreateProjectResult> {
  return invokeCreateProject(
    MCP_V1_CREATE_PROJECT_FUNCTION_NAME,
    client,
    input,
  );
}

// =============================================================================
// API-N.6 — Explicit RPC adapter for `public.api_v1_update_project`.
//
// This is a second explicit adapter, NOT a generic Project RPC dispatcher. It
// maps every normalized value and every presence flag to its exact RPC
// argument and strictly validates the bounded wrapper result.
// =============================================================================

/** Exact REST database wrapper invoked by the update adapter. */
const API_V1_UPDATE_PROJECT_FUNCTION_NAME = "api_v1_update_project";

/**
 * API-Q Project Update Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_update_project`, accepted in Project Update Step 1).
 */
const MCP_V1_UPDATE_PROJECT_FUNCTION_NAME = "mcp_v1_update_project";

/**
 * The only two Project-update wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type UpdateProjectFunctionName =
  | typeof API_V1_UPDATE_PROJECT_FUNCTION_NAME
  | typeof MCP_V1_UPDATE_PROJECT_FUNCTION_NAME;

const PRIORITIES: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "critical",
]);

export interface ApiV1UpdateProjectInput {
  readonly expectedOauthClientId: string;
  readonly projectId: string;
  readonly expectedUpdatedAt: string;

  readonly name: string | null;
  readonly setName: boolean;
  readonly priority: string | null;
  readonly setPriority: boolean;
  readonly description: string | null;
  readonly setDescription: boolean;
  readonly charter: string | null;
  readonly setCharter: boolean;
  readonly goals: string | null;
  readonly setGoals: boolean;
  readonly scopeIn: string | null;
  readonly setScopeIn: boolean;
  readonly scopeOut: string | null;
  readonly setScopeOut: boolean;
  readonly businessCase: string | null;
  readonly setBusinessCase: boolean;
  readonly successCriteria: string | null;
  readonly setSuccessCriteria: boolean;
  readonly completionCriteria: string | null;
  readonly setCompletionCriteria: boolean;
  readonly budgetNarrative: string | null;
  readonly setBudgetNarrative: boolean;
  readonly assumptions: string | null;
  readonly setAssumptions: boolean;
  readonly constraints: string | null;
  readonly setConstraints: boolean;
  readonly programId: string | null;
  readonly setProgramId: boolean;
  readonly deliveryModel: string | null;
  readonly setDeliveryModel: boolean;

  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1UpdateProjectRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _project_id: string;
  readonly _expected_updated_at: string;
  readonly _name: string | null;
  readonly _priority: string | null;
  readonly _description: string | null;
  readonly _charter: string | null;
  readonly _goals: string | null;
  readonly _scope_in: string | null;
  readonly _scope_out: string | null;
  readonly _business_case: string | null;
  readonly _success_criteria: string | null;
  readonly _completion_criteria: string | null;
  readonly _budget_narrative: string | null;
  readonly _assumptions: string | null;
  readonly _constraints: string | null;
  readonly _program_id: string | null;
  readonly _delivery_model: string | null;
  readonly _set_name: boolean;
  readonly _set_priority: boolean;
  readonly _set_description: boolean;
  readonly _set_charter: boolean;
  readonly _set_goals: boolean;
  readonly _set_scope_in: boolean;
  readonly _set_scope_out: boolean;
  readonly _set_business_case: boolean;
  readonly _set_success_criteria: boolean;
  readonly _set_completion_criteria: boolean;
  readonly _set_budget_narrative: boolean;
  readonly _set_assumptions: boolean;
  readonly _set_constraints: boolean;
  readonly _set_program_id: boolean;
  readonly _set_delivery_model: boolean;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1UpdateProjectSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly updatedAt: string;
}

export interface ApiV1UpdateProjectConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_project";
}

export interface ApiV1UpdateProjectNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1UpdateProjectResult =
  | ApiV1UpdateProjectSuccessResult
  | ApiV1UpdateProjectConflictResult
  | ApiV1UpdateProjectNegativeResult;

const UPDATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "projectId",
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

function assertNullableNarrative(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) internal();
  return value;
}

function assertUpdatedAt(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    internal();
  }
  return value;
}

function toUpdateProjectResult(data: unknown): ApiV1UpdateProjectResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === true) {
    assertExactKeys(data, UPDATE_SUCCESS_KEYS);
    const outcome = data.outcome;
    if (
      outcome !== "applied" && outcome !== "no_change" && outcome !== "replayed"
    ) {
      internal();
    }
    return Object.freeze({
      ok: true,
      outcome,
      projectId: requireUuid(data.projectId),
      updatedAt: assertUpdatedAt(data.updatedAt),
    });
  }

  if (data.outcome === "conflict") {
    assertExactKeys(data, UPDATE_CONFLICT_KEYS);
    if (data.code !== "stale_project") internal();
    return Object.freeze({
      ok: false,
      outcome: "conflict",
      code: "stale_project",
    });
  }

  assertExactKeys(data, NEGATIVE_KEYS);
  const outcome = data.outcome;
  if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
    internal();
  }
  return Object.freeze({
    ok: false,
    outcome: outcome as ApiV1UpdateProjectNegativeResult["outcome"],
  });
}

/**
 * Single shared Project-update RPC invocation. Not exported: the wrapper name
 * is constrained by the closed `UpdateProjectFunctionName` type and is supplied
 * only by the two exported adapters below, never by any caller.
 *
 * The database remains the sole authority for target-derived containment,
 * Connected App authorization, Project enablement, idempotency, optimistic
 * concurrency and the canonical `public.apply_project_update` command itself.
 */
async function invokeUpdateProject(
  functionName: UpdateProjectFunctionName,
  client: ApiV1ProjectMutationRpcClient,
  input: ApiV1UpdateProjectInput,
): Promise<ApiV1UpdateProjectResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const setName = assertBoolean(input.setName);
  const setPriority = assertBoolean(input.setPriority);
  const setProgramId = assertBoolean(input.setProgramId);
  const setDeliveryModel = assertBoolean(input.setDeliveryModel);

  if (setName && (typeof input.name !== "string" || input.name.length === 0)) {
    internal();
  }
  if (!setName && input.name !== null) internal();
  if (setPriority) {
    if (typeof input.priority !== "string" || !PRIORITIES.has(input.priority)) {
      internal();
    }
  } else if (input.priority !== null) {
    internal();
  }
  if (!setProgramId && input.programId !== null) internal();
  if (!setDeliveryModel && input.deliveryModel !== null) internal();

  const args: ApiV1UpdateProjectRpcArgs = {
    _expected_oauth_client_id: assertValidExpectedOauthClientId(
      input.expectedOauthClientId,
    ),
    _project_id: requireUuid(input.projectId),
    _expected_updated_at: assertUpdatedAt(input.expectedUpdatedAt),
    _name: setName ? assertName(input.name) : null,
    _priority: setPriority ? (input.priority as string) : null,
    _description: assertNullableNarrative(input.description),
    _charter: assertNullableNarrative(input.charter),
    _goals: assertNullableNarrative(input.goals),
    _scope_in: assertNullableNarrative(input.scopeIn),
    _scope_out: assertNullableNarrative(input.scopeOut),
    _business_case: assertNullableNarrative(input.businessCase),
    _success_criteria: assertNullableNarrative(input.successCriteria),
    _completion_criteria: assertNullableNarrative(input.completionCriteria),
    _budget_narrative: assertNullableNarrative(input.budgetNarrative),
    _assumptions: assertNullableNarrative(input.assumptions),
    _constraints: assertNullableNarrative(input.constraints),
    _program_id: assertNullableUuid(input.programId),
    _delivery_model: assertNullableDeliveryModel(input.deliveryModel),
    _set_name: setName,
    _set_priority: setPriority,
    _set_description: assertBoolean(input.setDescription),
    _set_charter: assertBoolean(input.setCharter),
    _set_goals: assertBoolean(input.setGoals),
    _set_scope_in: assertBoolean(input.setScopeIn),
    _set_scope_out: assertBoolean(input.setScopeOut),
    _set_business_case: assertBoolean(input.setBusinessCase),
    _set_success_criteria: assertBoolean(input.setSuccessCriteria),
    _set_completion_criteria: assertBoolean(input.setCompletionCriteria),
    _set_budget_narrative: assertBoolean(input.setBudgetNarrative),
    _set_assumptions: assertBoolean(input.setAssumptions),
    _set_constraints: assertBoolean(input.setConstraints),
    _set_program_id: setProgramId,
    _set_delivery_model: setDeliveryModel,
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

  return toUpdateProjectResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_update_project` wrapper (REST /
 * `external_api` source channel). Behavior is unchanged from API-N.6.
 */
export function updateApiV1Project(
  client: ApiV1ProjectMutationRpcClient,
  input: ApiV1UpdateProjectInput,
): Promise<ApiV1UpdateProjectResult> {
  return invokeUpdateProject(
    API_V1_UPDATE_PROJECT_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Project Update Step 2 — invoke the accepted
 * `public.mcp_v1_update_project` wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function. The ONLY difference is the
 * fixed wrapper name, which the database uses to derive the trusted source
 * channel.
 */
export function updateMcpV1Project(
  client: ApiV1ProjectMutationRpcClient,
  input: ApiV1UpdateProjectInput,
): Promise<ApiV1UpdateProjectResult> {
  return invokeUpdateProject(
    MCP_V1_UPDATE_PROJECT_FUNCTION_NAME,
    client,
    input,
  );
}

// =============================================================================
// API-N.7 — Explicit RPC adapter for `public.api_v1_transition_project`.
//
// A third explicit adapter, NOT a generic Project RPC dispatcher. No transition
// rule, completion rule, blocker rule or warning rule is reproduced here: the
// database wrapper and the canonical
// `public.apply_project_status_transition` command remain the sole authority.
// =============================================================================

/** Exact REST database wrapper invoked by the transition adapter. */
const API_V1_TRANSITION_PROJECT_FUNCTION_NAME = "api_v1_transition_project";

/**
 * API-Q Project Transition Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_transition_project`, accepted in Project Transition Step 1).
 */
const MCP_V1_TRANSITION_PROJECT_FUNCTION_NAME = "mcp_v1_transition_project";

/**
 * The only two Project-transition wrapper names this module may ever invoke.
 * The wrapper name is never caller-provided: each exported adapter binds
 * exactly one member of this closed type.
 */
type TransitionProjectFunctionName =
  | typeof API_V1_TRANSITION_PROJECT_FUNCTION_NAME
  | typeof MCP_V1_TRANSITION_PROJECT_FUNCTION_NAME;

const TARGET_STATUSES: ReadonlySet<string> = new Set([
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
]);

/** Exact canonical completion-validation categories. */
const COMPLETION_CATEGORIES: ReadonlySet<string> = new Set([
  "open_blockers",
  "incomplete_phases",
  "incomplete_tasks",
  "open_risks",
  "target_end_in_future",
]);

/** Exact canonical completion-validation count keys. */
const COMPLETION_COUNT_KEYS: ReadonlyArray<string> = Object.freeze([
  "open_blockers",
  "incomplete_phases",
  "incomplete_tasks",
  "open_risks",
  "target_in_future",
]);

export interface ApiV1TransitionProjectInput {
  readonly expectedOauthClientId: string;
  readonly projectId: string;
  readonly expectedUpdatedAt: string;
  readonly targetStatus: string;
  readonly confirmWarnings: boolean;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1TransitionProjectRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _project_id: string;
  readonly _expected_updated_at: string;
  readonly _target_status: string;
  readonly _confirm_warnings: boolean;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1ProjectCompletionItem {
  readonly code: string;
  readonly message: string;
  readonly count: number;
}

export interface ApiV1TransitionProjectSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly status: string;
  readonly previousStatus: string;
  readonly updatedAt: string;
}

export interface ApiV1TransitionProjectBlockedResult {
  readonly ok: false;
  readonly outcome: "blocked";
  readonly code: "completion_hard_blocked";
  readonly projectId: string;
  readonly hardBlocks: readonly ApiV1ProjectCompletionItem[];
  readonly warnings: readonly ApiV1ProjectCompletionItem[];
  readonly counts: Readonly<Record<string, number>>;
}

export interface ApiV1TransitionProjectConfirmationResult {
  readonly ok: false;
  readonly outcome: "confirmation_required";
  readonly code: "completion_soft_warnings";
  readonly projectId: string;
  readonly warnings: readonly ApiV1ProjectCompletionItem[];
  readonly counts: Readonly<Record<string, number>>;
}

export interface ApiV1TransitionProjectConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_project";
}

export interface ApiV1TransitionProjectNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1TransitionProjectResult =
  | ApiV1TransitionProjectSuccessResult
  | ApiV1TransitionProjectBlockedResult
  | ApiV1TransitionProjectConfirmationResult
  | ApiV1TransitionProjectConflictResult
  | ApiV1TransitionProjectNegativeResult;

const TRANSITION_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "projectId",
  "status",
  "previousStatus",
  "updatedAt",
]);

const TRANSITION_BLOCKED_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
  "projectId",
  "hardBlocks",
  "warnings",
  "counts",
]);

const TRANSITION_CONFIRMATION_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
  "projectId",
  "warnings",
  "counts",
]);

const TRANSITION_CONFLICT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
]);

const COMPLETION_ITEM_KEYS: ReadonlyArray<string> = Object.freeze([
  "code",
  "message",
  "count",
]);

function assertTargetStatus(value: unknown): string {
  if (typeof value !== "string" || !TARGET_STATUSES.has(value)) internal();
  return value;
}

function assertBoundedCount(value: unknown): number {
  if (
    typeof value !== "number" || !Number.isInteger(value) || value < 0 ||
    value > 999999999
  ) {
    internal();
  }
  return value;
}

function assertCompletionItems(
  value: unknown,
): readonly ApiV1ProjectCompletionItem[] {
  if (!Array.isArray(value)) internal();
  if (value.length > 32) internal();
  const items: ApiV1ProjectCompletionItem[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) internal();
    assertExactKeys(raw, COMPLETION_ITEM_KEYS);
    const code = raw.code;
    if (typeof code !== "string" || !COMPLETION_CATEGORIES.has(code)) internal();
    const message = raw.message;
    if (
      typeof message !== "string" || message.length === 0 || message.length > 512
    ) {
      internal();
    }
    items.push(
      Object.freeze({ code, message, count: assertBoundedCount(raw.count) }),
    );
  }
  return Object.freeze(items);
}

function assertCompletionCounts(
  value: unknown,
): Readonly<Record<string, number>> {
  if (!isPlainObject(value)) internal();
  const out: Record<string, number> = {};
  for (const key of Object.keys(value)) {
    if (!COMPLETION_COUNT_KEYS.includes(key)) internal();
    out[key] = assertBoundedCount(value[key]);
  }
  return Object.freeze(out);
}

function toTransitionProjectResult(
  data: unknown,
): ApiV1TransitionProjectResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === true) {
    assertExactKeys(data, TRANSITION_SUCCESS_KEYS);
    const outcome = data.outcome;
    if (
      outcome !== "applied" && outcome !== "no_change" && outcome !== "replayed"
    ) {
      internal();
    }
    return Object.freeze({
      ok: true,
      outcome,
      projectId: requireUuid(data.projectId),
      status: assertTargetStatus(data.status),
      previousStatus: assertTargetStatus(data.previousStatus),
      updatedAt: assertUpdatedAt(data.updatedAt),
    });
  }

  if (data.outcome === "blocked") {
    assertExactKeys(data, TRANSITION_BLOCKED_KEYS);
    if (data.code !== "completion_hard_blocked") internal();
    return Object.freeze({
      ok: false,
      outcome: "blocked",
      code: "completion_hard_blocked",
      projectId: requireUuid(data.projectId),
      hardBlocks: assertCompletionItems(data.hardBlocks),
      warnings: assertCompletionItems(data.warnings),
      counts: assertCompletionCounts(data.counts),
    });
  }

  if (data.outcome === "confirmation_required") {
    assertExactKeys(data, TRANSITION_CONFIRMATION_KEYS);
    if (data.code !== "completion_soft_warnings") internal();
    return Object.freeze({
      ok: false,
      outcome: "confirmation_required",
      code: "completion_soft_warnings",
      projectId: requireUuid(data.projectId),
      warnings: assertCompletionItems(data.warnings),
      counts: assertCompletionCounts(data.counts),
    });
  }

  if (data.outcome === "conflict") {
    assertExactKeys(data, TRANSITION_CONFLICT_KEYS);
    if (data.code !== "stale_project") internal();
    return Object.freeze({
      ok: false,
      outcome: "conflict",
      code: "stale_project",
    });
  }

  assertExactKeys(data, NEGATIVE_KEYS);
  const outcome = data.outcome;
  if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
    internal();
  }
  return Object.freeze({
    ok: false,
    outcome: outcome as ApiV1TransitionProjectNegativeResult["outcome"],
  });
}

/**
 * Single shared Project-transition RPC invocation. Not exported: the wrapper
 * name is constrained by the closed `TransitionProjectFunctionName` type and is
 * supplied only by the two exported adapters below, never by any caller.
 *
 * The database remains the sole authority for target-derived containment,
 * Connected App authorization, Project enablement, idempotency, optimistic
 * concurrency, supported transitions, completion validation, hard blockers,
 * soft warnings and explicit confirmation semantics.
 */
async function invokeTransitionProject(
  functionName: TransitionProjectFunctionName,
  client: ApiV1ProjectMutationRpcClient,
  input: ApiV1TransitionProjectInput,
): Promise<ApiV1TransitionProjectResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const args: ApiV1TransitionProjectRpcArgs = {
    _expected_oauth_client_id: assertValidExpectedOauthClientId(
      input.expectedOauthClientId,
    ),
    _project_id: requireUuid(input.projectId),
    _expected_updated_at: assertUpdatedAt(input.expectedUpdatedAt),
    _target_status: assertTargetStatus(input.targetStatus),
    _confirm_warnings: assertBoolean(input.confirmWarnings),
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

  return toTransitionProjectResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_transition_project` wrapper (REST /
 * `external_api` source channel). Behavior is unchanged from API-N.7.
 */
export function transitionApiV1Project(
  client: ApiV1ProjectMutationRpcClient,
  input: ApiV1TransitionProjectInput,
): Promise<ApiV1TransitionProjectResult> {
  return invokeTransitionProject(
    API_V1_TRANSITION_PROJECT_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Project Transition Step 2 — invoke the accepted
 * `public.mcp_v1_transition_project` wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function. The ONLY difference is the
 * fixed wrapper name, which the database uses to derive the trusted source
 * channel.
 */
export function transitionMcpV1Project(
  client: ApiV1ProjectMutationRpcClient,
  input: ApiV1TransitionProjectInput,
): Promise<ApiV1TransitionProjectResult> {
  return invokeTransitionProject(
    MCP_V1_TRANSITION_PROJECT_FUNCTION_NAME,
    client,
    input,
  );
}
