// API-G.1L — Pure protected HTTP transport handler for btpm-api-v1.
//
// This module composes the accepted API-G helpers and the protected-route
// contract into a single fail-closed request handler. It is intentionally
// inert: no environment reads, no Supabase client construction, no live
// routes, no mutable global state, and no Edge Function activation. The
// later live `index.ts` runtime entry point will import this handler and
// pass fully constructed dependencies into `handleApiV1Request`.

import {
  ApiHttpError,
  jsonResponse,
  logApiEvent,
  readBoundedJson,
  resolveRequestId,
  toSafeHttpErrorResponse,
  withApiTimeout,
  type ApiLogEvent,
  type ApiLogMethod,
  type RequestIdDependencies,
} from "../_shared/btpm-api/http.ts";
import { buildCorsHeaders } from "../_shared/btpm-api/cors.ts";
import { ApiAuthenticationError } from "../_shared/btpm-api/apiErrors.ts";
import type {
  ApiActivityRecordInput,
  ApiActivityRecorder,
} from "../_shared/btpm-api/supabaseActivity.ts";
import type {
  ApiActivityScope,
  ApiActivityScopeResolver,
} from "../_shared/btpm-api/supabaseActivityScope.ts";

import {
  executeApiAppendExecutionUpdateRoute,
  executeApiCreateRiskRoute,
  executeApiUpdateRiskRoute,
  // KPI-4B — the single accepted external Project KPI definition create.
  executeApiCreateKpiRoute,
  executeApiUpdateKpiRoute,
  // KPI-6B — the single accepted external KPI update-history append.
  executeApiAppendKpiUpdateRoute,
  executeApiCreateBlockerRoute,
  executeApiUpdateBlockerRoute,
  executeApiCreatePortfolioRoute,
  executeApiUpdatePortfolioRoute,
  // API-Q Portfolio-6B — the accepted external Project↔Portfolio assignment.
  executeApiAssignProjectPortfolioRoute,
  executeApiCreateProgramRoute,
  executeApiUpdateProgramRoute,
  executeApiCreateProjectRoute,
  executeApiUpdateProjectRoute,
  executeApiTransitionProjectRoute,
  executeApiCreatePhaseRoute,
  executeApiUpdatePhaseRoute,
  executeApiReorderPhasesRoute,
  executeApiPlanPhaseRoute,
  executeApiCreateTaskRoute,
  executeApiUpdateTaskRoute,
  executeApiReorderTasksRoute,
  executeApiPlanTaskRoute,
  executeApiAssignTaskRoute,
  executeApiTransitionTaskRoute,
  executeApiProtectedRoute,
  matchApiRoute,
  resolveApiRouteAccess,
  type ApiAppendExecutionUpdateRouteDependencies,
  type ApiAppendExecutionUpdateRouteResult,
  type ApiCreateRiskRouteResult,
  type ApiRiskMutationRouteDependencies,
  // KPI-4B — accepted KPI mutation route dependency + result contracts.
  type ApiKpiMutationRouteDependencies,
  type ApiCreateKpiRouteResult,
  type ApiUpdateKpiRouteResult,
  type ApiAppendKpiUpdateRouteResult,
  type ApiUpdateRiskRouteResult,
  type ApiCreateBlockerRouteResult,
  type ApiBlockerMutationRouteDependencies,
  type ApiUpdateBlockerRouteResult,
  type ApiCreatePortfolioRouteResult,
  type ApiUpdatePortfolioRouteResult,
  type ApiAssignProjectPortfolioRouteResult,
  type ApiPortfolioMutationRouteDependencies,
  type ApiCreateProgramRouteResult,
  type ApiProgramMutationRouteDependencies,
  type ApiUpdateProgramRouteResult,
  type ApiCreateProjectRouteResult,
  type ApiUpdateProjectRouteResult,
  type ApiTransitionProjectRouteResult,
  type ApiProjectMutationRouteDependencies,
  type ApiCreatePhaseRouteResult,
  type ApiPhaseMutationRouteDependencies,
  type ApiUpdatePhaseRouteResult,
  type ApiReorderPhasesRouteResult,
  type ApiPlanPhaseRouteResult,
  type ApiCreateTaskRouteResult,
  type ApiTaskMutationRouteDependencies,
  type ApiUpdateTaskRouteResult,
  type ApiReorderTasksRouteResult,
  type ApiPlanTaskRouteResult,
  type ApiAssignTaskRouteResult,
  type ApiTransitionTaskRouteResult,
  type ApiProtectedRouteDependencies,
  type ApiProtectedRouteResult,
  type ApiRuntimeControls,
} from "./router.ts";
import { ORGANIZATIONS_ROUTE } from "./routes/organizations.ts";
import { WORKSPACES_ROUTE } from "./routes/workspaces.ts";
// API-Q WML-1B — the accepted Workspace-member read path parser. It is the
// sole authority for recognising the query-bearing Workspace-member pathname.
import { parseApiV1WorkspaceMembersPath } from "./routes/workspaceMembers.ts";
import { PROJECTS_ROUTE } from "./routes/projects.ts";
// API-N.2B — the Program collection is query-aware; Program detail is not.
import { PROGRAMS_ROUTE } from "./routes/programs.ts";
// API-Q Portfolio-4B — the single accepted external Portfolio create route.
// API-Q Portfolio-5B — the accepted external Portfolio update route + parser.
import {
  PORTFOLIO_CREATE_ROUTE,
  PORTFOLIO_UPDATE_ROUTE,
  PORTFOLIO_ASSIGN_PROJECT_ROUTE,
  parseApiV1PortfolioUpdatePath,
  parseApiV1PortfolioAssignProjectPath,
} from "./routes/portfolios.ts";

import { EXECUTION_UPDATES_APPEND_ROUTE } from "./routes/executionUpdates.ts";
// API-K.7 — explicit Risk mutation route constants. No generic POST/PATCH
// dispatch is introduced.
import {
  RISK_CREATE_ROUTE,
  RISK_UPDATE_ROUTE,
  parseApiV1RiskUpdatePath,
  // API-M.CP.2B2 — accepted CP.2B1 Risk collection path parser, used only to
  // recognise the query-bearing Risk collection pathname.
  parseApiV1ProjectRisksPath,
} from "./routes/risks.ts";
// KPI-4B — explicit Project KPI create route constant and its accepted strict
// path parser. No generic `/v1/projects/*` POST dispatcher is introduced.
import {
  KPI_CREATE_ROUTE,
  parseApiV1ProjectKpisPath,
  // KPI-5B — the sole KPI-ID path authority, reused for PATCH recognition.
  parseApiV1KpiDetailPath,
  KPI_UPDATE_ROUTE,
  // KPI-6B — the sole KPI update-history path authority, reused for POST
  // recognition of the append command.
  parseApiV1KpiUpdatesPath,
  KPI_UPDATE_APPEND_ROUTE,
} from "../_shared/btpm-api/routes/kpis.ts";
// API-K.8 — explicit Blocker mutation route constants.
import {
  BLOCKER_CREATE_ROUTE,
  BLOCKER_UPDATE_ROUTE,
  parseApiV1BlockerUpdatePath,
  // API-M.CP.2C3 — accepted CP.2C2 Blocker collection path parser, used only to
  // recognise the query-bearing Blocker collection pathname.
  parseApiV1ProjectBlockersPath,
} from "./routes/blockers.ts";
// API-M.CP.3C — accepted CP.3B frozen Execution Update read route constant,
// used only to recognise its exact static query-bearing pathname.
import { EXECUTION_UPDATES_READ_ROUTE } from "./routes/executionUpdates.ts";
// API-N.9A — the single explicit external Program mutation route constant.
import {
  PROGRAM_CREATE_ROUTE,
  PROGRAM_UPDATE_ROUTE,
  parseApiV1ProgramUpdatePath,
} from "./routes/programs.ts";
// API-N.5 — the single explicit external Project mutation route constant.
import {
  PROJECT_CREATE_ROUTE,
  // API-N.6 — exact external Project metadata update route + path parser.
  PROJECT_UPDATE_ROUTE,
  parseApiV1ProjectUpdatePath,
  // API-N.7 — exact external Project status-transition route + path parser.
  PROJECT_TRANSITION_ROUTE,
  parseApiV1ProjectTransitionPath,
} from "./routes/projects.ts";
// API-M.8A / API-M.8B — explicit Phase mutation route constants.
import {
  PHASE_CREATE_ROUTE,
  PHASE_PLANNING_ROUTE,
  PHASE_REORDER_ROUTE,
  PHASE_UPDATE_ROUTE,
  parseApiV1PhasePlanningPath,
  parseApiV1PhaseReorderPath,
  parseApiV1PhaseUpdatePath,
} from "./routes/phases.ts";
// API-M.11A / API-M.11B — explicit Task mutation route constants. Exactly four
// reachable targets; no generic Task dispatch is introduced.
import {
  TASK_ASSIGN_ROUTE,
  TASK_CREATE_ROUTE,
  TASK_PLANNING_ROUTE,
  TASK_REORDER_ROUTE,
  TASK_TRANSITION_ROUTE,
  TASK_UPDATE_ROUTE,
  parseApiV1TaskAssignPath,
  parseApiV1TaskPlanningPath,
  parseApiV1TaskReorderPath,
  parseApiV1TaskTransitionPath,
  parseApiV1TaskUpdatePath,
} from "./routes/tasks.ts";



/**
 * API-G.5.10A-3 — Optional, purely injected durable-activity instrumentation.
 * Instrumentation is best-effort: absence or malformation never changes the
 * HTTP outcome.
 */
export interface ApiV1ActivityDependencies {
  readonly recorder: ApiActivityRecorder;
  /**
   * API-ADM.1 — optional, service-role-bound canonical scope resolver used
   * ONLY to attribute an already-successful mutation to its Tenant /
   * Organization / Workspace / Project. Absence or failure never changes the
   * HTTP outcome; the event is then recorded without hierarchy.
   */
  readonly scopeResolver?: ApiActivityScopeResolver;
  nowMs(): number;
  schedule(task: Promise<boolean>): void;
}


export interface ApiV1HttpHandlerDependencies {
  readonly controls: ApiRuntimeControls;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly timeoutMs: number;
  readonly requestId: RequestIdDependencies;
  readonly protectedRoute: ApiProtectedRouteDependencies;
  readonly activity?: ApiV1ActivityDependencies;
  /**
   * API-I.9B — narrowly scoped, optional mutation dependency for the single
   * external mutation route. Read-only callers omit it entirely; a POST to the
   * mutation route fails closed with `internal_error` when it is absent or
   * malformed.
   */
  readonly appendExecutionUpdateRoute?: ApiAppendExecutionUpdateRouteDependencies;
  /**
   * API-K.7 — narrowly scoped, optional dependency carrying exactly the two
   * delegated Risk mutation executors. Absent or malformed dependencies make
   * the Risk routes fail closed with `internal_error`.
   */
  readonly riskMutationRoute?: ApiRiskMutationRouteDependencies;
  /**
   * KPI-4B — narrowly scoped, optional dependency carrying exactly the single
   * delegated KPI create executor. Absent or malformed dependencies make the
   * KPI mutation route fail closed with `internal_error`.
   */
  readonly kpiMutationRoute?: ApiKpiMutationRouteDependencies;
  /**
   * API-K.8 — narrowly scoped, optional dependency carrying exactly the two
   * delegated Blocker mutation executors. Absent or malformed dependencies
   * make the Blocker routes fail closed with `internal_error`.
   */
  readonly blockerMutationRoute?: ApiBlockerMutationRouteDependencies;
  /**
   * API-M.8A / API-M.8B — narrowly scoped, optional dependency carrying exactly
   * the four delegated Phase mutation executors. Absent or malformed dependencies make
   * the Phase routes fail closed with `internal_error`.
   */
  readonly phaseMutationRoute?: ApiPhaseMutationRouteDependencies;
  /**
   * API-N.5 — narrowly scoped, optional dependency carrying exactly the single
   * delegated Project create executor. Absent or malformed dependencies make
   * the Project mutation route fail closed with `internal_error`.
   */
  readonly projectMutationRoute?: ApiProjectMutationRouteDependencies;
  /**
   * API-N.9A / API-N.9B — narrowly scoped, optional dependency carrying exactly
   * the two delegated Program executors (create + update). Absent or malformed
   * dependencies make both Program mutation routes fail closed with
   * `internal_error`.
   */
  readonly programMutationRoute?: ApiProgramMutationRouteDependencies;
  /**
   * API-Q Portfolio-4B — narrowly scoped, optional dependency carrying exactly
   * the single delegated Portfolio create executor. Absent or malformed
   * dependencies make the Portfolio mutation route fail closed with
   * `internal_error`.
   */
  readonly portfolioMutationRoute?: ApiPortfolioMutationRouteDependencies;
  
  /**
   * API-M.11A — narrowly scoped, optional dependency carrying exactly the two
   * delegated Task mutation executors (create + metadata update). Absent or
   * malformed dependencies make the Task routes fail closed with
   * `internal_error`.
   */
  readonly taskMutationRoute?: ApiTaskMutationRouteDependencies;
}

/**
 * API-M.8B — exact CORS preflight recognition for the nested Phase reorder
 * path. The accepted parser is the sole authority; no `/v1/projects/*` wildcard
 * preflight is introduced.
 */
function isExactPhaseReorderPreflightPath(pathname: string): boolean {
  try {
    parseApiV1PhaseReorderPath(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * API-M.CP.2B2 — exact recognition of the accepted query-bearing Project-Risk
 * collection pathname. The accepted CP.2B1 parser is the sole authority; no
 * `/v1/projects/*` wildcard or generic subresource matcher is introduced.
 */
/**
 * API-Q WML-1B — exact recognition of the accepted query-bearing
 * Workspace-member pathname. The accepted WML-1B parser is the sole authority;
 * no `/v1/workspaces/*` wildcard or generic subresource matcher is introduced.
 */
function isExactWorkspaceMembersPath(pathname: string): boolean {
  try {
    parseApiV1WorkspaceMembersPath(pathname);
    return true;
  } catch {
    return false;
  }
}

function isExactProjectRisksCollectionPath(pathname: string): boolean {
  try {
    parseApiV1ProjectRisksPath(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * API-M.CP.2C3 — exact recognition of the accepted query-bearing
 * Project-Blocker collection pathname. The accepted CP.2C2 parser is the sole
 * authority; no `/v1/projects/*` wildcard or generic subresource matcher is
 * introduced.
 */
function isExactProjectBlockersCollectionPath(pathname: string): boolean {
  try {
    parseApiV1ProjectBlockersPath(pathname);
    return true;
  } catch {
    return false;
  }
}



// API-M.11B — the nested Task reorder path is an exact POST preflight target,
// validated by its own accepted parser only.
function isExactTaskReorderPreflightPath(pathname: string): boolean {
  try {
    parseApiV1TaskReorderPath(pathname);
    return true;
  } catch {
    return false;
  }
}

/** API-M.11C — exact validated Task transition / assignment preflight paths. */
function isExactTaskTransitionPreflightPath(pathname: string): boolean {
  try {
    parseApiV1TaskTransitionPath(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * API-N.7 — exact CORS preflight recognition for the nested Project transition
 * path. The accepted parser is the sole authority; no `/v1/projects/*` wildcard
 * preflight is introduced.
 */
function isExactProjectTransitionPreflightPath(pathname: string): boolean {
  try {
    parseApiV1ProjectTransitionPath(pathname);
    return true;
  } catch {
    return false;
  }
}

function isExactTaskAssignPreflightPath(pathname: string): boolean {
  try {
    parseApiV1TaskAssignPath(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * API-Q Portfolio-6B — exact CORS preflight recognition for the nested
 * Project↔Portfolio assignment path. The accepted parser is the sole authority;
 * no `/v1/projects/*` wildcard preflight is introduced.
 */
function isExactAssignProjectPortfolioPreflightPath(
  pathname: string,
): boolean {
  try {
    parseApiV1PortfolioAssignProjectPath(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * KPI-4B — exact POST preflight recognition for the single Project KPI create
 * path. The accepted KPI path parser is the sole authority; no prefix or
 * wildcard matching is introduced.
 */
function isExactProjectKpiCreatePreflightPath(pathname: string): boolean {
  try {
    parseApiV1ProjectKpisPath(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * KPI-6B — exact POST preflight recognition for the single KPI update-history
 * append path. `parseApiV1KpiUpdatesPath` is the sole authority; no wildcard
 * `/v1/kpis/*` preflight logic is introduced.
 */
function isExactKpiUpdateAppendPreflightPath(pathname: string): boolean {
  try {
    parseApiV1KpiUpdatesPath(pathname);
    return true;
  } catch (cause) {
    if (cause instanceof ApiHttpError && cause.code === "invalid_request") {
      return false;
    }
    throw cause;
  }
}

/**
 * KPI-5B — exact PATCH preflight recognition for the single KPI update path.
 * `parseApiV1KpiDetailPath` is the sole authority; no wildcard `/v1/kpis/*`
 * matching is introduced.
 */
function isExactKpiUpdatePreflightPath(pathname: string): boolean {
  try {
    parseApiV1KpiDetailPath(pathname);
    return true;
  } catch {
    return false;
  }
}

/** API-I.9B — exact bounded POST body cap for the single mutation route. */
const MUTATION_MAX_BODY_BYTES = 65_536;

const FALLBACK_REQUEST_ID = "unavailable";


const LOG_METHOD_SET: ReadonlySet<ApiLogMethod> = new Set<ApiLogMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

const CONTENT_LENGTH_PATTERN = /^[0-9]+$/;

// API-G.5.10A-3 — Durable-activity correlation-ID contract (narrower than the
// HTTP request-ID contract).
const ACTIVITY_CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ACTIVITY_DURATION_MS = 3_600_000;

function toActivityCorrelationId(requestId: unknown): string | null {
  if (typeof requestId !== "string") return null;
  return ACTIVITY_CORRELATION_ID_PATTERN.test(requestId) ? requestId : null;
}

function isValidActivityTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isValidActivityDuration(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_ACTIVITY_DURATION_MS
  );
}


function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

/**
 * Returns usable activity instrumentation, or null when it is absent or
 * malformed. Never throws; instrumentation is never part of the required
 * invocation-validation gate.
 */
function resolveActivityDependencies(
  value: unknown,
): ApiV1ActivityDependencies | null {
  if (!isNonArrayObject(value)) return null;
  const a = value as Record<string, unknown>;
  if (typeof a.nowMs !== "function") return null;
  if (typeof a.schedule !== "function") return null;
  if (!isNonArrayObject(a.recorder)) return null;
  if (typeof (a.recorder as { record?: unknown }).record !== "function") {
    return null;
  }
  return value as unknown as ApiV1ActivityDependencies;
}

/** Reads the injected clock defensively. Returns null on any failure. */
function readActivityClock(activity: ApiV1ActivityDependencies): number | null {
  let value: unknown;
  try {
    value = activity.nowMs();
  } catch {
    return null;
  }
  return isValidActivityTimestamp(value) ? value : null;
}

/**
 * Best-effort background scheduling of one durable-activity record. Never
 * throws, never awaits recording, never alters the HTTP result.
 */
function scheduleActivity(
  activity: ApiV1ActivityDependencies,
  input: ApiActivityRecordInput,
): void {
  try {
    let task: Promise<boolean>;
    try {
      task = Promise.resolve(activity.recorder.record(input)).then(
        (v) => v === true,
        () => false,
      );
    } catch {
      task = Promise.resolve(false);
    }
    activity.schedule(task);
  } catch {
    // Instrumentation failures are contained.
  }
}

/**
 * API-ADM.1 — Activity metadata WITHOUT hierarchy. The four canonical scope
 * fields are supplied exclusively by the server-side resolver.
 */
type ApiActivityUnscopedInput = Omit<
  ApiActivityRecordInput,
  "tenantId" | "organizationId" | "workspaceId" | "projectId"
>;

/**
 * API-ADM.1 — Canonical mutation target identity taken ONLY from the
 * server-returned successful mutation result. Raw request-body values are
 * never used as the attribution source.
 */
interface ApiActivityMutationTarget {
  readonly targetType: unknown;
  readonly targetId: unknown;
}

function readScopeResolver(
  activity: ApiV1ActivityDependencies,
): ApiActivityScopeResolver | null {
  const candidate = (activity as { scopeResolver?: unknown }).scopeResolver;
  if (!isNonArrayObject(candidate)) return null;
  if (typeof (candidate as { resolve?: unknown }).resolve !== "function") {
    return null;
  }
  return candidate as unknown as ApiActivityScopeResolver;
}

function withScope(
  base: ApiActivityUnscopedInput,
  scope: ApiActivityScope | null,
): ApiActivityRecordInput {
  return {
    ...base,
    tenantId: scope === null ? null : scope.tenantId,
    organizationId: scope === null ? null : scope.organizationId,
    workspaceId: scope === null ? null : scope.workspaceId,
    projectId: scope === null ? null : scope.projectId,
  };
}

/**
 * API-ADM.1 — Best-effort background scheduling of one durable-activity
 * record for a successful mutation, attributed to the canonical hierarchy
 * derived server-side from the SUCCESS result target. Resolution failure,
 * recorder failure or a missing resolver never alters the HTTP outcome.
 */
function scheduleMutationActivity(
  activity: ApiV1ActivityDependencies,
  target: ApiActivityMutationTarget,
  base: ApiActivityUnscopedInput,
): void {
  const resolver = readScopeResolver(activity);
  if (resolver === null) {
    scheduleActivity(activity, withScope(base, null));
    return;
  }

  const targetType = typeof target.targetType === "string"
    ? target.targetType
    : "";
  const targetId = typeof target.targetId === "string" ? target.targetId : "";

  try {
    const task: Promise<boolean> = (async () => {
      let scope: ApiActivityScope | null = null;
      try {
        scope = await resolver.resolve(targetType, targetId);
      } catch {
        scope = null;
      }
      try {
        const recorded = await activity.recorder.record(
          withScope(base, scope),
        );
        return recorded === true;
      } catch {
        return false;
      }
    })();
    activity.schedule(task);
  } catch {
    // Instrumentation failures are contained.
  }
}



function validateInvocation(
  request: unknown,
  dependencies: unknown,
): dependencies is ApiV1HttpHandlerDependencies {
  if (!(request instanceof Request)) return false;
  if (!isNonArrayObject(dependencies)) return false;
  const d = dependencies as Record<string, unknown>;
  if (!isNonArrayObject(d.controls)) return false;
  if (!isNonArrayObject(d.allowedOrigins)) {
    // Set instances are objects
    return false;
  }
  const allowed = d.allowedOrigins as { has?: unknown };
  if (typeof allowed.has !== "function") return false;
  if (!isPositiveSafeInteger(d.timeoutMs)) return false;
  if (!isNonArrayObject(d.requestId)) return false;
  if (typeof (d.requestId as { randomUUID?: unknown }).randomUUID !== "function") {
    return false;
  }
  if (!isNonArrayObject(d.protectedRoute)) return false;
  return true;
}

function toLogMethod(method: string): ApiLogMethod | undefined {
  return LOG_METHOD_SET.has(method as ApiLogMethod)
    ? (method as ApiLogMethod)
    : undefined;
}

function emitReceived(requestId: string, method: ApiLogMethod | undefined): void {
  const event: ApiLogEvent = {
    level: "info",
    event: "api.request.received",
    requestId,
  };
  if (method !== undefined) event.method = method;
  logApiEvent(event);
}

function emitTerminalForHttpError(
  requestId: string,
  method: ApiLogMethod | undefined,
  err: ApiHttpError,
): void {
  const level = err.status >= 500 ? "error" : "warn";
  const eventName =
    err.status >= 500 ? "api.request.failed" : "api.request.rejected";
  const event: ApiLogEvent = {
    level,
    event: eventName,
    requestId,
    status: err.status,
    code: err.code,
  };
  if (method !== undefined) event.method = method;
  logApiEvent(event);
}

function emitTerminalForAuthError(
  requestId: string,
  method: ApiLogMethod | undefined,
  err: ApiAuthenticationError,
): void {
  // Do NOT place ApiAuthenticationError codes into the ApiHttpErrorCode
  // logging field. Only safe metadata is emitted.
  const level = err.status >= 500 ? "error" : "warn";
  const eventName =
    err.status >= 500 ? "api.request.failed" : "api.request.rejected";
  const event: ApiLogEvent = {
    level,
    event: eventName,
    requestId,
    status: err.status,
  };
  if (method !== undefined) event.method = method;
  logApiEvent(event);
}

function safeAuthErrorResponse(
  err: ApiAuthenticationError,
  requestId: string,
  extraHeaders: HeadersInit,
): Response {
  const body = {
    error: { code: err.code, message: err.publicMessage },
    requestId,
  };
  return jsonResponse(err.status, body, requestId, extraHeaders);
}

function safeMethodForRequest(request: unknown): ApiLogMethod | undefined {
  if (!(request instanceof Request)) return undefined;
  return toLogMethod(request.method);
}

/**
 * Pure fail-closed HTTP transport handler for the two protected API v1
 * read routes. Never throws for ordinary request-processing failures.
 */
export async function handleApiV1Request(
  request: Request,
  dependencies: ApiV1HttpHandlerDependencies,
): Promise<Response> {
  // Phase 1 — Internal invocation validation.
  if (!validateInvocation(request, dependencies)) {
    const fallbackMethod = safeMethodForRequest(request);
    if (request instanceof Request) {
      emitReceived(FALLBACK_REQUEST_ID, fallbackMethod);
    }
    const err = new ApiHttpError("internal_error");
    logApiEvent({
      level: "error",
      event: "api.request.failed",
      requestId: FALLBACK_REQUEST_ID,
      status: err.status,
      code: err.code,
      ...(fallbackMethod !== undefined ? { method: fallbackMethod } : {}),
    });
    return toSafeHttpErrorResponse(err, FALLBACK_REQUEST_ID);
  }

  const deps = dependencies;

  // Phase 2 — Request ID resolution.
  let requestId: string;
  try {
    requestId = resolveRequestId(request, deps.requestId);
  } catch (cause) {
    const err =
      cause instanceof ApiHttpError
        ? cause
        : new ApiHttpError("internal_error", cause);
    const fallbackMethod = toLogMethod(request.method);
    emitReceived(FALLBACK_REQUEST_ID, fallbackMethod);
    emitTerminalForHttpError(FALLBACK_REQUEST_ID, fallbackMethod, err);
    return toSafeHttpErrorResponse(err, FALLBACK_REQUEST_ID);
  }

  const method = request.method;
  const logMethod = toLogMethod(method);

  // Phase 3 — Received event.
  emitReceived(requestId, logMethod);

  // Phase 4 — Exact-origin CORS.
  let corsHeaders: Headers;
  try {
    corsHeaders = buildCorsHeaders(request, deps.allowedOrigins);
  } catch (cause) {
    const err =
      cause instanceof ApiHttpError
        ? cause
        : new ApiHttpError("internal_error", cause);
    const varyOnly = new Headers({ Vary: "Origin" });
    emitTerminalForHttpError(requestId, logMethod, err);
    return toSafeHttpErrorResponse(err, requestId, varyOnly);
  }

  try {
    // Phase 5 — Parse URL and build the exact route target.
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    // API-H.3E-C1 — The three approved query-bearing collection routes are
    // matched by exact pathname only; their original query strings remain on
    // the untouched Request for strict downstream parsing inside
    // `executeApiProtectedRoute`. Every other route (including the static
    // metadata routes) keeps its query and fragment in the route target, so
    // query-bearing static targets still fail the exact allowlist match.
    // API-M.CP.2B2 — the accepted Project-Risk collection is the only
    // additional query-bearing route: it is matched by exact pathname while
    // its original query string stays on the untouched Request for strict
    // parsing inside `executeApiProtectedRoute`. No generic prefix matcher and
    // no blanket dynamic query-awareness is introduced; Risk detail remains
    // queryless.
    const isQueryAwareCollectionRoute =
      url.pathname === ORGANIZATIONS_ROUTE.path ||
      url.pathname === WORKSPACES_ROUTE.path ||
      url.pathname === PROJECTS_ROUTE.path ||
      // API-N.2B — the accepted Program collection is matched by exact pathname
      // while its original query string stays on the untouched Request for
      // strict parsing inside `executeApiProtectedRoute`. Program detail
      // remains queryless.
      (method === "GET" && url.pathname === PROGRAMS_ROUTE.path) ||

      // API-Q WML-1B — the accepted Workspace-member read is query-aware in
      // exactly the same way: matched by exact pathname while its original
      // query string stays on the untouched Request for strict parsing inside
      // `executeApiProtectedRoute`.
      (method === "GET" && isExactWorkspaceMembersPath(url.pathname)) ||
      (method === "GET" && isExactProjectRisksCollectionPath(url.pathname)) ||
      // API-M.CP.2C3 — the accepted Project-Blocker collection is query-aware in
      // exactly the same way: matched by exact pathname while its original query
      // string stays on the untouched Request for strict parsing inside
      // `executeApiProtectedRoute`. Blocker detail remains queryless.
      (method === "GET" && isExactProjectBlockersCollectionPath(url.pathname)) ||
      // API-M.CP.3C — the accepted Execution Update history read is a static
      // exact path that carries a query. It is matched by exact pathname while
      // its original query string stays on the untouched Request for strict
      // parsing inside `executeApiProtectedRoute`. POST
      // /v1/execution-updates is deliberately NOT query-aware.
      (method === "GET" &&
        url.pathname === EXECUTION_UPDATES_READ_ROUTE.path);


    const routeTarget =
      isQueryAwareCollectionRoute && url.hash === ""
        ? url.pathname
        : url.pathname + url.search + url.hash;


    // Phase 6 — Method allowlist (before authentication). API-I.9B adds POST,
    // valid for exactly one route.
    if (
      method !== "GET" &&
      method !== "POST" &&
      method !== "PATCH" &&
      // API-M.11C — PUT is valid for exactly one route: the Task assignment
      // path. Every other PUT target is rejected in the classification below.
      method !== "PUT" &&
      method !== "OPTIONS"
    ) {
      throw new ApiHttpError("route_not_found");
    }

    // Phase 6a — API-K.7 / API-K.8 explicit mutation-surface classification.
    // API-K.7-C1 — PATCH must be classified by an exact accepted update
    // pathname BEFORE the request is treated as belonging to any mutation
    // surface. PATCH resolves into exactly one of:
    //   A. valid Risk update path    -> Risk pipeline
    //   B. valid Blocker update path -> Blocker pipeline
    //   C. valid Phase update path   -> Phase pipeline (API-M.8A)
    //   D. anything else             -> route_not_found, before body read,
    //                                   authentication or execution.
    // The three strict parsers are the sole authorities; no shared prefix or
    // generic PATCH dispatch exists.
    let isRiskUpdatePath = false;
    let isBlockerUpdatePath = false;
    let isPhaseUpdatePath = false;
    // API-M.8B — the nested Phase planning path is classified by its own exact
    // parser. The metadata-update parser already rejects it.
    let isPhasePlanningPath = false;
    // API-M.11A — exact Task metadata-update path classification.
    let isTaskUpdatePath = false;
    // API-M.11B — the nested Task planning path is classified by its own exact
    // parser. The Task metadata-update parser already rejects it.
    let isTaskPlanningPath = false;
    // API-N.6 — exact Project metadata-update path classification.
    let isProjectUpdatePath = false;
    // API-N.9B — exact Program metadata-update path classification.
    let isProgramUpdatePath = false;
    // API-Q Portfolio-5B — exact Portfolio metadata-update path classification.
    let isPortfolioUpdatePath = false;
    // KPI-5B — exact KPI definition-update path classification.
    let isKpiUpdatePath = false;
    if (method === "PATCH") {
      try {
        parseApiV1RiskUpdatePath(url.pathname);
        isRiskUpdatePath = true;
      } catch (cause) {
        if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
          throw cause;
        }
      }
      if (!isRiskUpdatePath) {
        try {
          parseApiV1BlockerUpdatePath(url.pathname);
          isBlockerUpdatePath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (!isRiskUpdatePath && !isBlockerUpdatePath) {
        try {
          parseApiV1PhaseUpdatePath(url.pathname);
          isPhaseUpdatePath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (!isRiskUpdatePath && !isBlockerUpdatePath && !isPhaseUpdatePath) {
        try {
          parseApiV1PhasePlanningPath(url.pathname);
          isPhasePlanningPath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (
        !isRiskUpdatePath && !isBlockerUpdatePath && !isPhaseUpdatePath &&
        !isPhasePlanningPath
      ) {
        // API-M.11A — the exact Task update path is classified by its own
        // accepted parser. No shared prefix with any other PATCH surface
        // exists, and no generic PATCH dispatch is introduced.
        try {
          parseApiV1TaskUpdatePath(url.pathname);
          isTaskUpdatePath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (
        !isRiskUpdatePath && !isBlockerUpdatePath && !isPhaseUpdatePath &&
        !isPhasePlanningPath && !isTaskUpdatePath
      ) {
        // API-M.11B — the nested Task planning path is the last accepted PATCH
        // surface, classified by its own exact parser.
        try {
          parseApiV1TaskPlanningPath(url.pathname);
          isTaskPlanningPath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (
        !isRiskUpdatePath && !isBlockerUpdatePath && !isPhaseUpdatePath &&
        !isPhasePlanningPath && !isTaskUpdatePath && !isTaskPlanningPath
      ) {
        // API-N.6 — the exact Project metadata-update path is classified by its
        // own accepted parser. No shared prefix or generic PATCH dispatch is
        // introduced.
        try {
          parseApiV1ProjectUpdatePath(url.pathname);
          isProjectUpdatePath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (
        !isRiskUpdatePath && !isBlockerUpdatePath && !isPhaseUpdatePath &&
        !isPhasePlanningPath && !isTaskUpdatePath && !isTaskPlanningPath &&
        !isProjectUpdatePath
      ) {
        // API-N.9B — the exact Program metadata-update path is the last
        // accepted PATCH surface, classified by its own accepted parser. No
        // shared prefix or generic PATCH dispatch is introduced.
        try {
          parseApiV1ProgramUpdatePath(url.pathname);
          isProgramUpdatePath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (
        !isRiskUpdatePath && !isBlockerUpdatePath && !isPhaseUpdatePath &&
        !isPhasePlanningPath && !isTaskUpdatePath && !isTaskPlanningPath &&
        !isProjectUpdatePath && !isProgramUpdatePath
      ) {
        // API-Q Portfolio-5B — the exact Portfolio metadata-update path is the
        // last accepted PATCH surface, classified by its own accepted parser. No
        // shared prefix or generic PATCH dispatch is introduced.
        try {
          parseApiV1PortfolioUpdatePath(url.pathname);
          isPortfolioUpdatePath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (
        !isRiskUpdatePath && !isBlockerUpdatePath && !isPhaseUpdatePath &&
        !isPhasePlanningPath && !isTaskUpdatePath && !isTaskPlanningPath &&
        !isProjectUpdatePath && !isProgramUpdatePath && !isPortfolioUpdatePath
      ) {
        // KPI-5B — the exact KPI definition-update path is the last accepted
        // PATCH surface, classified by the accepted KPI detail path authority.
        // No shared prefix or generic PATCH dispatch is introduced.
        try {
          parseApiV1KpiDetailPath(url.pathname);
          isKpiUpdatePath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (
        !isRiskUpdatePath && !isBlockerUpdatePath && !isPhaseUpdatePath &&
        !isPhasePlanningPath && !isTaskUpdatePath && !isTaskPlanningPath &&
        !isProjectUpdatePath && !isProgramUpdatePath &&
        !isPortfolioUpdatePath && !isKpiUpdatePath
      ) {
        throw new ApiHttpError("route_not_found");
      }
    }

    // API-M.11C — exact PUT classification. PUT resolves into exactly one
    // accepted target: a valid Task assignment path. Anything else is rejected
    // before the body is read, before authentication and before execution.
    let isTaskAssignPath = false;
    // API-Q Portfolio-6B — the second and only other accepted PUT target: an
    // exact Project↔Portfolio assignment path, classified by its own accepted
    // parser. No shared prefix or generic PUT dispatch is introduced.
    let isPortfolioAssignProjectPath = false;
    if (method === "PUT") {
      try {
        parseApiV1TaskAssignPath(url.pathname);
        isTaskAssignPath = true;
      } catch (cause) {
        if (
          !(cause instanceof ApiHttpError && cause.code === "invalid_request")
        ) {
          throw cause;
        }
      }
      if (!isTaskAssignPath) {
        try {
          parseApiV1PortfolioAssignProjectPath(url.pathname);
          isPortfolioAssignProjectPath = true;
        } catch (cause) {
          if (
            !(cause instanceof ApiHttpError && cause.code === "invalid_request")
          ) {
            throw cause;
          }
        }
      }
      if (!isTaskAssignPath && !isPortfolioAssignProjectPath) {
        throw new ApiHttpError("route_not_found");
      }
    }

    // API-M.8B — exact POST classification for the nested Phase reorder path.
    // No generic `/v1/projects/*` POST dispatcher exists.
    let isPhaseReorderPath = false;
    if (method === "POST" && url.pathname !== PHASE_CREATE_ROUTE.path) {
      try {
        parseApiV1PhaseReorderPath(url.pathname);
        isPhaseReorderPath = true;
      } catch (cause) {
        if (
          !(cause instanceof ApiHttpError && cause.code === "invalid_request")
        ) {
          throw cause;
        }
      }
    }

    // API-M.11B — exact POST classification for the nested Task reorder path.
    // No generic `/v1/phases/*` POST dispatcher exists.
    let isTaskReorderPath = false;
    if (
      method === "POST" && !isPhaseReorderPath &&
      url.pathname !== PHASE_CREATE_ROUTE.path &&
      url.pathname !== TASK_CREATE_ROUTE.path
    ) {
      try {
        parseApiV1TaskReorderPath(url.pathname);
        isTaskReorderPath = true;
      } catch (cause) {
        if (
          !(cause instanceof ApiHttpError && cause.code === "invalid_request")
        ) {
          throw cause;
        }
      }
    }

    // API-M.11C — exact POST classification for the nested Task transition
    // path. No generic `/v1/tasks/*` POST dispatcher exists.
    let isTaskTransitionPath = false;
    if (
      method === "POST" && !isPhaseReorderPath && !isTaskReorderPath &&
      url.pathname !== PHASE_CREATE_ROUTE.path &&
      url.pathname !== TASK_CREATE_ROUTE.path
    ) {
      try {
        parseApiV1TaskTransitionPath(url.pathname);
        isTaskTransitionPath = true;
      } catch (cause) {
        if (
          !(cause instanceof ApiHttpError && cause.code === "invalid_request")
        ) {
          throw cause;
        }
      }
    }

    // API-N.7 — exact POST classification for the nested Project transition
    // path. No generic `/v1/projects/*` POST dispatcher exists.
    let isProjectTransitionPath = false;
    if (
      method === "POST" && !isPhaseReorderPath && !isTaskReorderPath &&
      !isTaskTransitionPath &&
      url.pathname !== PROJECT_CREATE_ROUTE.path &&
      url.pathname !== PHASE_CREATE_ROUTE.path &&
      url.pathname !== TASK_CREATE_ROUTE.path
    ) {
      try {
        parseApiV1ProjectTransitionPath(url.pathname);
        isProjectTransitionPath = true;
      } catch (cause) {
        if (
          !(cause instanceof ApiHttpError && cause.code === "invalid_request")
        ) {
          throw cause;
        }
      }
    }

    // KPI-4B — exact POST classification for the single nested Project KPI
    // create path. The accepted KPI path parser is the sole authority; no
    // generic `/v1/projects/*` POST dispatcher exists.
    let isProjectKpiCreatePath = false;
    if (method === "POST") {
      try {
        parseApiV1ProjectKpisPath(url.pathname);
        isProjectKpiCreatePath = true;
      } catch (cause) {
        if (
          !(cause instanceof ApiHttpError && cause.code === "invalid_request")
        ) {
          throw cause;
        }
      }
    }

    // KPI-4B — explicit Project KPI create dispatch. Exactly one additional
    // target becomes reachable: POST /v1/projects/<validated UUID>/kpis.
    if (isProjectKpiCreatePath) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Runtime gate on the actual pathname, before any body read.
      const createKpiRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (createKpiRoute !== KPI_CREATE_ROUTE) {
        throw new ApiHttpError("route_not_found");
      }

      const createKpiDeps = deps.kpiMutationRoute;
      if (!isNonArrayObject(createKpiDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawCreateKpiBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type CreateKpiOutcome =
        | { readonly kind: "ok"; readonly result: ApiCreateKpiRouteResult }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const createKpiActivity = resolveActivityDependencies(deps.activity);
      const createKpiStartMs = createKpiActivity === null
        ? null
        : readActivityClock(createKpiActivity);

      const createKpiOutcome = await withApiTimeout<CreateKpiOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = await executeApiCreateKpiRoute(
              request,
              rawCreateKpiBody,
              requestId,
              deps.controls,
              createKpiDeps as ApiKpiMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (createKpiOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, createKpiOutcome.error);
        return safeAuthErrorResponse(
          createKpiOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const createKpiPayload = createKpiOutcome.result.payload;

      // API-ADM.1 — attribution uses ONLY server-returned result identity. The
      // recorded target is the canonical `project` scope already supported by
      // the activity substrate; no KPI ID, name, narrative, payload hash or
      // idempotency key is ever recorded, and no caller-supplied hierarchy is
      // ever trusted. Only a genuinely `applied` create schedules activity: a
      // `replayed` outcome performed no new material mutation.
      if (
        createKpiPayload.outcome === "applied" &&
        createKpiActivity !== null && createKpiStartMs !== null
      ) {
        const endMs = readActivityClock(createKpiActivity);
        if (endMs !== null && endMs >= createKpiStartMs) {
          const durationMs = endMs - createKpiStartMs;
          if (isValidActivityDuration(durationMs)) {
            scheduleMutationActivity(
              createKpiActivity,
              {
                targetType: "project" as const,
                targetId: createKpiPayload.projectId,
              },
              {
                apiClientId:
                  createKpiOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: createKpiOutcome.result.route.id,
                method: "POST",
                status: createKpiOutcome.result.status,
                durationMs,
                actorUserId:
                  createKpiOutcome.result.activityIdentity.actorUserId,
                correlationId: toActivityCorrelationId(requestId),
              },
            );
          }
        }
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "POST",
        routeId: createKpiOutcome.result.route.id,
        status: createKpiOutcome.result.status,
      });
      return jsonResponse(
        createKpiOutcome.result.status,
        createKpiPayload,
        requestId,
        corsHeaders,
      );
    }

    // KPI-6B — exact POST classification for the single nested KPI
    // update-history append path. The accepted KPI update-history path parser is
    // the sole authority; no generic `/v1/kpis/*` POST dispatcher exists.
    let isKpiUpdateAppendPath = false;
    if (method === "POST" && !isProjectKpiCreatePath) {
      try {
        parseApiV1KpiUpdatesPath(url.pathname);
        isKpiUpdateAppendPath = true;
      } catch (cause) {
        if (
          !(cause instanceof ApiHttpError && cause.code === "invalid_request")
        ) {
          throw cause;
        }
      }
    }

    // KPI-6B — explicit KPI update-history append dispatch. Exactly one
    // additional target becomes reachable:
    // POST /v1/kpis/<validated UUID>/updates.
    if (isKpiUpdateAppendPath) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Runtime gate on the actual pathname, before any body read.
      const appendKpiUpdateRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (appendKpiUpdateRoute !== KPI_UPDATE_APPEND_ROUTE) {
        throw new ApiHttpError("route_not_found");
      }

      const appendKpiUpdateDeps = deps.kpiMutationRoute;
      if (!isNonArrayObject(appendKpiUpdateDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawAppendKpiUpdateBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type AppendKpiUpdateOutcome =
        | { readonly kind: "ok"; readonly result: ApiAppendKpiUpdateRouteResult }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const appendKpiUpdateActivity = resolveActivityDependencies(deps.activity);
      const appendKpiUpdateStartMs = appendKpiUpdateActivity === null
        ? null
        : readActivityClock(appendKpiUpdateActivity);

      const appendKpiUpdateOutcome = await withApiTimeout<
        AppendKpiUpdateOutcome
      >(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = await executeApiAppendKpiUpdateRoute(
              request,
              rawAppendKpiUpdateBody,
              requestId,
              deps.controls,
              appendKpiUpdateDeps as ApiKpiMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (appendKpiUpdateOutcome.kind === "authError") {
        emitTerminalForAuthError(
          requestId,
          logMethod,
          appendKpiUpdateOutcome.error,
        );
        return safeAuthErrorResponse(
          appendKpiUpdateOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const appendKpiUpdatePayload = appendKpiUpdateOutcome.result.payload;

      // API-ADM.1 — attribution uses ONLY server-returned result identity. The
      // recorded target is the server-returned Project, which is the canonical
      // `project` scope already supported by the activity substrate; no KPI ID,
      // KPI update ID, value, note, payload hash or idempotency key is ever
      // recorded. Only a genuinely `applied` append schedules activity: a
      // `replayed` outcome performed no new material mutation.
      if (
        appendKpiUpdatePayload.outcome === "applied" &&
        appendKpiUpdateActivity !== null && appendKpiUpdateStartMs !== null
      ) {
        const endMs = readActivityClock(appendKpiUpdateActivity);
        if (endMs !== null && endMs >= appendKpiUpdateStartMs) {
          const durationMs = endMs - appendKpiUpdateStartMs;
          if (isValidActivityDuration(durationMs)) {
            scheduleMutationActivity(
              appendKpiUpdateActivity,
              {
                targetType: "project" as const,
                targetId: appendKpiUpdatePayload.projectId,
              },
              {
                apiClientId:
                  appendKpiUpdateOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: appendKpiUpdateOutcome.result.route.id,
                method: "POST",
                status: appendKpiUpdateOutcome.result.status,
                durationMs,
                actorUserId:
                  appendKpiUpdateOutcome.result.activityIdentity.actorUserId,
                correlationId: toActivityCorrelationId(requestId),
              },
            );
          }
        }
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "POST",
        routeId: appendKpiUpdateOutcome.result.route.id,
        status: appendKpiUpdateOutcome.result.status,
      });
      return jsonResponse(
        appendKpiUpdateOutcome.result.status,
        appendKpiUpdatePayload,
        requestId,
        corsHeaders,
      );
    }

    // KPI-5B — explicit KPI definition update dispatch. Exactly one additional
    // target becomes reachable: PATCH /v1/kpis/<validated UUID>.
    if (isKpiUpdatePath) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Runtime gate on the actual pathname, before any body read.
      const updateKpiRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (updateKpiRoute !== KPI_UPDATE_ROUTE) {
        throw new ApiHttpError("route_not_found");
      }

      const updateKpiDeps = deps.kpiMutationRoute;
      if (!isNonArrayObject(updateKpiDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawUpdateKpiBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type UpdateKpiOutcome =
        | { readonly kind: "ok"; readonly result: ApiUpdateKpiRouteResult }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const updateKpiActivity = resolveActivityDependencies(deps.activity);
      const updateKpiStartMs = updateKpiActivity === null
        ? null
        : readActivityClock(updateKpiActivity);

      const updateKpiOutcome = await withApiTimeout<UpdateKpiOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = await executeApiUpdateKpiRoute(
              request,
              rawUpdateKpiBody,
              requestId,
              deps.controls,
              updateKpiDeps as ApiKpiMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (updateKpiOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, updateKpiOutcome.error);
        return safeAuthErrorResponse(
          updateKpiOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const updateKpiPayload = updateKpiOutcome.result.payload;

      // API-ADM.1 — attribution uses ONLY server-returned result identity. The
      // recorded target is the server-returned Project, which is the canonical
      // `project` scope already supported by the activity substrate; no KPI ID,
      // name, narrative, payload hash or idempotency key is ever recorded. Only
      // a genuinely `applied` update schedules activity: `no_change` and
      // `replayed` performed no new material mutation, and failures record none.
      if (
        updateKpiPayload.outcome === "applied" &&
        updateKpiActivity !== null && updateKpiStartMs !== null
      ) {
        const endMs = readActivityClock(updateKpiActivity);
        if (endMs !== null && endMs >= updateKpiStartMs) {
          const durationMs = endMs - updateKpiStartMs;
          if (isValidActivityDuration(durationMs)) {
            scheduleMutationActivity(
              updateKpiActivity,
              {
                targetType: "project" as const,
                targetId: updateKpiPayload.projectId,
              },
              {
                apiClientId:
                  updateKpiOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: updateKpiOutcome.result.route.id,
                method: "PATCH",
                status: updateKpiOutcome.result.status,
                durationMs,
                actorUserId:
                  updateKpiOutcome.result.activityIdentity.actorUserId,
                correlationId: toActivityCorrelationId(requestId),
              },
            );
          }
        }
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "PATCH",
        routeId: updateKpiOutcome.result.route.id,
        status: updateKpiOutcome.result.status,
      });
      return jsonResponse(
        updateKpiOutcome.result.status,
        updateKpiPayload,
        requestId,
        corsHeaders,
      );
    }

    if (
      (method === "POST" && url.pathname === RISK_CREATE_ROUTE.path) ||
      isRiskUpdatePath
    ) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      const isRiskCreate = method === "POST";


      // Runtime gate on the actual pathname, before any body read.
      const riskRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (
        riskRoute !== (isRiskCreate ? RISK_CREATE_ROUTE : RISK_UPDATE_ROUTE)
      ) {
        throw new ApiHttpError("route_not_found");
      }

      const riskDeps = deps.riskMutationRoute;
      if (!isNonArrayObject(riskDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawRiskBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type RiskOutcome =
        | {
          readonly kind: "ok";
          readonly result: ApiCreateRiskRouteResult | ApiUpdateRiskRouteResult;
        }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const riskActivity = resolveActivityDependencies(deps.activity);
      const riskStartMs = riskActivity === null
        ? null
        : readActivityClock(riskActivity);

      const riskOutcome = await withApiTimeout<RiskOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = isRiskCreate
              ? await executeApiCreateRiskRoute(
                request,
                rawRiskBody,
                requestId,
                deps.controls,
                riskDeps as ApiRiskMutationRouteDependencies,
              )
              : await executeApiUpdateRiskRoute(
                request,
                rawRiskBody,
                requestId,
                deps.controls,
                riskDeps as ApiRiskMutationRouteDependencies,
              );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (riskOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, riskOutcome.error);
        return safeAuthErrorResponse(
          riskOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const riskStatus = riskOutcome.result.status;
      const riskMethod: ApiLogMethod = isRiskCreate ? "POST" : "PATCH";

      if (riskActivity !== null && riskStartMs !== null) {
        const endMs = readActivityClock(riskActivity);
        if (endMs !== null && endMs >= riskStartMs) {
          const durationMs = endMs - riskStartMs;
          if (isValidActivityDuration(durationMs)) {
            // API-ADM.1 — structural metadata plus canonical hierarchy
            // derived SERVER-SIDE from the successful result target. No Risk
            // ID, narrative, payload hash or idempotency key is recorded, and
            // no caller-supplied hierarchy is ever trusted.
            scheduleMutationActivity(
              riskActivity,
              {
                targetType: riskOutcome.result.payload.targetType,
                targetId: riskOutcome.result.payload.targetId,
              },
              {
                apiClientId: riskOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: riskOutcome.result.route.id,
                method: riskMethod,
                status: riskStatus,
                durationMs,

                actorUserId: riskOutcome.result.activityIdentity.actorUserId,

                correlationId: toActivityCorrelationId(requestId),
              },
            );

          }
        }
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: riskMethod,
        routeId: riskOutcome.result.route.id,
        status: riskStatus,
      });
      return jsonResponse(
        riskStatus,
        riskOutcome.result.payload,
        requestId,
        corsHeaders,
      );
    }

    // Phase 6a2 — API-K.8 explicit Blocker mutation dispatch. Exactly two
    // targets are reachable: POST /v1/blockers and
    // PATCH /v1/blockers/<validated UUID>. No generic dispatch is added.
    if (
      (method === "POST" && url.pathname === BLOCKER_CREATE_ROUTE.path) ||
      isBlockerUpdatePath
    ) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      const isBlockerCreate = method === "POST";

      // Runtime gate on the actual pathname, before any body read.
      const blockerRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (
        blockerRoute !==
          (isBlockerCreate ? BLOCKER_CREATE_ROUTE : BLOCKER_UPDATE_ROUTE)
      ) {
        throw new ApiHttpError("route_not_found");
      }

      const blockerDeps = deps.blockerMutationRoute;
      if (!isNonArrayObject(blockerDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawBlockerBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type BlockerOutcome =
        | {
          readonly kind: "ok";
          readonly result:
            | ApiCreateBlockerRouteResult
            | ApiUpdateBlockerRouteResult;
        }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const blockerActivity = resolveActivityDependencies(deps.activity);
      const blockerStartMs = blockerActivity === null
        ? null
        : readActivityClock(blockerActivity);

      const blockerOutcome = await withApiTimeout<BlockerOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = isBlockerCreate
              ? await executeApiCreateBlockerRoute(
                request,
                rawBlockerBody,
                requestId,
                deps.controls,
                blockerDeps as ApiBlockerMutationRouteDependencies,
              )
              : await executeApiUpdateBlockerRoute(
                request,
                rawBlockerBody,
                requestId,
                deps.controls,
                blockerDeps as ApiBlockerMutationRouteDependencies,
              );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (blockerOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, blockerOutcome.error);
        return safeAuthErrorResponse(
          blockerOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const blockerStatus = blockerOutcome.result.status;
      const blockerMethod: ApiLogMethod = isBlockerCreate ? "POST" : "PATCH";

      if (blockerActivity !== null && blockerStartMs !== null) {
        const endMs = readActivityClock(blockerActivity);
        if (endMs !== null && endMs >= blockerStartMs) {
          const durationMs = endMs - blockerStartMs;
          if (isValidActivityDuration(durationMs)) {
            // API-ADM.1 — structural metadata plus canonical hierarchy
            // derived SERVER-SIDE from the successful result target.
            scheduleMutationActivity(
              blockerActivity,
              {
                targetType: blockerOutcome.result.payload.targetType,
                targetId: blockerOutcome.result.payload.targetId,
              },
              {
                apiClientId:
                  blockerOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: blockerOutcome.result.route.id,
                method: blockerMethod,
                status: blockerStatus,
                durationMs,
                actorUserId:
                  blockerOutcome.result.activityIdentity.actorUserId,
                correlationId: toActivityCorrelationId(requestId),
              },
            );

          }
        }
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: blockerMethod,
        routeId: blockerOutcome.result.route.id,
        status: blockerStatus,
      });
      return jsonResponse(
        blockerStatus,
        blockerOutcome.result.payload,
        requestId,
        corsHeaders,
      );
    }

    // Phase 6a2p — API-N.5 / API-N.6 / API-N.7 explicit Project mutation
    // dispatch. Exactly three targets are reachable: POST /v1/projects,
    // PATCH /v1/projects/<validated UUID> and
    // POST /v1/projects/<validated UUID>/transition. No generic dispatch is
    // added and no other Project mutation surface becomes reachable here.

    if (
      (method === "POST" && url.pathname === PROJECT_CREATE_ROUTE.path) ||
      isProjectUpdatePath || isProjectTransitionPath
    ) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Exactly two Project operations are reachable, each decided by an exact
      // static path or an exact accepted parser.
      const projectOperation: "create" | "update" | "transition" =
        isProjectUpdatePath
          ? "update"
          : isProjectTransitionPath
          ? "transition"
          : "create";
      const expectedProjectRoute = projectOperation === "create"
        ? PROJECT_CREATE_ROUTE
        : projectOperation === "update"
        ? PROJECT_UPDATE_ROUTE
        : PROJECT_TRANSITION_ROUTE;

      // Runtime gate on the actual pathname, before any body read.
      const projectRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (projectRoute !== expectedProjectRoute) {
        throw new ApiHttpError("route_not_found");
      }

      const projectDeps = deps.projectMutationRoute;
      if (!isNonArrayObject(projectDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawProjectBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type ProjectOutcome =
        | {
          readonly kind: "ok";
          readonly result:
            | ApiCreateProjectRouteResult
            | ApiUpdateProjectRouteResult
            | ApiTransitionProjectRouteResult;
        }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const projectActivity = resolveActivityDependencies(deps.activity);
      const projectStartMs = projectActivity === null
        ? null
        : readActivityClock(projectActivity);

      const projectOutcome = await withApiTimeout<ProjectOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const projectExecutor = projectOperation === "create"
              ? executeApiCreateProjectRoute
              : projectOperation === "update"
              ? executeApiUpdateProjectRoute
              : executeApiTransitionProjectRoute;
            const result = await projectExecutor(
              request,
              rawProjectBody,
              requestId,
              deps.controls,
              projectDeps as ApiProjectMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (projectOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, projectOutcome.error);
        return safeAuthErrorResponse(
          projectOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const projectStatus = projectOutcome.result.status;
      const projectPayload = projectOutcome.result.payload;
      const projectLogMethod: ApiLogMethod = projectOperation === "update"
        ? "PATCH"
        : "POST";

      // API-ADM.1 — attribution uses ONLY server-returned result identity.
      // API-N.6-C1 — per-operation durable activity triggers:
      //  * create: `applied` and `replayed` both schedule activity (this
      //    preserves the accepted pre-API-N.6 Project-create behavior);
      //  * update: only a genuinely `applied` mutation schedules activity —
      //    `no_change` and `replayed` performed no new material mutation;
      //  * API-N.7 transition: only a genuinely `applied` transition schedules
      //    activity — `no_change`, `replayed` and every bounded 409 completion
      //    outcome performed no new material mutation.
      const projectMutated = projectPayload.ok === true &&
        (projectOperation === "create"
          ? (projectPayload.outcome === "applied" ||
            projectPayload.outcome === "replayed")
          : projectPayload.outcome === "applied");

      if (
        projectMutated && projectActivity !== null &&
        projectStartMs !== null
      ) {
        const endMs = readActivityClock(projectActivity);
        if (endMs !== null && endMs >= projectStartMs) {
          const durationMs = endMs - projectStartMs;
          if (isValidActivityDuration(durationMs)) {
            scheduleMutationActivity(
              projectActivity,
              {
                targetType: "project" as const,
                targetId: projectPayload.projectId,
              },
              {
                apiClientId: projectOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: projectOutcome.result.route.id,
                method: projectLogMethod,
                status: projectStatus,
                durationMs,
                actorUserId:
                  projectOutcome.result.activityIdentity.actorUserId,
                correlationId: toActivityCorrelationId(requestId),
              },
            );
          }
        }
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: projectLogMethod,
        routeId: projectOutcome.result.route.id,
        status: projectStatus,
      });
      return jsonResponse(
        projectStatus,
        projectPayload,
        requestId,
        corsHeaders,
      );
    }

    // API-Q Portfolio-4B — explicit Portfolio mutation dispatch. Exactly one
    // target is reachable: POST /v1/portfolios. No generic Portfolio dispatcher
    // is added and no other Portfolio mutation surface becomes reachable here.
    if (method === "POST" && url.pathname === PORTFOLIO_CREATE_ROUTE.path) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Runtime gate on the actual pathname, before any body read.
      const portfolioRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (portfolioRoute !== PORTFOLIO_CREATE_ROUTE) {
        throw new ApiHttpError("route_not_found");
      }

      const portfolioDeps = deps.portfolioMutationRoute;
      if (!isNonArrayObject(portfolioDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawPortfolioBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type PortfolioOutcome =
        | {
          readonly kind: "ok";
          readonly result: ApiCreatePortfolioRouteResult;
        }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      // API-Q Portfolio-4B — durable API activity is deliberately NOT emitted
      // here. The accepted activity-scope substrate resolves only `project`,
      // `phase` and `task` targets into the canonical four-UUID scope; a
      // Portfolio has no Project scope. Extending that substrate is out of
      // scope for this step.

      const portfolioOutcome = await withApiTimeout<PortfolioOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = await executeApiCreatePortfolioRoute(
              request,
              rawPortfolioBody,
              requestId,
              deps.controls,
              portfolioDeps as ApiPortfolioMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (portfolioOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, portfolioOutcome.error);
        return safeAuthErrorResponse(
          portfolioOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const portfolioStatus = portfolioOutcome.result.status;
      const portfolioPayload = portfolioOutcome.result.payload;

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "POST",
        routeId: portfolioOutcome.result.route.id,
        status: portfolioStatus,
      });
      return jsonResponse(
        portfolioStatus,
        portfolioPayload,
        requestId,
        corsHeaders,
      );
    }

    // API-Q Portfolio-5B — explicit Portfolio update dispatch. Exactly one
    // additional target is reachable: PATCH /v1/portfolios/<validated UUID>. No
    // generic Portfolio dispatcher is added and no other Portfolio mutation
    // surface becomes reachable here.
    if (isPortfolioUpdatePath) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Runtime gate on the actual pathname, before any body read.
      const portfolioUpdateRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (portfolioUpdateRoute !== PORTFOLIO_UPDATE_ROUTE) {
        throw new ApiHttpError("route_not_found");
      }

      const portfolioUpdateDeps = deps.portfolioMutationRoute;
      if (!isNonArrayObject(portfolioUpdateDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawPortfolioUpdateBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type PortfolioUpdateOutcome =
        | { readonly kind: "ok"; readonly result: ApiUpdatePortfolioRouteResult }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      // API-Q Portfolio-5B — durable API activity is deliberately NOT emitted
      // here, for exactly the same accepted reason as Portfolio-4B and the
      // Program commands: the activity-scope substrate resolves only `project`,
      // `phase` and `task` targets. Canonical Portfolio activity and PMG
      // provenance are already handled by the accepted database path.
      const portfolioUpdateOutcome = await withApiTimeout<
        PortfolioUpdateOutcome
      >(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = await executeApiUpdatePortfolioRoute(
              request,
              rawPortfolioUpdateBody,
              requestId,
              deps.controls,
              portfolioUpdateDeps as ApiPortfolioMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (portfolioUpdateOutcome.kind === "authError") {
        emitTerminalForAuthError(
          requestId,
          logMethod,
          portfolioUpdateOutcome.error,
        );
        return safeAuthErrorResponse(
          portfolioUpdateOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "PATCH",
        routeId: portfolioUpdateOutcome.result.route.id,
        status: portfolioUpdateOutcome.result.status,
      });
      return jsonResponse(
        portfolioUpdateOutcome.result.status,
        portfolioUpdateOutcome.result.payload,
        requestId,
        corsHeaders,
      );
    }

    // API-Q Portfolio-6B — explicit Project↔Portfolio assignment dispatch.
    // Exactly one additional target is reachable:
    // PUT /v1/projects/<validated UUID>/portfolio. No generic dispatcher is
    // added and no other Portfolio or Project mutation surface becomes
    // reachable here.
    if (isPortfolioAssignProjectPath) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Runtime gate on the actual pathname, before any body read.
      const assignPortfolioRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (assignPortfolioRoute !== PORTFOLIO_ASSIGN_PROJECT_ROUTE) {
        throw new ApiHttpError("route_not_found");
      }

      const assignPortfolioDeps = deps.portfolioMutationRoute;
      if (!isNonArrayObject(assignPortfolioDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawAssignPortfolioBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type AssignProjectPortfolioOutcome =
        | {
          readonly kind: "ok";
          readonly result: ApiAssignProjectPortfolioRouteResult;
        }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const assignPortfolioActivity = resolveActivityDependencies(
        deps.activity,
      );
      const assignPortfolioStartMs = assignPortfolioActivity === null
        ? null
        : readActivityClock(assignPortfolioActivity);

      const assignPortfolioOutcome = await withApiTimeout<
        AssignProjectPortfolioOutcome
      >(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = await executeApiAssignProjectPortfolioRoute(
              request,
              rawAssignPortfolioBody,
              requestId,
              deps.controls,
              assignPortfolioDeps as ApiPortfolioMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (assignPortfolioOutcome.kind === "authError") {
        emitTerminalForAuthError(
          requestId,
          logMethod,
          assignPortfolioOutcome.error,
        );
        return safeAuthErrorResponse(
          assignPortfolioOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const assignPortfolioPayload = assignPortfolioOutcome.result.payload;

      // API-ADM.1 — attribution uses ONLY server-returned result identity. The
      // target is the canonical `project` scope already supported by the
      // activity substrate. Only a genuinely `applied` assignment schedules
      // activity: `no_change` and `replayed` performed no new material
      // mutation.
      if (
        assignPortfolioPayload.ok === true &&
        assignPortfolioPayload.outcome === "applied" &&
        assignPortfolioActivity !== null && assignPortfolioStartMs !== null
      ) {
        const endMs = readActivityClock(assignPortfolioActivity);
        if (endMs !== null && endMs >= assignPortfolioStartMs) {
          const durationMs = endMs - assignPortfolioStartMs;
          if (isValidActivityDuration(durationMs)) {
            scheduleMutationActivity(
              assignPortfolioActivity,
              {
                targetType: "project" as const,
                targetId: assignPortfolioPayload.projectId,
              },
              {
                apiClientId:
                  assignPortfolioOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: assignPortfolioOutcome.result.route.id,
                method: "PUT",
                status: assignPortfolioOutcome.result.status,
                durationMs,
                actorUserId:
                  assignPortfolioOutcome.result.activityIdentity.actorUserId,
                correlationId: toActivityCorrelationId(requestId),
              },
            );
          }
        }
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "PUT",
        routeId: assignPortfolioOutcome.result.route.id,
        status: assignPortfolioOutcome.result.status,
      });
      return jsonResponse(
        assignPortfolioOutcome.result.status,
        assignPortfolioPayload,
        requestId,
        corsHeaders,
      );
    }

    // Phase 6a2q — API-N.9A explicit Program mutation dispatch. Exactly one
    // target is reachable: POST /v1/programs. No generic Program dispatcher is
    // added and no other Program mutation surface becomes reachable here.
    if (method === "POST" && url.pathname === PROGRAM_CREATE_ROUTE.path) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Runtime gate on the actual pathname, before any body read.
      const programRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (programRoute !== PROGRAM_CREATE_ROUTE) {
        throw new ApiHttpError("route_not_found");
      }

      const programDeps = deps.programMutationRoute;
      if (!isNonArrayObject(programDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawProgramBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type ProgramOutcome =
        | { readonly kind: "ok"; readonly result: ApiCreateProgramRouteResult }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      // API-N.9A — durable API activity is deliberately NOT emitted here. The
      // accepted activity-scope substrate resolves only `project`, `phase` and
      // `task` targets into the canonical four-UUID scope; a Program has no
      // Project scope. Extending that substrate is out of scope for this step.



      const programOutcome = await withApiTimeout<ProgramOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = await executeApiCreateProgramRoute(
              request,
              rawProgramBody,
              requestId,
              deps.controls,
              programDeps as ApiProgramMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (programOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, programOutcome.error);
        return safeAuthErrorResponse(
          programOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const programStatus = programOutcome.result.status;
      const programPayload = programOutcome.result.payload;


      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "POST",
        routeId: programOutcome.result.route.id,
        status: programStatus,
      });
      return jsonResponse(
        programStatus,
        programPayload,
        requestId,
        corsHeaders,
      );
    }

    // Phase 6a2r — API-N.9B explicit Program update dispatch. Exactly one
    // additional target is reachable: PATCH /v1/programs/<validated UUID>. No
    // generic Program dispatcher is added and no other Program mutation surface
    // becomes reachable here.
    if (isProgramUpdatePath) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Runtime gate on the actual pathname, before any body read.
      const programUpdateRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (programUpdateRoute !== PROGRAM_UPDATE_ROUTE) {
        throw new ApiHttpError("route_not_found");
      }

      const programUpdateDeps = deps.programMutationRoute;
      if (!isNonArrayObject(programUpdateDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawProgramUpdateBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type ProgramUpdateOutcome =
        | { readonly kind: "ok"; readonly result: ApiUpdateProgramRouteResult }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      // API-N.9B — durable API activity is deliberately NOT emitted here, for
      // exactly the same accepted reason as API-N.9A: the activity-scope
      // substrate resolves only `project`, `phase` and `task` targets.
      const programUpdateOutcome = await withApiTimeout<ProgramUpdateOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = await executeApiUpdateProgramRoute(
              request,
              rawProgramUpdateBody,
              requestId,
              deps.controls,
              programUpdateDeps as ApiProgramMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (programUpdateOutcome.kind === "authError") {
        emitTerminalForAuthError(
          requestId,
          logMethod,
          programUpdateOutcome.error,
        );
        return safeAuthErrorResponse(
          programUpdateOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "PATCH",
        routeId: programUpdateOutcome.result.route.id,
        status: programUpdateOutcome.result.status,
      });
      return jsonResponse(
        programUpdateOutcome.result.status,
        programUpdateOutcome.result.payload,
        requestId,
        corsHeaders,
      );
    }



    // Phase 6a3 — API-M.8A explicit Phase mutation dispatch. Exactly two
    // targets are reachable: POST /v1/phases and
    // PATCH /v1/phases/<validated UUID>. No generic dispatch is added.
    if (
      (method === "POST" && url.pathname === PHASE_CREATE_ROUTE.path) ||
      isPhaseReorderPath ||
      isPhaseUpdatePath ||
      isPhasePlanningPath
    ) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Exactly four Phase operations are reachable, each decided by an exact
      // static path or an exact accepted parser.
      const phaseOperation: "create" | "reorder" | "update" | "plan" =
        isPhaseReorderPath
          ? "reorder"
          : isPhasePlanningPath
          ? "plan"
          : method === "POST"
          ? "create"
          : "update";

      const expectedPhaseRoute = phaseOperation === "create"
        ? PHASE_CREATE_ROUTE
        : phaseOperation === "reorder"
        ? PHASE_REORDER_ROUTE
        : phaseOperation === "update"
        ? PHASE_UPDATE_ROUTE
        : PHASE_PLANNING_ROUTE;

      // Runtime gate on the actual pathname, before any body read.
      const phaseRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (phaseRoute !== expectedPhaseRoute) {
        throw new ApiHttpError("route_not_found");
      }

      const phaseDeps = deps.phaseMutationRoute;
      if (!isNonArrayObject(phaseDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawPhaseBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type PhaseOutcome =
        | {
          readonly kind: "ok";
          readonly result:
            | ApiCreatePhaseRouteResult
            | ApiUpdatePhaseRouteResult
            | ApiReorderPhasesRouteResult
            | ApiPlanPhaseRouteResult;
        }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const phaseActivity = resolveActivityDependencies(deps.activity);
      const phaseStartMs = phaseActivity === null
        ? null
        : readActivityClock(phaseActivity);

      const phaseOutcome = await withApiTimeout<PhaseOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const phaseExecutor = phaseOperation === "create"
              ? executeApiCreatePhaseRoute
              : phaseOperation === "reorder"
              ? executeApiReorderPhasesRoute
              : phaseOperation === "update"
              ? executeApiUpdatePhaseRoute
              : executeApiPlanPhaseRoute;
            const result = await phaseExecutor(
              request,
              rawPhaseBody,
              requestId,
              deps.controls,
              phaseDeps as ApiPhaseMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (phaseOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, phaseOutcome.error);
        return safeAuthErrorResponse(
          phaseOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const phaseStatus = phaseOutcome.result.status;
      const phaseMethod: ApiLogMethod =
        phaseOperation === "create" || phaseOperation === "reorder"
          ? "POST"
          : "PATCH";

      // API-M.8A-C1 Correction D — durable mutation activity is recorded ONLY
      // for a real mutation. A bounded `confirmation_required` create (409)
      // created no Phase and changed no Project, so it schedules no durable
      // mutation activity at all — not even a Project-targeted substitute.
      // API-M.8B — a `confirmation_required` planning result (409) changed
      // nothing either, so it likewise schedules no durable mutation activity.
      const phasePayload = phaseOutcome.result.payload;
      const phaseMutated = phasePayload.ok === true;

      // Attribution uses ONLY server-returned result identity. A reorder is a
      // Project-level ordering mutation; every other Phase operation targets
      // the returned Phase.
      const phaseActivityTarget = phaseMutated
        ? (phaseOperation === "reorder"
          ? {
            targetType: "project" as const,
            targetId: (phasePayload as { readonly projectId: string })
              .projectId,
          }
          : {
            targetType: "phase" as const,
            targetId: (phasePayload as { readonly phaseId: string }).phaseId,
          })
        : null;

      if (phaseActivityTarget !== null && phaseActivity !== null && phaseStartMs !== null) {
        const endMs = readActivityClock(phaseActivity);
        if (endMs !== null && endMs >= phaseStartMs) {
          const durationMs = endMs - phaseStartMs;
          if (isValidActivityDuration(durationMs)) {
            // API-ADM.1 — canonical hierarchy derived SERVER-SIDE from the
            // validated result, never from the request body.
            scheduleMutationActivity(
              phaseActivity,
              phaseActivityTarget,
              {
                apiClientId: phaseOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: phaseOutcome.result.route.id,
                method: phaseMethod,
                status: phaseStatus,
                durationMs,
                actorUserId:
                  phaseOutcome.result.activityIdentity.actorUserId,
                correlationId: toActivityCorrelationId(requestId),
              },
            );
          }
        }
      }


      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: phaseMethod,
        routeId: phaseOutcome.result.route.id,
        status: phaseStatus,
      });
      return jsonResponse(
        phaseStatus,
        phaseOutcome.result.payload,
        requestId,
        corsHeaders,
      );
    }

    // Phase 6a4 — API-M.11A / API-M.11B explicit Task mutation dispatch.
    // Exactly four targets are reachable: POST /v1/tasks,
    // PATCH /v1/tasks/<uuid>, POST /v1/phases/<uuid>/tasks/reorder and
    // PATCH /v1/tasks/<uuid>/planning. No generic dispatch is added, and Task
    // assignment and transition remain unreachable.
    if (
      (method === "POST" && url.pathname === TASK_CREATE_ROUTE.path) ||
      isTaskUpdatePath || isTaskReorderPath || isTaskPlanningPath ||
      isTaskAssignPath || isTaskTransitionPath
    ) {
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }

      // Each Task operation is decided by an exact static path or an exact
      // accepted parser, never by a shared prefix.
      const taskOperation:
        | "create"
        | "update"
        | "reorder"
        | "plan"
        | "assign"
        | "transition" = isTaskReorderPath
          ? "reorder"
          : isTaskPlanningPath
          ? "plan"
          : isTaskAssignPath
          ? "assign"
          : isTaskTransitionPath
          ? "transition"
          : method === "POST"
          ? "create"
          : "update";

      const expectedTaskRoute = taskOperation === "create"
        ? TASK_CREATE_ROUTE
        : taskOperation === "update"
        ? TASK_UPDATE_ROUTE
        : taskOperation === "reorder"
        ? TASK_REORDER_ROUTE
        : taskOperation === "assign"
        ? TASK_ASSIGN_ROUTE
        : taskOperation === "transition"
        ? TASK_TRANSITION_ROUTE
        : TASK_PLANNING_ROUTE;

      // Runtime gate on the actual pathname, before any body read.
      const taskRoute = resolveApiRouteAccess(
        method,
        url.pathname,
        deps.controls,
      );
      if (taskRoute !== expectedTaskRoute) {
        throw new ApiHttpError("route_not_found");
      }

      const taskDeps = deps.taskMutationRoute;
      if (!isNonArrayObject(taskDeps)) {
        throw new ApiHttpError("internal_error");
      }

      const rawTaskBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type TaskOutcome =
        | {
          readonly kind: "ok";
          readonly result:
            | ApiCreateTaskRouteResult
            | ApiUpdateTaskRouteResult
            | ApiReorderTasksRouteResult
            | ApiPlanTaskRouteResult
            | ApiAssignTaskRouteResult
            | ApiTransitionTaskRouteResult;
        }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const taskActivity = resolveActivityDependencies(deps.activity);
      const taskStartMs = taskActivity === null
        ? null
        : readActivityClock(taskActivity);

      const taskOutcome = await withApiTimeout<TaskOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const taskExecutor = taskOperation === "create"
              ? executeApiCreateTaskRoute
              : taskOperation === "update"
              ? executeApiUpdateTaskRoute
              : taskOperation === "reorder"
              ? executeApiReorderTasksRoute
              : taskOperation === "assign"
              ? executeApiAssignTaskRoute
              : taskOperation === "transition"
              ? executeApiTransitionTaskRoute
              : executeApiPlanTaskRoute;
            const result = await taskExecutor(
              request,
              rawTaskBody,
              requestId,
              deps.controls,
              taskDeps as ApiTaskMutationRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (taskOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, taskOutcome.error);
        return safeAuthErrorResponse(
          taskOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const taskStatus = taskOutcome.result.status;
      const taskLogMethod: ApiLogMethod = taskOperation === "create" ||
          taskOperation === "reorder" || taskOperation === "transition"
        ? "POST"
        : taskOperation === "assign"
        ? "PUT"
        : "PATCH";

      // Durable mutation activity is recorded ONLY for a real mutation. A
      // bounded `confirmation_required` create (409) created no Task and
      // changed nothing, so it schedules no durable mutation activity.
      const taskPayload = taskOutcome.result.payload;
      const taskMutated = taskPayload.ok === true;

      // Attribution uses ONLY server-returned result identity. A reorder is a
      // Phase-level ordering mutation; every other Task operation targets the
      // returned Task. A bounded `confirmation_required` planning result (409)
      // changed nothing, so it schedules no durable mutation activity.
      const taskActivityTarget = taskMutated
        ? (taskOperation === "reorder"
          ? {
            targetType: "phase" as const,
            targetId: (taskPayload as { readonly phaseId: string }).phaseId,
          }
          : {
            targetType: "task" as const,
            targetId: (taskPayload as { readonly taskId: string }).taskId,
          })
        : null;

      if (
        taskActivityTarget !== null && taskActivity !== null &&
        taskStartMs !== null
      ) {
        const endMs = readActivityClock(taskActivity);
        if (endMs !== null && endMs >= taskStartMs) {
          const durationMs = endMs - taskStartMs;
          if (isValidActivityDuration(durationMs)) {
            scheduleMutationActivity(
              taskActivity,
              taskActivityTarget,
              {
                apiClientId: taskOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: taskOutcome.result.route.id,
                method: taskLogMethod,
                status: taskStatus,
                durationMs,
                actorUserId: taskOutcome.result.activityIdentity.actorUserId,
                correlationId: toActivityCorrelationId(requestId),
              },
            );
          }
        }
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: taskLogMethod,
        routeId: taskOutcome.result.route.id,
        status: taskStatus,
      });
      return jsonResponse(
        taskStatus,
        taskOutcome.result.payload,
        requestId,
        corsHeaders,
      );
    }






    // Phase 6b — API-I.9B single-route POST dispatch. No generic POST
    // dispatch exists: any other POST target is `route_not_found`.
    if (method === "POST") {
      if (url.pathname !== EXECUTION_UPDATES_APPEND_ROUTE.path) {
        throw new ApiHttpError("route_not_found");
      }
      if (url.search.length > 0 || url.hash.length > 0) {
        throw new ApiHttpError("invalid_request");
      }
      // Runtime gate on the actual pathname, before any body read. This is
      // the existing accepted gate: mutations disabled (or the global API
      // switch off) yields `api_unavailable` before any body is read.
      const mutationRoute = resolveApiRouteAccess(
        "POST",
        url.pathname,
        deps.controls,
      );
      if (mutationRoute !== EXECUTION_UPDATES_APPEND_ROUTE) {
        throw new ApiHttpError("route_not_found");
      }

      const mutationDeps = deps.appendExecutionUpdateRoute;
      if (!isNonArrayObject(mutationDeps)) {
        throw new ApiHttpError("internal_error");
      }

      // Bounded JSON read is the ONLY body reader. Decoded value stays
      // `unknown` for strict API-I.6 parsing inside API-I.9A.
      const rawBody: unknown = await readBoundedJson(
        request,
        MUTATION_MAX_BODY_BYTES,
      );

      type MutationOutcome =
        | {
          readonly kind: "ok";
          readonly result: ApiAppendExecutionUpdateRouteResult;
        }
        | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

      const mutationActivity = resolveActivityDependencies(deps.activity);
      const mutationStartMs = mutationActivity === null
        ? null
        : readActivityClock(mutationActivity);

      const mutationOutcome = await withApiTimeout<MutationOutcome>(
        deps.timeoutMs,
        async (_signal) => {
          try {
            const result = await executeApiAppendExecutionUpdateRoute(
              request,
              rawBody,
              requestId,
              deps.controls,
              mutationDeps as ApiAppendExecutionUpdateRouteDependencies,
            );
            return { kind: "ok", result } as const;
          } catch (cause) {
            if (cause instanceof ApiAuthenticationError) {
              return { kind: "authError", error: cause } as const;
            }
            throw cause;
          }
        },
      );

      if (mutationOutcome.kind === "authError") {
        emitTerminalForAuthError(requestId, logMethod, mutationOutcome.error);
        return safeAuthErrorResponse(
          mutationOutcome.error,
          requestId,
          corsHeaders,
        );
      }

      const mutationStatus = mutationOutcome.result.status;

      if (mutationActivity !== null && mutationStartMs !== null) {
        const endMs = readActivityClock(mutationActivity);
        if (endMs !== null && endMs >= mutationStartMs) {
          const durationMs = endMs - mutationStartMs;
          if (isValidActivityDuration(durationMs)) {
            // API-ADM.1 — safe metadata plus canonical hierarchy derived
            // SERVER-SIDE from the successful result target (phase or task).
            // No narrative, statusLabel, payload hash or token is recorded.
            scheduleMutationActivity(
              mutationActivity,
              {
                targetType: mutationOutcome.result.payload.targetType,
                targetId: mutationOutcome.result.payload.targetId,
              },
              {
                apiClientId:
                  mutationOutcome.result.activityIdentity.apiClientId,
                apiVersion: "v1",
                routeId: mutationOutcome.result.route.id,
                method: "POST",
                status: mutationStatus,
                durationMs,

                actorUserId:
                  mutationOutcome.result.activityIdentity.actorUserId,

                correlationId: toActivityCorrelationId(requestId),
              },
            );

          }
        }
      }

      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "POST",
        routeId: mutationOutcome.result.route.id,
        status: mutationStatus,
      });
      return jsonResponse(
        mutationStatus,
        mutationOutcome.result.payload,
        requestId,
        corsHeaders,
      );
    }

    // Phase 7 — Bodyless request-size enforcement for GET/OPTIONS only
    // (before authentication). Validate the exact supplied Content-Length
    // header value; do not trim or otherwise normalize it.
    const rawContentLength = request.headers.get("Content-Length");
    if (rawContentLength !== null) {
      if (
        rawContentLength.length === 0 ||
        !CONTENT_LENGTH_PATTERN.test(rawContentLength)
      ) {
        throw new ApiHttpError("invalid_content_length");
      }
      const n = Number(rawContentLength);
      if (
        !Number.isFinite(n) ||
        !Number.isSafeInteger(n) ||
        n < 0
      ) {
        throw new ApiHttpError("invalid_content_length");
      }
      if (n > 0) {
        throw new ApiHttpError("request_too_large");
      }
    }
    if (request.body !== null) {
      throw new ApiHttpError("request_too_large");
    }

    // Phase 8 — CORS preflight (OPTIONS).
    if (method === "OPTIONS") {
      if (request.headers.get("Origin") === null) {
        throw new ApiHttpError("cors_origin_denied");
      }
      const requestedMethod = request.headers.get(
        "Access-Control-Request-Method",
      );
      if (
        requestedMethod !== "GET" &&
        requestedMethod !== "POST" &&
        requestedMethod !== "PATCH" &&
        requestedMethod !== "PUT"
      ) {
        throw new ApiHttpError("route_not_found");
      }
      // API-M.11C — PUT preflight is accepted only for an exact validated Task
      // assignment path.
      if (requestedMethod === "PUT") {
        if (
          url.search.length > 0 || url.hash.length > 0 ||
          !isExactTaskAssignPreflightPath(url.pathname) &&
          !isExactAssignProjectPortfolioPreflightPath(url.pathname)
        ) {
          throw new ApiHttpError("route_not_found");
        }
      }
      if (requestedMethod === "POST") {
        // API-K.8-C1 / API-M.8A — exact POST preflight allowlist:
        // execution-updates, Risk create, Blocker create, Phase create. No
        // prefix or wildcard matching.
        if (
          (url.pathname !== EXECUTION_UPDATES_APPEND_ROUTE.path &&
            url.pathname !== RISK_CREATE_ROUTE.path &&
            url.pathname !== BLOCKER_CREATE_ROUTE.path &&
            url.pathname !== PHASE_CREATE_ROUTE.path &&
            url.pathname !== TASK_CREATE_ROUTE.path &&
            url.pathname !== PROJECT_CREATE_ROUTE.path &&
            url.pathname !== PROGRAM_CREATE_ROUTE.path &&
            url.pathname !== PORTFOLIO_CREATE_ROUTE.path &&
            !isExactPhaseReorderPreflightPath(url.pathname) &&
            !isExactTaskReorderPreflightPath(url.pathname) &&
            !isExactTaskTransitionPreflightPath(url.pathname) &&
            !isExactProjectTransitionPreflightPath(url.pathname) &&
            !isExactProjectKpiCreatePreflightPath(url.pathname) &&
            !isExactKpiUpdateAppendPreflightPath(url.pathname)) ||
          url.search.length > 0 ||
          url.hash.length > 0
        ) {
          throw new ApiHttpError("route_not_found");
        }
      }
      // API-K.7 / API-K.8-C1 / API-M.8A — PATCH preflight is accepted only for
      // an exact validated Risk, Blocker or Phase update path.
      if (requestedMethod === "PATCH") {
        if (url.search.length > 0 || url.hash.length > 0) {
          throw new ApiHttpError("route_not_found");
        }
        let preflightUpdate = false;
        try {
          parseApiV1RiskUpdatePath(url.pathname);
          preflightUpdate = true;
        } catch {
          preflightUpdate = false;
        }
        if (!preflightUpdate) {
          try {
            parseApiV1BlockerUpdatePath(url.pathname);
            preflightUpdate = true;
          } catch {
            preflightUpdate = false;
          }
        }
        if (!preflightUpdate) {
          try {
            parseApiV1PhaseUpdatePath(url.pathname);
            preflightUpdate = true;
          } catch {
            preflightUpdate = false;
          }
        }
        if (!preflightUpdate) {
          // API-M.11A — an exact validated Task update path is an accepted
          // PATCH preflight target.
          try {
            parseApiV1TaskUpdatePath(url.pathname);
            preflightUpdate = true;
          } catch {
            preflightUpdate = false;
          }
        }
        if (!preflightUpdate) {
          // API-M.8B — the nested Phase planning path is an accepted PATCH
          // preflight target.
          try {
            parseApiV1PhasePlanningPath(url.pathname);
            preflightUpdate = true;
          } catch {
            preflightUpdate = false;
          }
        }
        if (!preflightUpdate) {
          // API-N.6 — an exact validated Project update path is an accepted
          // PATCH preflight target.
          try {
            parseApiV1ProjectUpdatePath(url.pathname);
            preflightUpdate = true;
          } catch {
            preflightUpdate = false;
          }
        }
        if (!preflightUpdate) {
          // API-N.9B — an exact validated Program update path is an accepted
          // PATCH preflight target.
          try {
            parseApiV1ProgramUpdatePath(url.pathname);
            preflightUpdate = true;
          } catch {
            preflightUpdate = false;
          }
        }
        if (!preflightUpdate) {
          // API-Q Portfolio-5B — an exact validated Portfolio update path is an
          // accepted PATCH preflight target. No wildcard `/v1/portfolios/*`
          // preflight logic is introduced.
          try {
            parseApiV1PortfolioUpdatePath(url.pathname);
            preflightUpdate = true;
          } catch {
            preflightUpdate = false;
          }
        }
        if (!preflightUpdate) {
          // KPI-5B — an exact validated KPI update path is an accepted PATCH
          // preflight target, recognized through the same exact KPI detail path
          // authority. No wildcard `/v1/kpis/*` preflight logic is introduced.
          preflightUpdate = isExactKpiUpdatePreflightPath(url.pathname);
        }
        if (!preflightUpdate) {
          // API-M.11B — the nested Task planning path is the only remaining
          // accepted PATCH preflight target.
          try {
            parseApiV1TaskPlanningPath(url.pathname);
          } catch {
            throw new ApiHttpError("route_not_found");
          }
        }
      }

      const matched = matchApiRoute(requestedMethod, routeTarget);
      if (matched === null) {
        throw new ApiHttpError("route_not_found");
      }
      const preflightHeaders = new Headers(corsHeaders);
      preflightHeaders.set("X-Request-ID", requestId);
      preflightHeaders.set("Cache-Control", "no-store");
      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId,
        method: "OPTIONS",
        routeId: matched.id,
        status: 204,
      });
      return new Response(null, { status: 204, headers: preflightHeaders });
    }

    // Phase 9 — Protected GET execution under a bounded timeout.
    type Outcome =
      | { readonly kind: "ok"; readonly result: ApiProtectedRouteResult }
      | { readonly kind: "authError"; readonly error: ApiAuthenticationError };

    // API-G.5.10A-3 — Optional instrumentation resolved outside the timeout
    // operation. Recording is never part of the protected-route operation.
    const activity = resolveActivityDependencies(deps.activity);
    const startMs = activity === null ? null : readActivityClock(activity);

    const outcome = await withApiTimeout<Outcome>(
      deps.timeoutMs,
      async (_signal) => {
        try {
          const result = await executeApiProtectedRoute(
            request,
            routeTarget,
            deps.controls,
            deps.protectedRoute,
          );
          return { kind: "ok", result } as const;
        } catch (cause) {
          if (cause instanceof ApiAuthenticationError) {
            return { kind: "authError", error: cause } as const;
          }
          throw cause;
        }
      },
    );

    if (outcome.kind === "authError") {
      emitTerminalForAuthError(requestId, logMethod, outcome.error);
      return safeAuthErrorResponse(outcome.error, requestId, corsHeaders);
    }

    if (activity !== null && startMs !== null) {
      const endMs = readActivityClock(activity);
      if (endMs !== null && endMs >= startMs) {
        const durationMs = endMs - startMs;
        if (isValidActivityDuration(durationMs)) {
          const activityInput: ApiActivityRecordInput = {
            apiClientId: outcome.result.activityIdentity.apiClientId,
            apiVersion: "v1",
            routeId: outcome.result.route.id,
            method: "GET",
            status: 200,
            durationMs,

            actorUserId: outcome.result.activityIdentity.actorUserId,
            tenantId: null,
            organizationId: null,
            workspaceId: null,
            projectId: null,

            correlationId: toActivityCorrelationId(requestId),
          };
          scheduleActivity(activity, activityInput);
        }
      }
    }

    logApiEvent({
      level: "info",
      event: "api.request.completed",
      requestId,
      method: "GET",
      routeId: outcome.result.route.id,
      status: 200,
    });
    return jsonResponse(200, outcome.result.payload, requestId, corsHeaders);

  } catch (cause) {
    const err =
      cause instanceof ApiHttpError
        ? cause
        : new ApiHttpError("internal_error", cause);
    emitTerminalForHttpError(requestId, logMethod, err);
    return toSafeHttpErrorResponse(err, requestId, corsHeaders);
  }
}
